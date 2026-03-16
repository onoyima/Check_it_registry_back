// LEA (Law Enforcement Agency) Portal Routes
const express = require('express');
const Database = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');
const NotificationService = require('../services/NotificationService');

const router = express.Router();

// Middleware: Require LEA role
router.use(authenticateToken);
router.use(requireRole(['lea', 'admin']));

// Get LEA dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.id;
    const userRegion = req.user.region;

    // Get LEA agency info
    const leaAgency = await Database.selectOne(
      'law_enforcement_agencies',
      '*',
      'region = ? AND active = TRUE',
      [userRegion]
    );

    if (!leaAgency && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'No LEA agency found for your region' });
    }

    // Build region filter for queries
    const regionFilter = req.user.role === 'admin' ? '' : 'AND u.region = ?';
    const regionParams = req.user.role === 'admin' ? [] : [userRegion];

    // Get case statistics
    const stats = await Database.query(`
      SELECT 
        COUNT(*) as total_cases,
        SUM(CASE WHEN r.status = 'open' THEN 1 ELSE 0 END) as open_cases,
        SUM(CASE WHEN r.status = 'under_review' THEN 1 ELSE 0 END) as under_review_cases,
        SUM(CASE WHEN r.status = 'resolved' THEN 1 ELSE 0 END) as resolved_cases,
        SUM(CASE WHEN r.report_type = 'stolen' THEN 1 ELSE 0 END) as stolen_reports,
        SUM(CASE WHEN r.report_type = 'lost' THEN 1 ELSE 0 END) as lost_reports,
        SUM(CASE WHEN r.report_type = 'found' THEN 1 ELSE 0 END) as found_reports
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE r.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      ${regionFilter}
    `, regionParams);

    // Get recent activity
    const recentActivity = await Database.query(`
      SELECT 
        r.id,
        r.case_id,
        r.report_type,
        r.status,
        r.created_at,
        r.updated_at,
        d.brand,
        d.model,
        d.imei,
        u.name as owner_name,
        u.region
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE r.updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ${regionFilter}
      ORDER BY r.updated_at DESC
      LIMIT 10
    `, regionParams);

    res.json({
      agency: leaAgency,
      stats: stats[0],
      recent_activity: recentActivity
    });

  } catch (error) {
    console.error('LEA stats error:', error);
    res.status(500).json({ error: 'Failed to load LEA dashboard stats' });
  }
});

// GET /api/lea-portal/reported-devices - Devices with active reports (restricted by region unless admin)
router.get('/reported-devices', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const regionFilter = req.user.role === 'admin' ? '' : 'AND u.region = ?';
    const regionParams = req.user.role === 'admin' ? [] : [req.user.region];

    const rows = await Database.query(`
      SELECT 
        d.id,
        d.brand,
        d.model,
        d.imei,
        d.serial,
        d.status,
        u.name AS owner_name,
        u.email AS owner_email,
        u.phone AS owner_phone,
        u.region AS owner_region,
        MAX(r.created_at) AS latest_report_at,
        SUBSTRING_INDEX(GROUP_CONCAT(r.report_type ORDER BY r.created_at DESC), ',', 1) AS latest_report_type,
        COUNT(*) AS report_count
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE r.status IN ('open','under_review')
      ${regionFilter}
      GROUP BY d.id
      ORDER BY latest_report_at DESC
      LIMIT ? OFFSET ?
    `, [...regionParams, parseInt(limit), parseInt(offset)]);

    const totalQuery = await Database.query(`
      SELECT COUNT(DISTINCT r.device_id) AS count
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE r.status IN ('open','under_review')
      ${regionFilter}
    `, regionParams);

    const total = totalQuery[0]?.count || 0;

    res.json({
      devices: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('LEA reported devices error:', error);
    res.status(500).json({ error: 'Failed to load reported devices' });
  }
});

// GET /api/lea-portal/alerts/device-checks - Recent checks on reported devices (region restricted)
router.get('/alerts/device-checks', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const regionFilter = req.user.role === 'admin' ? '' : 'AND owner.region = ?';
    const regionParams = req.user.role === 'admin' ? [] : [req.user.region];

    const rows = await Database.query(`
      SELECT 
        dcl.*, 
        d.brand, d.model, d.imei, d.serial,
        owner.name AS owner_name, owner.email AS owner_email, owner.phone AS owner_phone, owner.region AS owner_region,
        checker.name AS checker_name, checker.email AS checker_email, checker.phone AS checker_phone
      FROM device_check_logs dcl
      LEFT JOIN devices d ON dcl.device_id = d.id
      LEFT JOIN users owner ON d.user_id = owner.id
      LEFT JOIN users checker ON dcl.checker_user_id = checker.id
      LEFT JOIN reports r ON r.device_id = d.id AND r.status IN ('open','under_review')
      WHERE r.id IS NOT NULL
      ${regionFilter}
      ORDER BY dcl.created_at DESC
      LIMIT ?
    `, [...regionParams, parseInt(limit)]);

    res.json({ alerts: rows });
  } catch (error) {
    console.error('LEA device check alerts error:', error);
    res.status(500).json({ error: 'Failed to load device check alerts' });
  }
});

