// Report Management Routes - MySQL Version
const express = require('express');
const Database = require('../config');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/report-management - List user's reports
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, report_type } = req.query;

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
    `, whereParams);

    res.json(reports);
  } catch (error) {
    console.error('Error fetching reports:', error);
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

// POST /api/report-management - Create new report
router.post('/', async (req, res) => {
  try {
    const { device_id, report_type, description, occurred_at, location, evidence_url } = req.body;
    const userId = req.user.id;

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

    // Verify device ownership (except for found reports)
    if (report_type !== 'found') {
      const device = await Database.selectOne(
        'devices',
        'user_id, status',
        'id = ?',
        [device_id]
      );

      if (!device || device.user_id !== userId) {
        return res.status(404).json({ 
          error: 'Device not found or unauthorized' 
        });
      }

      // Check if device already has an active report
      const existingReport = await Database.selectOne(
        'reports',
        'id',
        'device_id = ? AND status = ?',
        [device_id, 'open']
      );

      if (existingReport) {
        return res.status(409).json({ 
          error: 'Device already has an active report' 
        });
      }
    }

    // Get user's region for LEA assignment
    const user = await Database.selectOne('users', 'region', 'id = ?', [userId]);
    const userRegion = user?.region || 'default';

    // Find appropriate LEA
    const lea = await Database.selectOne(
      'law_enforcement_agencies',
      'id',
      'region = ? AND active = 1',
      [userRegion]
    );

    // Generate case ID
    const caseId = Database.generateCaseId();

    // Create report
    const reportId = Database.generateUUID();
    const reportData = {
      id: reportId,
      device_id,
      report_type,
      reporter_id: userId,
      description,
      occurred_at: new Date(occurred_at),
      location: location || null,
      evidence_url: evidence_url || null,
      status: 'open',
      case_id: caseId,
      assigned_lea_id: lea?.id || null,
      created_at: new Date(),
      updated_at: new Date()
    };

    await Database.transaction(async (connection) => {
      // Insert report with explicit columns to avoid SQL syntax errors
      await connection.execute(
        `INSERT INTO reports (
          id, device_id, report_type, reporter_id, description, occurred_at,
          location, evidence_url, status, case_id, assigned_lea_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reportData.id,
          reportData.device_id,
          reportData.report_type,
          reportData.reporter_id,
          reportData.description,
          reportData.occurred_at,
          reportData.location,
          reportData.evidence_url,
          reportData.status,
          reportData.case_id,
          reportData.assigned_lea_id,
          reportData.created_at,
          reportData.updated_at
        ]
      );

      // Update device status
      if (report_type === 'stolen' || report_type === 'lost') {
        await connection.execute(
          'UPDATE devices SET status = ?, updated_at = ? WHERE id = ?',
          [report_type, new Date(), device_id]
        );
      }

      // Queue notifications (use notification_queue table for compatibility)
      const notificationQueue = [];

      // Queue reporter email
      notificationQueue.push({
        id: Database.generateUUID(),
        user_id: userId,
        notification_type: 'email',
        subject: `Report Filed - Case ${caseId}`,
        message: `Your ${report_type} report has been filed with case ID ${caseId}`,
        html_content: null,
        recipient: req.user.email,
        status: 'pending',
        attempts: 0,
        max_attempts: 3,
        scheduled_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      });

      // Queue LEA email if assigned
      if (lea) {
        const leaDetails = await Database.selectOne(
          'law_enforcement_agencies',
          'contact_email',
          'id = ?',
          [lea.id]
        );

        notificationQueue.push({
          id: Database.generateUUID(),
          user_id: null,
          notification_type: 'email',
          subject: `New ${report_type} Report - Case ${caseId}`,
          message: `A new ${report_type} report has been filed in your jurisdiction`,
          html_content: null,
          recipient: leaDetails.contact_email,
          status: 'pending',
          attempts: 0,
          max_attempts: 3,
          scheduled_at: new Date(),
          created_at: new Date(),
          updated_at: new Date()
        });
      }

      // Insert notifications; prefer notification_queue, fallback to system_notifications
      for (const item of notificationQueue) {
        try {
          await connection.execute(
            `INSERT INTO notification_queue (
              id, user_id, notification_type, subject, message, html_content,
              recipient, status, attempts, max_attempts, scheduled_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              item.id,
              item.user_id,
              item.notification_type,
              item.subject,
              item.message,
              item.html_content,
              item.recipient,
              item.status,
              item.attempts,
              item.max_attempts,
              item.scheduled_at,
              item.created_at,
              item.updated_at
            ]
          );
        } catch (err) {
          // Fallback to system_notifications schema
          try {
            const isUser = !!item.user_id;
            await connection.execute(
              `INSERT INTO system_notifications (
                id, recipient_user_id, recipient_role, recipient_region, notification_type,
                title, message, priority, device_id, report_id,
                send_email, send_sms, send_push, action_url, action_text,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                Database.generateUUID(),
                isUser ? item.user_id : null,
                isUser ? 'user' : 'lea',
                isUser ? null : userRegion,
                'device_report',
                item.subject,
                item.message,
                'medium',
                device_id,
                reportId,
                1,
                0,
                1,
                `/reports/${caseId}`,
                'View case',
                new Date(),
                new Date()
              ]
            );
          } catch (fallbackErr) {
            console.warn('Notification insert failed (both queue and system):', fallbackErr.message);
          }
        }
      }
    });

    // Get the created report with details
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