// Report Management Routes - MySQL Version
const express = require('express');
const router = express.Router();
const Database = require('../config');
const { authenticateToken, collectAuditContext } = require('../middleware/auth');
const RevenueService = require('../services/RevenueService');
const SecurityService = require('../services/SecurityService');
const FraudDetectionService = require('../services/FraudDetectionService');
const NotificationService = require('../services/NotificationService');
const EmailTemplate = require('../services/EmailTemplate');
const { getDisplayName, nameSelectColumns } = require('../utils/user-helpers');
const TermiiService = require('../services/TermiiService');
const IdentityMatchingService = require('../services/IdentityMatchingService');

router.use(authenticateToken);
router.use(collectAuditContext);

// GET /api/report-management - List user's reports
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, report_type } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    let whereClause = 'r.reporter_id = ?';
    let whereParams = [userId];

    if (status) {
      whereClause += ' AND r.status = ?';
      whereParams.push(status);
    }

    if (report_type) {
      whereClause += ' AND r.report_type = ?';
      whereParams.push(report_type);
    }

    const reports = await Database.query(`
      SELECT 
        r.*,
        d.brand,
        d.model,
        d.imei,
        d.serial,
        lea.agency_name,
        lea.contact_email as lea_email
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, [...whereParams, limit, offset]);

    const [{ total }] = await Database.query(
      `SELECT COUNT(*) as total FROM reports r WHERE ${whereClause}`,
      whereParams
    );

    res.json({
      data: reports,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/report-management/my-devices - Get user's verified devices for reporting
// NOTE: Must be defined BEFORE /:case_id to avoid Express matching "my-devices" as a case_id
router.get('/my-devices', async (req, res) => {
  try {
    const userId = req.user.id;
    const devices = await Database.query(`
      SELECT id, brand, model, imei, serial, color, category, 
             device_image_url, verified_at, created_at
      FROM devices 
      WHERE user_id = ? AND status = 'verified'
      ORDER BY created_at DESC
    `, [userId]);

    res.json({ data: devices });
  } catch (error) {
    console.error('Error fetching user devices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/report-management/:case_id - Get specific report
router.get('/:case_id', async (req, res) => {
  try {
    const caseId = req.params.case_id;
    const userId = req.user.id;
    const userRole = req.user.role;

    let whereClause = 'r.case_id = ?';
    let whereParams = [caseId];

    // Non-admin users can only see their own reports
    if (userRole !== 'admin' && userRole !== 'lea') {
      whereClause += ' AND r.reporter_id = ?';
      whereParams.push(userId);
    }

    const report = await Database.queryOne(`
      SELECT 
        r.*,
        d.brand,
        d.model,
        d.imei,
        d.serial,
        u.name as reporter_name,
        u.first_name as reporter_first_name,
        u.middle_name as reporter_middle_name,
        u.last_name as reporter_last_name,
        u.email as reporter_email,
        lea.agency_name,
        lea.contact_email as lea_email
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      LEFT JOIN users u ON r.reporter_id = u.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE ${whereClause}
    `, whereParams);

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(report);
  } catch (error) {
    console.error('Error fetching report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/report-management - Create new report (redesigned flow)
router.post('/', async (req, res) => {
  try {
    const { 
      device_id, report_type, description, occurred_at, location,
      evidence_url, police_report_number, circumstances, witness_info,
      nin, pay_by_pass 
    } = req.body;
    const userId = req.user.id;

    // === VALIDATION ===
    if (!device_id || !report_type || !description || !occurred_at) {
      return res.status(400).json({ 
        error: 'device_id, report_type, description, and occurred_at are required' 
      });
    }

    if (!['stolen', 'lost', 'found'].includes(report_type)) {
      return res.status(400).json({ 
        error: 'report_type must be stolen, lost, or found' 
      });
    }

    // === DEVICE OWNERSHIP ENFORCEMENT (server-side) ===
    // Must be user's own registered + verified device
    const device = await Database.selectOne(
      'devices',
      'id, user_id, status, brand, model, imei, serial, color',
      'id = ?',
      [device_id]
    );

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (device.user_id !== userId) {
      return res.status(403).json({ error: 'You can only report devices you own' });
    }

    if (device.status !== 'verified') {
      return res.status(400).json({ 
        error: 'Only verified devices can be reported. Please verify your device first.' 
      });
    }

    // === DUPLICATE REPORT CHECK ===
    const existingReport = await Database.selectOne(
      'reports',
      'id, case_id',
      'device_id = ? AND status IN (?, ?)',
      [device_id, 'open', 'under_review']
    );

    if (existingReport) {
      return res.status(409).json({ 
        error: 'This device already has an active report',
        existingCaseId: existingReport.case_id
      });
    }

    // === FRAUD CHECK ===
    const fraudCheck = await FraudDetectionService.checkAndFlag(userId, 'REPORT_DEVICE', {
      ipAddress: req.clientIp,
      macAddress: req.macAddress,
      device_id
    });
    if (fraudCheck.blocked) {
      return res.status(403).json({ error: 'Reporting blocked due to security concerns. Contact support.' });
    }

    // === REPORT COUNT & PAYMENT DETERMINATION (per-user, not per-device) ===
    const paymentInfo = await RevenueService.shouldChargeForUserReport(userId);
    const reportNumber = paymentInfo.reportNumber;

    // === KYC CHECK (only needed for first report if not already verified) ===
    const isKycVerified = await IdentityMatchingService.isUserKycVerified(userId);

    if (paymentInfo.requiresPayment) {
      // Payment is required for this report
      if (!pay_by_pass) {
        // Return payment required response
        const reference = `RPT-${userId.slice(0, 8)}-${Date.now()}`;
        const invoiceId = await RevenueService.createPaymentInvoice(
          userId, paymentInfo.amount, 'report_verification',
          reference,
          { device_id, report_type, reportNumber }
        );
        return res.json({
          requiresPayment: true,
          invoiceId,
          reference,
          amount: paymentInfo.amount,
          currency: paymentInfo.currency,
          purpose: 'Report Verification Fee',
          reportNumber,
          kycRequired: !isKycVerified,
          message: paymentInfo.reason
        });
      }

      // Payment token provided — verify it was successful
      // (The pay_by_pass token is validated by the payment callback system)
    }

    // === FIRST REPORT + NOT KYC VERIFIED: require NIN ===
    if (!isKycVerified) {
      if (!nin || !/^\d{11}$/.test(nin)) {
        return res.status(400).json({
          requiresNin: true,
          error: 'NIN is required for identity verification on your first report',
          message: 'Please provide your 11-digit National Identification Number (NIN)'
        });
      }

      // Perform KYC verification (calls Prembly, saves result)
      const kycResult = await IdentityMatchingService.performKycVerification(userId, nin, null);

      if (!kycResult.success) {
        return res.status(400).json({
          kycFailed: true,
          error: kycResult.message,
          message: 'Identity verification failed. Your report cannot be submitted at this time.',
          details: 'The information retrieved from our verification partner could not be sufficiently matched with your account details. Please ensure your account name matches your NIN registration.'
        });
      }
    }

    // === CREATE REPORT ===
    const user = await Database.selectOne('users', 'region', 'id = ?', [userId]);
    const userRegion = user?.region || 'default';

    // Find appropriate LEA
    const lea = await Database.selectOne(
      'law_enforcement_agencies',
      'id',
      'region = ? AND active = 1',
      [userRegion]
    );

    const caseId = Database.generateCaseId();
    const reportId = Database.generateUUID();

    // Determine payment status
    let paymentStatus = 'free';
    if (paymentInfo.requiresPayment && pay_by_pass) {
      paymentStatus = 'completed';
    } else if (paymentInfo.requiresPayment) {
      paymentStatus = 'pending';
    }

    await Database.transaction(async (connection) => {
      await connection.execute(
        `INSERT INTO reports (
          id, device_id, report_type, reporter_id, description, occurred_at,
          location, evidence_url, status, case_id, assigned_lea_id,
          police_report_number, circumstances, witness_info,
          payment_status, payment_reference, payment_amount, report_number,
          kyc_performed, kyc_result,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reportId, device_id, report_type, userId, description, new Date(occurred_at),
          location || null, evidence_url || null, 'open', caseId, lea?.id || null,
          police_report_number || null, circumstances || null, witness_info || null,
          paymentStatus, pay_by_pass || null, paymentInfo.amount || null, reportNumber,
          !isKycVerified && !!nin, isKycVerified ? 'skipped' : 'verified',
          new Date(), new Date()
        ]
      );

      // Update device status
      if (report_type === 'stolen' || report_type === 'lost') {
        await connection.execute(
          'UPDATE devices SET status = ?, updated_at = ? WHERE id = ?',
          [report_type, new Date(), device_id]
        );
      }
    });

    // Mark payment invoice as paid if applicable
    if (paymentStatus === 'completed' && pay_by_pass) {
      await RevenueService.markInvoicePaid(pay_by_pass);
      await RevenueService.chargeForReport(userId, paymentInfo.amount, reportId, pay_by_pass);
    }

    // Check if device was previously reported
    const previousReport = await Database.selectOne(
      'reports',
      'id',
      'device_id = ? AND id != ?',
      [device_id, reportId]
    );
    const previouslyReported = !!previousReport;

    // === NOTIFICATIONS (conditional SMS vs email) ===
    try {
      const userDetails = await Database.selectOne(
        'users', 'name, first_name, middle_name, last_name, email, phone', 'id = ?', [userId]
      );

      if (previouslyReported) {
        // Device already reported before → SMS to owner
        if (userDetails?.phone) {
          const smsMessage = `Dear ${getDisplayName(userDetails)}, your ${device.brand} ${device.model} (${device.imei || device.serial || 'N/A'}) has been reported ${report_type} again. Case ID: ${caseId}. Report #${reportNumber}. View details: ${process.env.FRONTEND_URL || 'http://localhost:5173'}/reports`;
          await TermiiService.sendSMS(userDetails.phone, smsMessage);
        }
      } else {
        // First report for this device → Email to owner + admin + LEA
        const reportSubject = `Device Reported ${report_type.charAt(0).toUpperCase() + report_type.slice(1)} — Case ${caseId}`;
        const reportMessage = `
          <p>Hello <strong>${getDisplayName(userDetails) || 'User'}</strong>,</p>
          <p>Your <strong>${report_type}</strong> report has been filed successfully.</p>
          <div style="background: #F3F4F6; border-radius: 8px; padding: 16px; margin: 15px 0;">
            <table cellpadding="4" cellspacing="0" style="font-size: 14px; color: #374151;">
              <tr><td style="font-weight: 600; padding-right: 12px;">Case ID:</td><td>${caseId}</td></tr>
              <tr><td style="font-weight: 600; padding-right: 12px;">Device:</td><td>${device.brand} ${device.model}</td></tr>
              <tr><td style="font-weight: 600; padding-right: 12px;">IMEI:</td><td>${device.imei || 'N/A'}</td></tr>
              <tr><td style="font-weight: 600; padding-right: 12px;">Report #:</td><td>${reportNumber}</td></tr>
              <tr><td style="font-weight: 600; padding-right: 12px;">Status:</td><td>Open</td></tr>
            </table>
          </div>
          <p>Law enforcement has been notified and will review your case.</p>
        `;
        const wrappedHtml = EmailTemplate.wrapContent(reportSubject, reportMessage);
        await NotificationService.queueNotification(
          userId, 'email', userDetails.email, reportSubject, wrappedHtml,
          { caseId, type: 'report_filed', deviceInfo: `${device.brand} ${device.model}` }
        );

        // Notify LEA
        if (lea) {
          await NotificationService.notifyLEANewCase(lea.id, {
            case_id: caseId,
            report_type,
            device_brand: device.brand,
            device_model: device.model,
            device_imei: device.imei || null,
            location: location || 'Not specified',
            occurred_at
          });
        }
      }
    } catch (notifyErr) {
      console.error('Failed to queue report notifications:', notifyErr);
    }

    // === AUDIT LOG ===
    await SecurityService.logCriticalAction(userId, 'REPORT_DEVICE', {
      success: true,
      deviceId: device_id,
      reference: reportId,
      ipAddress: req.clientIp,
      userAgent: req.userAgent,
      macAddress: req.macAddress,
      oldValues: null,
      newValues: { 
        report_type, case_id: caseId, report_number: reportNumber,
        payment_status: paymentStatus, kyc_performed: !isKycVerified && !!nin,
        device_previously_reported: !!previousReport
      },
      executionTime: 0
    });

    // Return the created report
    const report = await Database.queryOne(`
      SELECT 
        r.*,
        d.brand, d.model, d.imei, d.serial, d.color,
        lea.agency_name, lea.contact_email as lea_email
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE r.id = ?
    `, [reportId]);

    res.status(201).json(report);
  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/report-management/:case_id - Update report (LEA/Admin only)
router.put('/:case_id', async (req, res) => {
  try {
    const caseId = req.params.case_id;
    const userId = req.user.id;
    const userRole = req.user.role;
    const updateData = req.body;

    if (userRole !== 'admin' && userRole !== 'lea') {
      return res.status(403).json({ 
        error: 'Only administrators and law enforcement can update reports' 
      });
    }

    // Get existing report
    const existingReport = await Database.selectOne(
      'reports',
      '*',
      'case_id = ?',
      [caseId]
    );

    if (!existingReport) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Update report
    updateData.updated_at = new Date();
    await Database.update('reports', updateData, 'case_id = ?', [caseId]);

    // Log audit
    await Database.logAudit(
      userId,
      'UPDATE',
      'reports',
      existingReport.id,
      { status: existingReport.status },
      { status: updateData.status },
      req.ip
    );

    // Get updated report
    const report = await Database.queryOne(`
      SELECT 
        r.*,
        d.brand,
        d.model,
        d.imei,
        d.serial,
        lea.agency_name,
        lea.contact_email as lea_email
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE r.case_id = ?
    `, [caseId]);

    res.json(report);
  } catch (error) {
    console.error('Error updating report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;