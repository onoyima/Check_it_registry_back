// LEA (Law Enforcement Agency) Portal Routes
const express = require('express');
const Database = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { require2FASetup } = require('../middleware/twoFaEnforcement');
const NotificationService = require('../services/NotificationService');
const PIIEncryptionService = require('../services/PIIEncryptionService');
const { getDisplayName, nameSelectColumns } = require('../utils/user-helpers');

const router = express.Router();

// Middleware: Require LEA role with 2FA enforcement
router.use(authenticateToken);
router.use(requireRole(['lea', 'admin']));
router.use(require2FASetup);

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
        u.first_name as owner_first_name,
        u.middle_name as owner_middle_name,
        u.last_name as owner_last_name,
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
        u.first_name AS owner_first_name,
        u.middle_name AS owner_middle_name,
        u.last_name AS owner_last_name,
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
        owner.name AS owner_name, owner.first_name AS owner_first_name, owner.middle_name AS owner_middle_name, owner.last_name AS owner_last_name, owner.email AS owner_email, owner.phone AS owner_phone, owner.region AS owner_region,
        checker.name AS checker_name, checker.first_name AS checker_first_name, checker.middle_name AS checker_middle_name, checker.last_name AS checker_last_name, checker.email AS checker_email, checker.phone AS checker_phone
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
        u.first_name as owner_first_name,
        u.middle_name as owner_middle_name,
        u.last_name as owner_last_name,
        u.email as owner_email,
        u.phone as owner_phone,
        u.region,
        lea.agency_name,
        reporter.name as reporter_name,
        reporter.first_name as reporter_first_name,
        reporter.middle_name as reporter_middle_name,
        reporter.last_name as reporter_last_name,
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

// GET /api/lea-portal/device-search - Advanced device search for LEA
router.get('/device-search', async (req, res) => {
  try {
    const { imei, serial, brand, model, owner_name, owner_email, region, status, limit = 50 } = req.query;
    const userRegion = req.user.region;
    const regionFilter = req.user.role === 'admin' ? '' : 'AND u.region = ?';
    const regionParams = req.user.role === 'admin' ? [] : [userRegion];

    const conditions = ['1=1'];
    const params = [];
    if (imei) { conditions.push('d.imei LIKE ?'); params.push(`%${imei}%`); }
    if (serial) { conditions.push('d.serial LIKE ?'); params.push(`%${serial}%`); }
    if (brand) { conditions.push('d.brand LIKE ?'); params.push(`%${brand}%`); }
    if (model) { conditions.push('d.model LIKE ?'); params.push(`%${model}%`); }
    if (owner_name) { conditions.push('(u.name LIKE ? OR u.first_name LIKE ? OR u.middle_name LIKE ? OR u.last_name LIKE ?)'); params.push(`%${owner_name}%`, `%${owner_name}%`, `%${owner_name}%`, `%${owner_name}%`); }
    if (owner_email) { conditions.push('u.email_hash = ?'); params.push(PIIEncryptionService.hashEmail(owner_email)); }
    if (region) { conditions.push('u.region LIKE ?'); params.push(`%${region}%`); }
    if (status && status !== 'all') { conditions.push('d.status = ?'); params.push(status); }

    const sql = `
      SELECT d.id, d.brand, d.model, d.imei, d.serial, d.status, d.created_at,
        u.name as owner_name, u.first_name as owner_first_name, u.middle_name as owner_middle_name, u.last_name as owner_last_name, u.email as owner_email, u.phone as owner_phone, u.region as owner_region,
        (SELECT MAX(created_at) FROM device_check_logs WHERE device_id = d.id) as last_check_at,
        (SELECT COUNT(*) FROM reports WHERE device_id = d.id) as report_count
      FROM devices d
      JOIN users u ON d.user_id = u.id
      WHERE ${conditions.join(' AND ')} ${regionFilter}
      ORDER BY d.created_at DESC
      LIMIT ?
    `;

    const devices = await Database.query(sql, [...params, ...regionParams, parseInt(limit)]);
    res.json({ devices });
  } catch (error) {
    console.error('LEA device search error:', error);
    res.status(500).json({ error: 'Device search failed' });
  }
});

