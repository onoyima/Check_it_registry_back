// Admin Dashboard Routes - Complete Management System
const express = require('express');
const Database = require('../config');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Admin authentication middleware
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Apply authentication and admin check to all routes
router.use(authenticateToken);
router.use(requireAdmin);

// GET /api/admin-dashboard/stats - Dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await Promise.all([
      // Total users
      Database.query('SELECT COUNT(*) as count FROM users'),
      
      // Total devices
      Database.query('SELECT COUNT(*) as count FROM devices'),
      
      // Devices by status
      Database.query(`
        SELECT status, COUNT(*) as count 
        FROM devices 
        GROUP BY status
      `),
      
      // Total reports
      Database.query('SELECT COUNT(*) as count FROM reports'),
      
      // Reports by type
      Database.query(`
        SELECT report_type, COUNT(*) as count 
        FROM reports 
        GROUP BY report_type
      `),
      
      // Recent registrations (last 30 days)
      Database.query(`
        SELECT COUNT(*) as count 
        FROM users 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `),
      
      // Recent device registrations (last 30 days)
      Database.query(`
        SELECT COUNT(*) as count 
        FROM devices 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `),
      
      // Active cases
      Database.query(`
        SELECT COUNT(*) as count 
        FROM reports 
        WHERE status IN ('active', 'pending_verification')
      `)
    ]);

    res.json({
      total_users: stats[0][0].count,
      total_devices: stats[1][0].count,
      devices_by_status: stats[2],
      total_reports: stats[3][0].count,
      reports_by_type: stats[4],
      new_users_30_days: stats[5][0].count,
      new_devices_30_days: stats[6][0].count,
      active_cases: stats[7][0].count
    });

  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

