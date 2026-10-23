// Report Management Routes - MySQL Version
const express = require('express');
const { escapeHtml } = require('../utils/escape-html');
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
const IdentityService = require('../services/IdentityService');
const CustodyService = require('../services/CustodyService');

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
      WHERE user_id = ? AND status = 'verified' AND deleted_at IS NULL
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

    if (device.user_id !== userId && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
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

    // === 1. PAYMENT: every report pays the admin's report verification fee ===
    // The payment is checked here but only used up once the report is
    // created, so a failed identity check never wastes it.
    const paymentInfo = await RevenueService.shouldChargeForUserReport(userId);
    const reportNumber = paymentInfo.reportNumber;
    let paidInvoice = null;
    if (paymentInfo.requiresPayment) {
      if (!pay_by_pass) {
        return res.json({
          requiresPayment: true,
          amount: paymentInfo.amount,
          currency: paymentInfo.currency,
          feeType: 'report_verification_fee',
          purpose: 'Report verification fee',
          reportNumber,
          message: 'Pay the report fee, then confirm your identity to file this report.'
        });
      }
      paidInvoice = await RevenueService.findPaidInvoice(userId, pay_by_pass, ['report_verification_fee']);
      if (!paidInvoice) {
        return res.status(402).json({
          requiresPayment: true,
          amount: paymentInfo.amount,
          feeType: 'report_verification_fee',
          error: 'We could not confirm your payment for this report. If you were charged, contact support with your payment reference.'
        });
      }
    }

    // === 2. IDENTITY: confirmed on every report ===
    // People confirm with their NIN; business accounts may use their NIN or
    // their CAC registration number. (Prembly is only used the first time a
    // number is seen; this route never says which.)
    const { rc_number } = req.body;
    const isBusiness = req.user.role === 'business';
    if (!nin && !(isBusiness && rc_number)) {
      return res.status(400).json({
        requiresNin: true,
        paid: !!paidInvoice,
        error: isBusiness ? 'Enter your NIN or your business registration number.' : 'Enter your 11-digit NIN to confirm your identity.'
      });
    }
    try {
      if (nin) await IdentityService.confirmNin(userId, nin, 'report');
      else await IdentityService.confirmBusiness(userId, rc_number, 'report');
    } catch (e) {
      if (!(e instanceof IdentityService.IdentityError)) throw e;
      return res.status(e.status || 400).json({ identityFailed: true, paid: !!paidInvoice, error: e.message });
    }

    // === 3. USE THE PAYMENT (once, just before the report is created) ===
    if (paidInvoice) {
      const used = await RevenueService.redeemPaidInvoice(userId, paidInvoice.reference, ['report_verification_fee']);
      if (!used) {
        return res.status(402).json({ requiresPayment: true, amount: paymentInfo.amount, feeType: 'report_verification_fee', error: 'This payment has already been used for another report. Please pay for this report.' });
      }
    }
    const isKycVerified = true;

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
    const paymentStatus = paidInvoice ? 'completed' : 'free';

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
          paymentStatus, paidInvoice ? paidInvoice.reference : null, paidInvoice ? paymentInfo.amount : null, reportNumber,
          true, 'verified',
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
    if (paidInvoice) {
      await RevenueService.chargeForReport(userId, paymentInfo.amount, reportId, paidInvoice.reference);
    }

    // ProveOwnership holds a stolen/lost item until the owner pays to release it
    if (report_type === 'stolen' || report_type === 'lost') {
      await CustodyService.hold(device_id, reportId, device.user_id).catch((e) => console.error('Custody hold failed:', e.message));
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
              <tr><td style="font-weight: 600; padding-right: 12px;">Device:</td><td>${escapeHtml(device.brand)} ${escapeHtml(device.model)}</td></tr>
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
        payment_status: paymentStatus, kyc_performed: true,
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
    if (!['admin', 'super_admin', 'lea'].includes(userRole)) {
      return res.status(403).json({ 
        error: 'Only administrators and law enforcement can update reports' 
      });
    }

    // Only case-handling fields can be changed; assignment is admin-only.
    const updateData = Database.pick(req.body, ['status', 'police_report_number', 'circumstances', 'witness_info', 'location']);
    if (userRole !== 'lea' && req.body.assigned_lea_id !== undefined) {
      updateData.assigned_lea_id = req.body.assigned_lea_id || null;
    }
    const validStatuses = ['open', 'under_review', 'resolved', 'dismissed'];
    if (updateData.status !== undefined && !validStatuses.includes(updateData.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No editable fields supplied' });
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

    // Police may only update cases in their own region
    if (userRole === 'lea') {
      const inRegion = await Database.queryOne(
        `SELECT r.id FROM reports r JOIN devices d ON r.device_id = d.id JOIN users u ON d.user_id = u.id
         WHERE r.id = ? AND u.region = ?`,
        [existingReport.id, req.user.region]
      );
      if (!inRegion) {
        return res.status(403).json({ error: 'This case is outside your region' });
      }
    }

    // Update report
    updateData.updated_at = new Date();
    await Database.update('reports', updateData, 'case_id = ?', [caseId]);
    await CustodyService.onCaseStatus(existingReport, updateData.status, userId);

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