// GET /api/lea-portal/recovery - List recovery operations (from reports)
router.get('/recovery', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const userRegion = req.user.region;
    const regionFilter = req.user.role === 'admin' ? '' : 'AND u.region = ?';
    const regionParams = req.user.role === 'admin' ? [] : [userRegion];

    let statusFilter = '';
    const statusParams = [];
    if (status && status !== 'all') {
      if (status === 'pending_recovery') {
        statusFilter = 'AND r.status IN (?)';
        statusParams.push(['open', 'under_review']);
      } else if (status === 'recovered') {
        statusFilter = 'AND r.status IN (?)';
        statusParams.push(['resolved']);
      } else {
        statusFilter = 'AND r.status = ?';
        statusParams.push(status);
      }
    }

    const [countResult] = await Database.query(`
      SELECT COUNT(*) as total
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE r.report_type IN ('stolen', 'lost', 'found') ${regionFilter} ${statusFilter}
    `, [...regionParams, ...statusParams]);

    const records = await Database.query(`
      SELECT
        r.id, r.case_id, r.report_type, r.status, r.description as notes, r.created_at, r.updated_at,
        d.brand as device_brand, d.model as device_model, d.imei, d.serial,
        u.name as owner_name, u.first_name as owner_first_name, u.middle_name as owner_middle_name, u.last_name as owner_last_name, u.email as owner_email, u.phone as owner_phone,
        (SELECT name FROM users WHERE id = r.assigned_lea_id) as recovered_by,
        (SELECT updated_at FROM reports WHERE id = r.id AND status = 'resolved') as recovered_at
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE r.report_type IN ('stolen', 'lost', 'found') ${regionFilter} ${statusFilter}
      ORDER BY r.updated_at DESC
      LIMIT ? OFFSET ?
    `, [...regionParams, ...statusParams, parseInt(limit), offset]);

    res.json({
      records,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil((countResult?.total || 0) / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('LEA recovery error:', error);
    res.status(500).json({ error: 'Failed to load recovery records' });
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
        u.first_name as owner_first_name,
        u.middle_name as owner_middle_name,
        u.last_name as owner_last_name,
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
        reporter.first_name as reporter_first_name,
        reporter.middle_name as reporter_middle_name,
        reporter.last_name as reporter_last_name,
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
        u_from.first_name as from_user_first_name,
        u_from.middle_name as from_user_middle_name,
        u_from.last_name as from_user_last_name,
        u_to.name as to_user_name,
        u_to.first_name as to_user_first_name,
        u_to.middle_name as to_user_middle_name,
        u_to.last_name as to_user_last_name
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
        uver.name as verified_by_name,
        uver.first_name as verified_by_first_name,
        uver.middle_name as verified_by_middle_name,
        uver.last_name as verified_by_last_name
      FROM device_verifications dv
      LEFT JOIN users uver ON dv.verified_by = uver.id
      WHERE dv.device_id = ?
      ORDER BY dv.created_at DESC
    `, [deviceId]);

    // Audit logs for this device
    const activity_logs = await Database.query(`
      SELECT 
        al.*,
        ulog.name as user_name,
        ulog.first_name as user_first_name,
        ulog.middle_name as user_middle_name,
        ulog.last_name as user_last_name
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
        u.first_name as owner_first_name,
        u.middle_name as owner_middle_name,
        u.last_name as owner_last_name,
        u.email as owner_email,
        u.phone as owner_phone,
        u.region,
        lea.agency_name,
        lea.contact_email as lea_email,
        lea.contact_phone as lea_phone,
        reporter.name as reporter_name,
        reporter.first_name as reporter_first_name,
        reporter.middle_name as reporter_middle_name,
        reporter.last_name as reporter_last_name,
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
        u.name as user_name,
        u.first_name as user_first_name,
        u.middle_name as user_middle_name,
        u.last_name as user_last_name
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
      const ownerEmail = await Database.selectOne('users', 'email', 'id = ?', [reportCase.user_id]);
      if (ownerEmail && ownerEmail.email) {
        await NotificationService.queueNotification(
          reportCase.user_id,
          'email',
          ownerEmail.email,
          `Case Update - ${caseId}`,
          `
            <h2>Case Status Update</h2>
            <p>Your case <strong>${caseId}</strong> has been marked as resolved.</p>
            <p><strong>Device:</strong> ${reportCase.brand} ${reportCase.model}</p>
            ${notes ? `<p><strong>LEA Notes:</strong> ${notes}</p>` : ''}
            <p>Thank you for using Prove Ownership Device Registry.</p>
          `,
          { caseId: caseId, type: 'case_resolved' }
        );
      }
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
    const newNote = `[${timestamp}] ${getDisplayName(req.user)}: ${notes.trim()}`;
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
        u.first_name as owner_first_name,
        u.middle_name as owner_middle_name,
        u.last_name as owner_last_name,
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
      `"${c.case_id}","${c.report_type}","${c.status}","${c.occurred_at}","${c.location || ''}","${c.brand} ${c.model}","${c.imei || ''}","${c.serial || ''}","${getDisplayName(c)}","${c.region}","${c.agency_name || ''}","${c.created_at}"`
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

// GET LEA settings (profile + notification preferences)
router.get('/settings', async (req, res) => {
  try {
    const rows = await Database.query(
      `SELECT id, ${nameSelectColumns}, email, phone, region, department, agency_id,
              first_name, middle_name, last_name, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    let agency = null;
    if (user.agency_id) {
      const agencies = await Database.query(
        'SELECT id, name, abbreviation, jurisdiction, contact_email, contact_phone, address FROM law_enforcement_agencies WHERE id = ?',
        [user.agency_id]
      );
      agency = agencies[0] || null;
    }

    let notifications = null;
    const notifSettings = await Database.query(
      'SELECT * FROM notification_settings WHERE user_id = ?',
      [req.user.id]
    );
    if (notifSettings.length > 0) notifications = notifSettings[0];

    res.json({
      profile: {
        id: user.id,
        firstName: user.first_name || '',
        middleName: user.middle_name || '',
        lastName: user.last_name || '',
        name: getDisplayName(user),
        email: user.email,
        phone: user.phone || '',
        region: user.region || '',
        department: user.department || '',
        agencyId: user.agency_id || '',
        createdAt: user.created_at,
      },
      agency,
      notifications,
    });
  } catch (error) {
    console.error('LEA settings get error:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// Update LEA settings
router.put('/settings', async (req, res) => {
  try {
    const { region, department, firstName, lastName, middleName, phone, notifications } = req.body;
    const updates = {};
    if (region !== undefined) updates.region = region;
    if (department !== undefined) updates.department = department;
    if (firstName !== undefined) updates.first_name = firstName;
    if (lastName !== undefined) updates.last_name = lastName;
    if (middleName !== undefined) updates.middle_name = middleName;
    if (phone !== undefined) updates.phone = phone;
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date();
      await Database.update('users', updates, 'id = ?', [req.user.id]);
    }

    if (notifications && typeof notifications === 'object') {
      const existing = await Database.query('SELECT id FROM notification_settings WHERE user_id = ?', [req.user.id]);
      const notifFields = {};
      if (notifications.email_alerts !== undefined) notifFields.email_alerts = notifications.email_alerts ? 1 : 0;
      if (notifications.sms_alerts !== undefined) notifFields.sms_alerts = notifications.sms_alerts ? 1 : 0;
      if (notifications.critical_alerts !== undefined) notifFields.critical_alerts = notifications.critical_alerts ? 1 : 0;
      if (notifications.new_reports !== undefined) notifFields.new_reports = notifications.new_reports ? 1 : 0;
      if (notifications.recovery_updates !== undefined) notifFields.recovery_updates = notifications.recovery_updates ? 1 : 0;
      if (notifications.transfer_notifications !== undefined) notifFields.transfer_notifications = notifications.transfer_notifications ? 1 : 0;

      if (Object.keys(notifFields).length > 0) {
        notifFields.updated_at = new Date();
        if (existing.length > 0) {
          await Database.update('notification_settings', notifFields, 'user_id = ?', [req.user.id]);
        } else {
          notifFields.id = Database.generateUUID();
          notifFields.user_id = req.user.id;
          notifFields.created_at = new Date();
          await Database.insert('notification_settings', notifFields);
        }
      }
    }

    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    console.error('LEA settings update error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// --- LEA Messaging ---

// GET /lea-portal/threads - list all messaging threads for the current LEA user
router.get('/threads', async (req, res) => {
  try {
    const threads = await Database.query(`
      SELECT t.id, t.subject, t.case_id, t.status, t.created_at, t.updated_at,
             p.id AS participant_id, p.user_id, p.role AS participant_role, p.last_read_at,
             ${nameSelectColumns.replace(/u\./g, 'u2.')} AS participant_name
      FROM lea_threads t
      JOIN lea_thread_participants p ON p.thread_id = t.id
      JOIN users u2 ON p.user_id = u2.id
      WHERE t.id IN (
        SELECT thread_id FROM lea_thread_participants WHERE user_id = ?
      )
      ORDER BY t.updated_at DESC
    `, [req.user.id]);

    const threadMap = new Map();
    for (const row of threads) {
      if (!threadMap.has(row.id)) {
        const lastMsg = await Database.query(
          `SELECT m.content, m.created_at, m.sender_id FROM lea_thread_messages m WHERE m.thread_id = ? ORDER BY m.created_at DESC LIMIT 1`,
          [row.id]
        );
        const unreadCount = await Database.query(
          `SELECT COUNT(*) AS cnt FROM lea_thread_messages m
           JOIN lea_thread_participants p ON p.thread_id = m.thread_id
           WHERE m.thread_id = ? AND m.sender_id != ? AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
           AND p.user_id = ?`,
          [row.id, req.user.id, req.user.id]
        );
        threadMap.set(row.id, {
          id: row.id,
          subject: row.subject,
          caseId: row.case_id,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastMessage: lastMsg[0] ? { content: lastMsg[0].content, createdAt: lastMsg[0].created_at, senderId: lastMsg[0].sender_id } : null,
          unreadCount: unreadCount[0]?.cnt || 0,
          participants: [],
        });
      }
      threadMap.get(row.id).participants.push({
        id: row.participant_id,
        userId: row.user_id,
        role: row.participant_role,
        name: getDisplayName({ first_name: undefined, middle_name: undefined, last_name: undefined }) || row.participant_name,
      });
    }

    res.json({ data: Array.from(threadMap.values()) });
  } catch (error) {
    console.error('LEA threads error:', error);
    res.status(500).json({ error: 'Failed to load threads' });
  }
});

// POST /lea-portal/threads - create a new thread
router.post('/threads', async (req, res) => {
  try {
    const { subject, participantUserId, caseId } = req.body;
    if (!subject || !participantUserId) {
      return res.status(400).json({ error: 'subject and participantUserId are required' });
    }
    const threadId = Database.generateUUID();
    const now = new Date();
    await Database.insert('lea_threads', {
      id: threadId,
      subject,
      case_id: caseId || null,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    await Database.insert('lea_thread_participants', {
      id: Database.generateUUID(),
      thread_id: threadId,
      user_id: req.user.id,
      role: 'lea',
      joined_at: now,
      last_read_at: now,
    });
    await Database.insert('lea_thread_participants', {
      id: Database.generateUUID(),
      thread_id: threadId,
      user_id: participantUserId,
      role: 'member',
      joined_at: now,
    });
    res.status(201).json({ id: threadId, subject, status: 'active' });
  } catch (error) {
    console.error('Create thread error:', error);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

// GET /lea-portal/threads/:threadId/messages - list messages in a thread
router.get('/threads/:threadId/messages', async (req, res) => {
  try {
    const { threadId } = req.params;
    const messages = await Database.query(`
      SELECT m.id, m.thread_id AS threadId, m.sender_id AS senderId, m.content, m.created_at AS createdAt, m.updated_at AS updatedAt,
             ${nameSelectColumns.replace(/u\./g, 'u2.')} AS senderName
      FROM lea_thread_messages m
      JOIN users u2 ON m.sender_id = u2.id
      WHERE m.thread_id = ?
      ORDER BY m.created_at ASC
    `, [threadId]);

    await Database.query(
      `UPDATE lea_thread_participants SET last_read_at = NOW() WHERE thread_id = ? AND user_id = ?`,
      [threadId, req.user.id]
    );

    res.json({ data: messages });
  } catch (error) {
    console.error('Get thread messages error:', error);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /lea-portal/threads/:threadId/messages - send a message in a thread
router.post('/threads/:threadId/messages', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const participants = await Database.query(
      'SELECT user_id FROM lea_thread_participants WHERE thread_id = ?',
      [threadId]
    );
    if (!participants.some(p => p.user_id === req.user.id)) {
      return res.status(403).json({ error: 'Not a participant of this thread' });
    }

    const msgId = Database.generateUUID();
    const now = new Date();
    await Database.insert('lea_thread_messages', {
      id: msgId,
      thread_id: threadId,
      sender_id: req.user.id,
      content: content.trim(),
      created_at: now,
      updated_at: now,
    });
    await Database.update('lea_threads', { updated_at: now }, 'id = ?', [threadId]);

    res.status(201).json({ id: msgId, threadId, senderId: req.user.id, content: content.trim(), createdAt: now });
  } catch (error) {
    console.error('Send thread message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;