// GET /api/admin-dashboard/users - User management
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status, role } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    let params = [];

    if (search) {
      whereClause += ' AND (name LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (role) {
      whereClause += ' AND role = ?';
      params.push(role);
    }

    const users = await Database.query(`
      SELECT 
        u.id, u.name, u.email, u.role, u.region, u.verified_at, 
        u.created_at, u.last_login_at, u.login_count,
        COUNT(d.id) as device_count,
        COUNT(r.id) as report_count
      FROM users u
      LEFT JOIN devices d ON u.id = d.user_id
      LEFT JOIN reports r ON u.id = r.reporter_id
      WHERE ${whereClause}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    const totalCount = await Database.query(`
      SELECT COUNT(*) as count FROM users WHERE ${whereClause}
    `, params);

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].count,
        pages: Math.ceil(totalCount[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/admin-dashboard/devices - Device management
router.get('/devices', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status, brand } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    let params = [];

    if (search) {
      whereClause += ' AND (d.brand LIKE ? OR d.model LIKE ? OR d.imei LIKE ? OR d.serial LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status) {
      whereClause += ' AND d.status = ?';
      params.push(status);
    }

    if (brand) {
      whereClause += ' AND d.brand = ?';
      params.push(brand);
    }

    const devices = await Database.query(`
      SELECT 
        d.*, u.name as owner_name, u.email as owner_email,
        COUNT(r.id) as report_count
      FROM devices d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN reports r ON d.id = r.device_id
      WHERE ${whereClause}
      GROUP BY d.id
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    const totalCount = await Database.query(`
      SELECT COUNT(*) as count FROM devices d WHERE ${whereClause}
    `, params);

    res.json({
      devices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].count,
        pages: Math.ceil(totalCount[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Admin devices error:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// GET /api/admin-dashboard/reports - Report management
router.get('/reports', async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    let params = [];

    if (type) {
      whereClause += ' AND r.report_type = ?';
      params.push(type);
    }

    if (status) {
      whereClause += ' AND r.status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ' AND (r.case_id LIKE ? OR d.brand LIKE ? OR d.model LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const reports = await Database.query(`
      SELECT 
        r.*, 
        d.brand, d.model, d.imei, d.serial,
        u.name as reporter_name, u.email as reporter_email,
        owner.name as owner_name, owner.email as owner_email
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON r.reporter_id = u.id
      JOIN users owner ON d.user_id = owner.id
      WHERE ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    const totalCount = await Database.query(`
      SELECT COUNT(*) as count FROM reports r 
      JOIN devices d ON r.device_id = d.id
      WHERE ${whereClause}
    `, params);

    res.json({
      reports,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].count,
        pages: Math.ceil(totalCount[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Admin reports error:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// PUT /api/admin-dashboard/users/:id - Update user
router.put('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, role, region } = req.body;

    // Get current user data
    const currentUser = await Database.selectOne('users', '*', 'id = ?', [userId]);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user
    const updateData = {
      updated_at: new Date()
    };

    if (name) updateData.name = name.trim();
    if (email) updateData.email = email.toLowerCase().trim();
    if (role) updateData.role = role;
    if (region) updateData.region = region;

    await Database.update('users', updateData, 'id = ?', [userId]);

    // Log admin action
    await Database.logAudit(
      req.user.id,
      'ADMIN_USER_UPDATE',
      'users',
      userId,
      { name: currentUser.name, email: currentUser.email, role: currentUser.role },
      updateData,
      req.ip
    );

    res.json({
      success: true,
      message: 'User updated successfully'
    });

  } catch (error) {
    console.error('Admin update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// GET /api/admin-dashboard/devices/:id - Get device details
router.get('/devices/:id', async (req, res) => {
  try {
    const deviceId = req.params.id;

    // Get device details with owner info
    const device = await Database.query(`
      SELECT 
        d.*, 
        u.name as owner_name, 
        u.email as owner_email,
        u.phone as owner_phone,
        u.created_at as owner_since
      FROM devices d
      JOIN users u ON d.user_id = u.id
      WHERE d.id = ?
    `, [deviceId]);

    if (!device || device.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Get associated reports (align with schema: reporter_id)
    const reports = await Database.query(`
      SELECT 
        r.*,
        u.name as reporter_name,
        u.email as reporter_email
      FROM reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      WHERE r.device_id = ?
      ORDER BY r.created_at DESC
    `, [deviceId]);

    // Get transfer history
    const transfers = await Database.query(`
      SELECT 
        dt.*,
        u_from.name as from_user_name,
        u_from.email as from_user_email,
        u_to.name as to_user_name,
        u_to.email as to_user_email
      FROM device_transfers dt
      LEFT JOIN users u_from ON dt.from_user_id = u_from.id
      LEFT JOIN users u_to ON dt.to_user_id = u_to.id
      WHERE dt.device_id = ?
      ORDER BY dt.created_at DESC
    `, [deviceId]);

    // Get verification history (table may not exist in some deployments)
    let verification_history = [];
    try {
      verification_history = await Database.query(`
        SELECT 
          dv.*,
          u.name as verified_by_name
        FROM device_verifications dv
        LEFT JOIN users u ON dv.verified_by = u.id
        WHERE dv.device_id = ?
        ORDER BY dv.created_at DESC
      `, [deviceId]);
    } catch (e) {
      verification_history = [];
    }

    // Get activity logs (audit trail)
    const activity_logs = await Database.query(`
      SELECT 
        al.*,
        u.name as user_name,
        u.email as user_email
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.table_name = 'devices' AND al.record_id = ?
      ORDER BY al.created_at DESC
      LIMIT 50
    `, [deviceId]);

    // Get public device check history
    let check_history = [];
    try {
      // Try the enhanced device_checks table first (if present)
      check_history = await Database.query(`
        SELECT 
          id,
          device_id,
          query,
          checker_user_id,
          checker_name,
          checker_email,
          ip_address,
          location_address,
          check_result,
          device_status_at_check,
          created_at
        FROM device_checks
        WHERE device_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `, [deviceId]);
    } catch (e) {
      // Fallback to basic imei_checks logs by matching device identifiers
      const devRow = device[0];
      const identifiers = [];
      if (devRow?.imei) identifiers.push(devRow.imei);
      if (devRow?.serial) identifiers.push(devRow.serial);
      if (identifiers.length > 0) {
        const placeholders = identifiers.map(() => '?').join(',');
        try {
          const fallback = await Database.query(`
            SELECT 
              id,
              query,
              ip_address,
              created_at,
              NULL AS checker_user_id,
              NULL AS checker_name,
              NULL AS checker_email,
              NULL AS location_address,
              NULL AS check_result,
              NULL AS device_status_at_check
            FROM imei_checks
            WHERE query IN (${placeholders})
            ORDER BY created_at DESC
            LIMIT 50
          `, identifiers);
          check_history = fallback.map(row => ({
            id: row.id,
            query: row.query,
            ip_address: row.ip_address,
            created_at: row.created_at
          }));
        } catch (e2) {
          check_history = [];
        }
      }
    }

    res.json({
      device: device[0],
      reports,
      transfers,
      verification_history,
      activity_logs,
      check_history
    });

  } catch (error) {
    console.error('Admin device details error:', error);
    res.status(500).json({ error: 'Failed to fetch device details' });
  }
});

// PUT /api/admin-dashboard/devices/:id - Update device status
router.put('/devices/:id', async (req, res) => {
  try {
    const deviceId = req.params.id;
    const { status, admin_notes } = req.body;

    // Get current device data
    const currentDevice = await Database.selectOne('devices', '*', 'id = ?', [deviceId]);
    if (!currentDevice) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Update device
    const updateData = {
      updated_at: new Date()
    };

    if (status) {
      updateData.status = status;
      if (status === 'verified') {
        updateData.verified_at = new Date();
      }
    }

    if (admin_notes) {
      updateData.admin_notes = admin_notes;
    }

    await Database.update('devices', updateData, 'id = ?', [deviceId]);

    // Send notification to device owner if status changed
    if (status && status !== currentDevice.status) {
      const owner = await Database.selectOne('users', 'name, email', 'id = ?', [currentDevice.user_id]);
      const NotificationService = require('../services/NotificationService');
      
      let emailSubject, emailContent;
      
      if (status === 'verified') {
        emailSubject = 'Device Approved - Check It Registry';
        emailContent = `
          <h2>Device Approved!</h2>
          <p>Hello ${owner.name},</p>
          <p>Your device <strong>${currentDevice.brand} ${currentDevice.model}</strong> has been approved by our admin team.</p>
          <p>Your device is now fully protected in our registry.</p>
        `;
      } else if (status === 'rejected') {
        emailSubject = 'Device Registration Rejected - Check It Registry';
        emailContent = `
          <h2>Device Registration Update</h2>
          <p>Hello ${owner.name},</p>
          <p>Unfortunately, your device <strong>${currentDevice.brand} ${currentDevice.model}</strong> registration has been rejected.</p>
          <p><strong>Reason:</strong> ${admin_notes || 'Please contact support for more information'}</p>
          <p>You can resubmit with additional documentation if needed.</p>
        `;
      }

      if (emailSubject) {
        await NotificationService.sendEmailDirect(owner.email, emailSubject, emailContent);
      }
    }

    // Log admin action
    await Database.logAudit(
      req.user.id,
      'ADMIN_DEVICE_UPDATE',
      'devices',
      deviceId,
      { status: currentDevice.status },
      updateData,
      req.ip
    );

    res.json({
      success: true,
      message: 'Device updated successfully'
    });

  } catch (error) {
    console.error('Admin update device error:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

// GET /api/admin-dashboard/reports/:id - Get individual case details for admin
router.get('/reports/:id', async (req, res) => {
  try {
    const caseId = req.params.id;

    // Get report with device, reporter, and LEA info
    const report = await Database.query(`
      SELECT 
        r.*,
        d.id as device_id, d.brand, d.model, d.imei, d.serial, d.color, d.storage_capacity,
        reporter.id as reporter_id, reporter.name as reporter_name, reporter.email as reporter_email,
        owner.id as owner_id, owner.name as owner_name, owner.email as owner_email,
        lea.id as lea_id, lea.agency_name as lea_name, lea.contact_email as lea_email, lea.region as lea_region
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      LEFT JOIN users reporter ON r.reporter_id = reporter.id
      JOIN users owner ON d.user_id = owner.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE r.case_id = ? OR r.id = ?
    `, [caseId, caseId]);

    if (!report || report.length === 0) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const reportData = report[0];

    // Get timeline/audit entries for this case (aligned with audit_logs schema)
    const timeline = await Database.query(`
      SELECT 
        al.id,
        al.action,
        COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(al.new_values, '$.status')),
          JSON_UNQUOTE(JSON_EXTRACT(al.new_values, '$.admin_notes')),
          JSON_UNQUOTE(JSON_EXTRACT(al.new_values, '$.note')),
          al.action
        ) AS message,
        al.created_at,
        COALESCE(u.name, 'System') AS user_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.table_name = 'reports' AND al.record_id = ?
      ORDER BY al.created_at DESC
    `, [reportData.id]);

    res.json({
      report: {
        id: reportData.id,
        case_id: reportData.case_id,
        report_type: reportData.report_type,
        status: reportData.status,
        description: reportData.description,
        location: reportData.location,
        occurred_at: reportData.occurred_at,
        created_at: reportData.created_at,
        updated_at: reportData.updated_at
      },
      device: {
        id: reportData.device_id,
        brand: reportData.brand,
        model: reportData.model,
        imei: reportData.imei,
        serial: reportData.serial,
        color: reportData.color,
        storage_capacity: reportData.storage_capacity
      },
      reporter: {
        id: reportData.reporter_id,
        name: reportData.reporter_name,
        email: reportData.reporter_email
      },
      owner: {
        id: reportData.owner_id,
        name: reportData.owner_name,
        email: reportData.owner_email
      },
      lea: reportData.lea_id ? {
        id: reportData.lea_id,
        name: reportData.lea_name,
        email: reportData.lea_email,
        region: reportData.lea_region
      } : null,
      admin_notes: reportData.admin_notes,
      timeline
    });

  } catch (error) {
    console.error('Admin get case details error:', error);
    res.status(500).json({ error: 'Failed to load case details' });
  }
});

// PUT /api/admin-dashboard/reports/:id - Update report status
router.put('/reports/:id', async (req, res) => {
  try {
    const reportId = req.params.id;
    const { status, admin_notes, lea_assigned } = req.body;

    // Get current report data
    const currentReport = await Database.selectOne('reports', '*', 'id = ?', [reportId]);
    if (!currentReport) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Update report
    const updateData = {
      updated_at: new Date()
    };

    if (status) updateData.status = status;
    if (admin_notes) updateData.admin_notes = admin_notes;
    if (lea_assigned) updateData.lea_assigned = lea_assigned;

    await Database.update('reports', updateData, 'id = ?', [reportId]);

    // Log admin action
    await Database.logAudit(
      req.user.id,
      'ADMIN_REPORT_UPDATE',
      'reports',
      reportId,
      { status: currentReport.status },
      updateData,
      req.ip
    );

    res.json({
      success: true,
      message: 'Report updated successfully'
    });

  } catch (error) {
    console.error('Admin update report error:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// DELETE /api/admin-dashboard/users/:id - Delete user (soft delete)
router.delete('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;

    // Check if user exists
    const user = await Database.selectOne('users', 'name, email', 'id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Soft delete by updating email and marking as deleted
    await Database.update('users', {
      email: `deleted_${Date.now()}_${user.email}`,
      name: `[DELETED] ${user.name}`,
      deleted_at: new Date(),
      updated_at: new Date()
    }, 'id = ?', [userId]);

    // Log admin action
    await Database.logAudit(
      req.user.id,
      'ADMIN_USER_DELETE',
      'users',
      userId,
      { name: user.name, email: user.email },
      { deleted: true },
      req.ip
    );

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// GET /api/admin-dashboard/audit-logs - Audit trail
router.get('/audit-logs', async (req, res) => {
  try {
    const { page = 1, limit = 50, user_id, action, severity } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    let params = [];

    if (user_id) {
      whereClause += ' AND a.user_id = ?';
      params.push(user_id);
    }

    if (action) {
      whereClause += ' AND a.action LIKE ?';
      params.push(`%${action}%`);
    }

    if (severity) {
      whereClause += ' AND a.severity = ?';
      params.push(severity);
    }

    const logs = await Database.query(`
      SELECT 
        a.*, u.name as user_name, u.email as user_email
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    const totalCount = await Database.query(`
      SELECT COUNT(*) as count FROM audit_logs a WHERE ${whereClause}
    `, params);

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].count,
        pages: Math.ceil(totalCount[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Admin audit logs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// GET /api/admin-dashboard/lea-directory - Searchable LEA directory
router.get('/lea-directory', async (req, res) => {
  try {
    const { search = '', limit = 20 } = req.query;
    const like = `%${search}%`;
    const leaUsers = await Database.query(`
      SELECT id, name, email, badge_number
      FROM users
      WHERE role = 'lea' AND (name LIKE ? OR email LIKE ? OR COALESCE(badge_number, '') LIKE ?)
      ORDER BY name ASC
      LIMIT ?
    `, [like, like, like, parseInt(limit)]);

    res.json({ users: leaUsers });
  } catch (error) {
    console.error('Admin LEA directory error:', error);
    res.status(500).json({ error: 'Failed to load LEA directory' });
  }
});

// GET /api/admin-dashboard/analytics - Advanced analytics
router.get('/analytics', async (req, res) => {
  try {
    const { period = '30' } = req.query; // days

    const analytics = await Promise.all([
      // User registration trend
      Database.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as count
        FROM users 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [period]),

      // Device registration trend
      Database.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as count
        FROM devices 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [period]),

      // Report trend
      Database.query(`
        SELECT 
          DATE(created_at) as date,
          report_type,
          COUNT(*) as count
        FROM reports 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY DATE(created_at), report_type
        ORDER BY date
      `, [period]),

      // Top device brands
      Database.query(`
        SELECT brand, COUNT(*) as count
        FROM devices
        GROUP BY brand
        ORDER BY count DESC
        LIMIT 10
      `),

      // Regional distribution
      Database.query(`
        SELECT region, COUNT(*) as count
        FROM users
        WHERE region IS NOT NULL
        GROUP BY region
        ORDER BY count DESC
      `)
    ]);

    res.json({
      user_registrations: analytics[0],
      device_registrations: analytics[1],
      reports: analytics[2],
      top_brands: analytics[3],
      regional_distribution: analytics[4]
    });

  } catch (error) {
    console.error('Admin analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;