// Get assigned cases
router.get('/cases', async (req, res) => {
  try {
    const userId = req.user.id;
    const userRegion = req.user.region;
    const { status, type, page = 1, limit = 20 } = req.query;

    // Build filters
    let whereClause = '1=1';
    let params = [];

    // Region filter (admin can see all)
    if (req.user.role !== 'admin') {
      whereClause += ' AND u.region = ?';
      params.push(userRegion);
    }

    if (status) {
      whereClause += ' AND r.status = ?';
      params.push(status);
    }

    if (type) {
      whereClause += ' AND r.report_type = ?';
      params.push(type);
    }

    const offset = (page - 1) * limit;

    // Get cases with pagination
    const cases = await Database.query(`
      SELECT 
        r.id,
        r.case_id,
        r.report_type,
        r.status,
        r.description,
        r.occurred_at,
        r.location,
        r.evidence_url,
        r.lea_notes,
        r.created_at,
        r.updated_at,
        d.brand,
        d.model,
        d.imei,
        d.serial,
        d.color,
        u.name as owner_name,
        u.email as owner_email,
        u.phone as owner_phone,
        u.region,
        lea.agency_name,
        reporter.name as reporter_name,
        reporter.email as reporter_email
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      LEFT JOIN users reporter ON r.reporter_id = reporter.id
      WHERE ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    // Get total count
    const totalResult = await Database.query(`
      SELECT COUNT(*) as total
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE ${whereClause}
    `, params);

    const total = totalResult[0].total;

    res.json({
      cases,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('LEA cases error:', error);
    res.status(500).json({ error: 'Failed to load cases' });
  }
});

// Get device details for LEA
router.get('/devices/:id', async (req, res) => {
  try {
    const deviceId = req.params.id;
    const userRegion = req.user.region;

    // Region filter: admin can see all, LEA restricted to their region (by device owner region)
    const regionFilter = req.user.role === 'admin' ? '' : 'AND u.region = ?';
    const regionParams = req.user.role === 'admin' ? [] : [userRegion];

    // Device with owner info
    const deviceRows = await Database.query(`
      SELECT 
        d.*, 
        u.id as owner_id,
        u.name as owner_name,
        u.email as owner_email,
        u.phone as owner_phone,
        u.region as owner_region
      FROM devices d
      JOIN users u ON d.user_id = u.id
      WHERE d.id = ?
      ${regionFilter}
    `, [deviceId, ...regionParams]);

    if (!deviceRows || deviceRows.length === 0) {
      return res.status(404).json({ error: 'Device not found or access denied' });
    }

    const device = deviceRows[0];

    // Associated reports
    const reports = await Database.query(`
      SELECT 
        r.id,
        r.case_id,
        r.report_type,
        r.status,
        r.description,
        r.created_at,
        reporter.name as reporter_name,
        reporter.email as reporter_email
      FROM reports r
      LEFT JOIN users reporter ON r.reporter_id = reporter.id
      WHERE r.device_id = ?
      ORDER BY r.created_at DESC
    `, [deviceId]);

    // Transfer history
    const transfers = await Database.query(`
      SELECT 
        dt.*,
        u_from.name as from_user_name,
        u_to.name as to_user_name
      FROM device_transfers dt
      LEFT JOIN users u_from ON dt.from_user_id = u_from.id
      LEFT JOIN users u_to ON dt.to_user_id = u_to.id
      WHERE dt.device_id = ?
      ORDER BY dt.created_at DESC
    `, [deviceId]);

    // Verification history
    const verification_history = await Database.query(`
      SELECT 
        dv.*,
        uver.name as verified_by_name
      FROM device_verifications dv
      LEFT JOIN users uver ON dv.verified_by = uver.id
      WHERE dv.device_id = ?
      ORDER BY dv.created_at DESC
    `, [deviceId]);

    // Audit logs for this device
    const activity_logs = await Database.query(`
      SELECT 
        al.*,
        ulog.name as user_name
      FROM audit_logs al
      LEFT JOIN users ulog ON al.user_id = ulog.id
      WHERE al.table_name = 'devices' AND al.record_id = ?
      ORDER BY al.created_at DESC
      LIMIT 50
    `, [deviceId]);

    res.json({
      device,
      reports,
      transfers,
      verification_history,
      activity_logs
    });

  } catch (error) {
    console.error('LEA device details error:', error);
    res.status(500).json({ error: 'Failed to load device details' });
  }
});

// Get case details
router.get('/cases/:caseId', async (req, res) => {
  try {
    const { caseId } = req.params;
    const userRegion = req.user.region;

    // Build region filter
    const regionFilter = req.user.role === 'admin' ? '' : 'AND u.region = ?';
    const regionParams = req.user.role === 'admin' ? [] : [userRegion];

    const caseDetails = await Database.query(`
      SELECT 
        r.*,
        d.brand,
        d.model,
        d.imei,
        d.serial,
        d.color,
        d.device_image_url,
        d.proof_url,
        u.name as owner_name,
        u.email as owner_email,
        u.phone as owner_phone,
        u.region,
        lea.agency_name,
        lea.contact_email as lea_email,
        lea.contact_phone as lea_phone,
        reporter.name as reporter_name,
        reporter.email as reporter_email,
        reporter.phone as reporter_phone
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      LEFT JOIN users reporter ON r.reporter_id = reporter.id
      WHERE r.case_id = ?
      ${regionFilter}
    `, [caseId, ...regionParams]);

    if (caseDetails.length === 0) {
      return res.status(404).json({ error: 'Case not found or access denied' });
    }

    // Get case history/audit logs
    const caseHistory = await Database.query(`
      SELECT 
        al.*,
        u.name as user_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.table_name = 'reports' AND al.record_id = ?
      ORDER BY al.created_at DESC
    `, [caseDetails[0].id]);

    res.json({
      case: caseDetails[0],
      history: caseHistory
    });

  } catch (error) {
    console.error('LEA case details error:', error);
    res.status(500).json({ error: 'Failed to load case details' });
  }
});

// Update case status
router.put('/cases/:caseId/status', async (req, res) => {
  try {
    const { caseId } = req.params;
    const { status, notes } = req.body;
    const userId = req.user.id;
    const userRegion = req.user.region;

    // Validate status
    const validStatuses = ['open', 'under_review', 'resolved', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Get case details first
    const regionFilter = req.user.role === 'admin' ? '' : 'AND u.region = ?';
    const regionParams = req.user.role === 'admin' ? [] : [userRegion];

    const caseDetails = await Database.query(`
      SELECT r.*, d.user_id, d.brand, d.model, u.region
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE r.case_id = ?
      ${regionFilter}
    `, [caseId, ...regionParams]);

    if (caseDetails.length === 0) {
      return res.status(404).json({ error: 'Case not found or access denied' });
    }

    const reportCase = caseDetails[0];

    // Update case
    await Database.update('reports', {
      status: status,
      lea_notes: notes || reportCase.lea_notes,
      updated_at: new Date()
    }, 'case_id = ?', [caseId]);

    // Log audit trail
    await Database.logAudit(
      userId,
      'UPDATE_CASE_STATUS',
      'reports',
      reportCase.id,
      { status: reportCase.status },
      { status: status, notes: notes },
      req.ip
    );

    // Send notification to device owner
    if (status === 'resolved') {
      await NotificationService.queueNotification(
        reportCase.user_id,
        'email',
        await Database.selectOne('users', 'email', 'id = ?', [reportCase.user_id]).then(u => u.email),
        `Case Update - ${caseId}`,
        `
          <h2>Case Status Update</h2>
          <p>Your case <strong>${caseId}</strong> has been marked as resolved.</p>
          <p><strong>Device:</strong> ${reportCase.brand} ${reportCase.model}</p>
          ${notes ? `<p><strong>LEA Notes:</strong> ${notes}</p>` : ''}
          <p>Thank you for using Check It Device Registry.</p>
        `,
        { caseId: caseId, type: 'case_resolved' }
      );
    }

    res.json({ 
      success: true, 
      message: 'Case status updated successfully',
      case_id: caseId,
      new_status: status
    });

  } catch (error) {
    console.error('LEA case update error:', error);
    res.status(500).json({ error: 'Failed to update case status' });
  }
});

// Add case notes
router.post('/cases/:caseId/notes', async (req, res) => {
  try {
    const { caseId } = req.params;
    const { notes } = req.body;
    const userId = req.user.id;
    const userRegion = req.user.region;

    if (!notes || notes.trim().length === 0) {
      return res.status(400).json({ error: 'Notes cannot be empty' });
    }

    // Get case details first
    const regionFilter = req.user.role === 'admin' ? '' : 'AND u.region = ?';
    const regionParams = req.user.role === 'admin' ? [] : [userRegion];

    const caseDetails = await Database.query(`
      SELECT r.*, u.region
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE r.case_id = ?
      ${regionFilter}
    `, [caseId, ...regionParams]);

    if (caseDetails.length === 0) {
      return res.status(404).json({ error: 'Case not found or access denied' });
    }

    const reportCase = caseDetails[0];
    const existingNotes = reportCase.lea_notes || '';
    const timestamp = new Date().toISOString();
    const newNote = `[${timestamp}] ${req.user.name}: ${notes.trim()}`;
    const updatedNotes = existingNotes ? `${existingNotes}\n\n${newNote}` : newNote;

    // Update case with new notes
    await Database.update('reports', {
      lea_notes: updatedNotes,
      updated_at: new Date()
    }, 'case_id = ?', [caseId]);

    // Log audit trail
    await Database.logAudit(
      userId,
      'ADD_CASE_NOTES',
      'reports',
      reportCase.id,
      null,
      { notes: newNote },
      req.ip
    );

    res.json({ 
      success: true, 
      message: 'Notes added successfully',
      case_id: caseId
    });

  } catch (error) {
    console.error('LEA add notes error:', error);
    res.status(500).json({ error: 'Failed to add case notes' });
  }
});

// Get regional statistics
router.get('/regional-stats', async (req, res) => {
  try {
    const userRegion = req.user.region;

    // Admin can see all regions, LEA only their region
    const regionFilter = req.user.role === 'admin' ? '' : 'WHERE u.region = ?';
    const regionParams = req.user.role === 'admin' ? [] : [userRegion];

    const regionalStats = await Database.query(`
      SELECT 
        u.region,
        COUNT(DISTINCT d.id) as total_devices,
        COUNT(DISTINCT r.id) as total_reports,
        SUM(CASE WHEN r.report_type = 'stolen' THEN 1 ELSE 0 END) as stolen_count,
        SUM(CASE WHEN r.report_type = 'lost' THEN 1 ELSE 0 END) as lost_count,
        SUM(CASE WHEN r.report_type = 'found' THEN 1 ELSE 0 END) as found_count,
        SUM(CASE WHEN r.status = 'resolved' THEN 1 ELSE 0 END) as resolved_count
      FROM users u
      LEFT JOIN devices d ON u.id = d.user_id
      LEFT JOIN reports r ON d.id = r.device_id
      ${regionFilter}
      GROUP BY u.region
      ORDER BY total_reports DESC
    `, regionParams);

    res.json({ regional_stats: regionalStats });

  } catch (error) {
    console.error('LEA regional stats error:', error);
    res.status(500).json({ error: 'Failed to load regional statistics' });
  }
});

// Export cases (CSV format)
router.get('/export/cases', async (req, res) => {
  try {
    const userRegion = req.user.region;
    const { status, type, start_date, end_date } = req.query;

    // Build filters
    let whereClause = '1=1';
    let params = [];

    // Region filter
    if (req.user.role !== 'admin') {
      whereClause += ' AND u.region = ?';
      params.push(userRegion);
    }

    if (status) {
      whereClause += ' AND r.status = ?';
      params.push(status);
    }

    if (type) {
      whereClause += ' AND r.report_type = ?';
      params.push(type);
    }

    if (start_date) {
      whereClause += ' AND r.created_at >= ?';
      params.push(start_date);
    }

    if (end_date) {
      whereClause += ' AND r.created_at <= ?';
      params.push(end_date);
    }

    const cases = await Database.query(`
      SELECT 
        r.case_id,
        r.report_type,
        r.status,
        r.occurred_at,
        r.location,
        r.created_at,
        d.brand,
        d.model,
        d.imei,
        d.serial,
        u.name as owner_name,
        u.region,
        lea.agency_name
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE ${whereClause}
      ORDER BY r.created_at DESC
    `, params);

    // Generate CSV
    const csvHeader = 'Case ID,Type,Status,Occurred At,Location,Device,IMEI,Serial,Owner,Region,LEA Agency,Created At\n';
    const csvRows = cases.map(c => 
      `"${c.case_id}","${c.report_type}","${c.status}","${c.occurred_at}","${c.location || ''}","${c.brand} ${c.model}","${c.imei || ''}","${c.serial || ''}","${c.owner_name}","${c.region}","${c.agency_name || ''}","${c.created_at}"`
    ).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="cases-export-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);

  } catch (error) {
    console.error('LEA export error:', error);
    res.status(500).json({ error: 'Failed to export cases' });
  }
});

module.exports = router;