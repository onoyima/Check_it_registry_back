// Enhanced Admin Portal Routes - Complete Professional Admin System
const express = require('express');
const Database = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');
const NotificationService = require('../services/NotificationService');

const router = express.Router();

// Apply authentication and admin check to all routes
router.use(authenticateToken);
router.use(requireRole(['admin']));

// Security middleware - Log all admin actions
router.use(async (req, res, next) => {
  try {
    await Database.logAudit(
      req.user.id,
      `ADMIN_${req.method}_${req.path.replace(/\//g, '_').toUpperCase()}`,
      'admin_portal',
      null,
      null,
      {
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.method !== 'GET' ? req.body : null,
        user_agent: req.get('User-Agent')
      },
      req.ip
    );
  } catch (error) {
    console.error('Admin audit logging error:', error);
  }
  next();
});

// ==================== DASHBOARD & STATISTICS ====================

// Enhanced dashboard statistics
router.get('/dashboard', async (req, res) => {
  try {
    const stats = {};

    // Core statistics
    const [totalUsers] = await Database.query('SELECT COUNT(*) as count FROM users');
    const [totalDevices] = await Database.query('SELECT COUNT(*) as count FROM devices');
    const [totalReports] = await Database.query('SELECT COUNT(*) as count FROM reports');
    const [totalChecks] = await Database.query('SELECT COUNT(*) as count FROM imei_checks');

    stats.overview = {
      total_users: totalUsers.count,
      total_devices: totalDevices.count,
      total_reports: totalReports.count,
      total_public_checks: totalChecks.count
    };

    // Device statistics
    const deviceStats = await Database.query(`
      SELECT 
        status,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM devices), 2) as percentage
      FROM devices 
      GROUP BY status
    `);
    stats.devices = {
      by_status: deviceStats,
      pending_verification: deviceStats.find(d => d.status === 'unverified')?.count || 0
    };

    // Report statistics
    const reportStats = await Database.query(`
      SELECT 
        status,
        report_type,
        COUNT(*) as count
      FROM reports 
      GROUP BY status, report_type
    `);
    stats.reports = {
      by_status_and_type: reportStats,
      open_cases: reportStats.filter(r => r.status === 'open').reduce((sum, r) => sum + r.count, 0)
    };

    // User statistics
    const userStats = await Database.query(`
      SELECT 
        role,
        COUNT(*) as count,
        COUNT(CASE WHEN verified_at IS NOT NULL THEN 1 END) as verified_count
      FROM users 
      GROUP BY role
    `);
    stats.users = {
      by_role: userStats,
      verification_rate: userStats.reduce((sum, u) => sum + u.verified_count, 0) / totalUsers.count
    };

    // Recent activity (last 7 days)
    const recentActivity = await Database.query(`
      SELECT 
        DATE(created_at) as date,
        'device' as type,
        COUNT(*) as count
      FROM devices 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      
      UNION ALL
      
      SELECT 
        DATE(created_at) as date,
        'report' as type,
        COUNT(*) as count
      FROM reports 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      
      UNION ALL
      
      SELECT 
        DATE(created_at) as date,
        'user' as type,
        COUNT(*) as count
      FROM users 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      
      ORDER BY date DESC
    `);
    stats.recent_activity = recentActivity;

    // System health indicators
    const systemHealth = {
      database_status: 'healthy',
      background_jobs_status: 'running',
      notification_queue: await Database.query('SELECT COUNT(*) as count FROM notifications WHERE status = "pending"').then(r => r[0].count),
      failed_notifications: await Database.query('SELECT COUNT(*) as count FROM notifications WHERE status = "failed"').then(r => r[0].count)
    };
    stats.system_health = systemHealth;

    res.json({
      success: true,
      data: stats,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to load dashboard statistics' });
  }
});

// ==================== USER MANAGEMENT ====================

// Comprehensive user management
router.get('/users', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      role, 
      search, 
      verified, 
      region,
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = '1=1';
    let whereParams = [];

    // Build filters
    if (role) {
      whereClause += ' AND role = ?';
      whereParams.push(role);
    }

    if (search) {
      whereClause += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
      whereParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (verified !== undefined) {
      if (verified === 'true') {
        whereClause += ' AND verified_at IS NOT NULL';
      } else {
        whereClause += ' AND verified_at IS NULL';
      }
    }

    if (region) {
      whereClause += ' AND region = ?';
      whereParams.push(region);
    }

    // Validate sort parameters
    const validSortFields = ['name', 'email', 'role', 'created_at', 'verified_at'];
    const validSortOrders = ['ASC', 'DESC'];
    
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortOrder = validSortOrders.includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'DESC';

    const users = await Database.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.role, u.region, 
        u.verified_at, u.created_at, u.updated_at,
        COUNT(DISTINCT d.id) as device_count,
        COUNT(DISTINCT r.id) as report_count,
        MAX(al.created_at) as last_activity
      FROM users u
      LEFT JOIN devices d ON u.id = d.user_id
      LEFT JOIN reports r ON u.id = r.reporter_id
      LEFT JOIN audit_logs al ON u.id = al.user_id
      WHERE ${whereClause}
      GROUP BY u.id
      ORDER BY ${sortField} ${sortOrder}
      LIMIT ? OFFSET ?
    `, [...whereParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await Database.query(
      `SELECT COUNT(*) as count FROM users WHERE ${whereClause}`,
      whereParams
    );

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount.count,
          pages: Math.ceil(totalCount.count / limit)
        }
      }
    });

  } catch (error) {
    console.error('User management error:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// Get detailed user information
router.get('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;

    // Get user details
    const user = await Database.selectOne(
      'users',
      'id, name, email, phone, role, region, verified_at, created_at, updated_at',
      'id = ?',
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's devices
    const devices = await Database.query(
      'SELECT id, brand, model, imei, serial, status, created_at FROM devices WHERE user_id = ?',
      [userId]
    );

    // Get user's reports
    const reports = await Database.query(
      'SELECT id, case_id, report_type, status, created_at FROM reports WHERE reporter_id = ?',
      [userId]
    );

    // Get user's recent activity
    const recentActivity = await Database.query(
      'SELECT action, table_name, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
      [userId]
    );

    res.json({
      success: true,
      data: {
        user,
        devices,
        reports,
        recent_activity: recentActivity,
        statistics: {
          device_count: devices.length,
          report_count: reports.length,
          verified_devices: devices.filter(d => d.status === 'verified').length,
          open_reports: reports.filter(r => r.status === 'open').length
        }
      }
    });

  } catch (error) {
    console.error('User details error:', error);
    res.status(500).json({ error: 'Failed to load user details' });
  }
});

// Update user information
router.put('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, phone, role, region, verified } = req.body;

    const user = await Database.selectOne('users', '*', 'id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Validate role
    if (role && !['user', 'business', 'admin', 'lea'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Build update object
    const updateData = { updated_at: new Date() };
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (phone) updateData.phone = phone;
    if (role) updateData.role = role;
    if (region) updateData.region = region;
    if (verified !== undefined) {
      updateData.verified_at = verified ? new Date() : null;
    }

    await Database.update('users', updateData, 'id = ?', [userId]);

    // Log the update
    await Database.logAudit(
      req.user.id,
      'ADMIN_UPDATE_USER',
      'users',
      userId,
      { role: user.role, verified_at: user.verified_at },
      updateData,
      req.ip
    );

    // Send notification to user if significant changes
    if (role && role !== user.role) {
      await NotificationService.queueNotification(
        userId,
        'email',
        email || user.email,
        'Account Role Updated',
        `Your account role has been updated to: ${role}`,
        { type: 'role_update', new_role: role }
      );
    }

    const updatedUser = await Database.selectOne(
      'users',
      'id, name, email, phone, role, region, verified_at, created_at, updated_at',
      'id = ?',
      [userId]
    );

    res.json({
      success: true,
      data: updatedUser,
      message: 'User updated successfully'
    });

  } catch (error) {
    console.error('User update error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Suspend/Activate user account
router.post('/users/:id/suspend', async (req, res) => {
  try {
    const userId = req.params.id;
    const { reason, duration_days } = req.body;

    const user = await Database.selectOne('users', '*', 'id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create suspension record
    const suspensionId = Database.generateUUID();
    const expiresAt = duration_days ? new Date(Date.now() + duration_days * 24 * 60 * 60 * 1000) : null;

    await Database.insert('user_suspensions', {
      id: suspensionId,
      user_id: userId,
      suspended_by: req.user.id,
      reason: reason || 'Administrative action',
      expires_at: expiresAt,
      created_at: new Date()
    });

    // Log the suspension
    await Database.logAudit(
      req.user.id,
      'ADMIN_SUSPEND_USER',
      'users',
      userId,
      { status: 'active' },
      { status: 'suspended', reason, expires_at: expiresAt },
      req.ip
    );

    // Notify user
    await NotificationService.queueNotification(
      userId,
      'email',
      user.email,
      'Account Suspended',
      `Your account has been suspended. Reason: ${reason}. ${expiresAt ? `Expires: ${expiresAt.toDateString()}` : 'Permanent suspension.'}`,
      { type: 'account_suspended', reason, expires_at: expiresAt }
    );

    res.json({
      success: true,
      message: 'User suspended successfully',
      suspension: {
        id: suspensionId,
        reason,
        expires_at: expiresAt
      }
    });

  } catch (error) {
    console.error('User suspension error:', error);
    res.status(500).json({ error: 'Failed to suspend user' });
  }
});

// ==================== DEVICE MANAGEMENT ====================

// Enhanced device verification queue
router.get('/verification-queue', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      brand, 
      sort_by = 'created_at',
      sort_order = 'ASC'
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'd.status = "unverified"';
    let whereParams = [];

    if (brand) {
      whereClause += ' AND d.brand = ?';
      whereParams.push(brand);
    }

    const validSortFields = ['created_at', 'brand', 'model'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortOrder = ['ASC', 'DESC'].includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'ASC';

    const devices = await Database.query(`
      SELECT 
        d.*,
        u.name as owner_name,
        u.email as owner_email,
        u.phone as owner_phone,
        u.region as owner_region,
        DATEDIFF(NOW(), d.created_at) as days_pending
      FROM devices d
      JOIN users u ON d.user_id = u.id
      WHERE ${whereClause}
      ORDER BY d.${sortField} ${sortOrder}
      LIMIT ? OFFSET ?
    `, [...whereParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await Database.query(
      `SELECT COUNT(*) as count FROM devices d WHERE ${whereClause}`,
      whereParams
    );

    // Get verification statistics
    const verificationStats = await Database.query(`
      SELECT 
        COUNT(*) as total_pending,
        AVG(DATEDIFF(NOW(), created_at)) as avg_days_pending,
        COUNT(CASE WHEN DATEDIFF(NOW(), created_at) > 7 THEN 1 END) as overdue_count
      FROM devices 
      WHERE status = 'unverified'
    `);

    res.json({
      success: true,
      data: {
        devices,
        statistics: verificationStats[0],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount.count,
          pages: Math.ceil(totalCount.count / limit)
        }
      }
    });

  } catch (error) {
    console.error('Verification queue error:', error);
    res.status(500).json({ error: 'Failed to load verification queue' });
  }
});

// Bulk device verification
router.post('/verify-devices/bulk', async (req, res) => {
  try {
    const { device_ids, approved, notes } = req.body;

    if (!Array.isArray(device_ids) || device_ids.length === 0) {
      return res.status(400).json({ error: 'Device IDs array is required' });
    }

    const results = [];
    const adminId = req.user.id;

    for (const deviceId of device_ids) {
      try {
        const device = await Database.selectOne('devices', '*', 'id = ?', [deviceId]);
        if (!device) {
          results.push({ device_id: deviceId, success: false, error: 'Device not found' });
          continue;
        }

        const newStatus = approved ? 'verified' : 'unverified';
        const verifiedAt = approved ? new Date() : null;
        const verifiedBy = approved ? adminId : null;

        await Database.update('devices', {
          status: newStatus,
          verified_at: verifiedAt,
          verified_by: verifiedBy,
          updated_at: new Date()
        }, 'id = ?', [deviceId]);

        // Log audit
        await Database.logAudit(
          adminId,
          'BULK_VERIFY_DEVICE',
          'devices',
          deviceId,
          { status: device.status },
          { status: newStatus, verified_by: verifiedBy, notes },
          req.ip
        );

        // Queue notification
        if (approved) {
          await NotificationService.notifyDeviceVerified(device.user_id, device);
        } else {
          await NotificationService.notifyDeviceRejected(device.user_id, device, notes);
        }

        results.push({ device_id: deviceId, success: true, new_status: newStatus });

      } catch (error) {
        results.push({ device_id: deviceId, success: false, error: error.message });
      }
    }

    res.json({
      success: true,
      message: `Processed ${device_ids.length} devices`,
      results: results
    });

  } catch (error) {
    console.error('Bulk verification error:', error);
    res.status(500).json({ error: 'Failed to process bulk verification' });
  }
});

// ==================== REPORT MANAGEMENT ====================

// Enhanced report management
router.get('/reports', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      report_type, 
      region,
      date_from,
      date_to,
      search
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = '1=1';
    let whereParams = [];

    // Build filters
    if (status) {
      whereClause += ' AND r.status = ?';
      whereParams.push(status);
    }

    if (report_type) {
      whereClause += ' AND r.report_type = ?';
      whereParams.push(report_type);
    }

    if (region) {
      whereClause += ' AND u.region = ?';
      whereParams.push(region);
    }

    if (date_from) {
      whereClause += ' AND r.created_at >= ?';
      whereParams.push(date_from);
    }

    if (date_to) {
      whereClause += ' AND r.created_at <= ?';
      whereParams.push(date_to);
    }

    if (search) {
      whereClause += ' AND (r.case_id LIKE ? OR r.description LIKE ? OR d.imei LIKE ? OR d.serial LIKE ?)';
      whereParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const reports = await Database.query(`
      SELECT 
        r.*,
        d.brand, d.model, d.imei, d.serial,
        u.name as owner_name, u.email as owner_email, u.region,
        lea.agency_name,
        DATEDIFF(NOW(), r.created_at) as days_open
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, [...whereParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await Database.query(
      `SELECT COUNT(*) as count FROM reports r 
       JOIN devices d ON r.device_id = d.id 
       JOIN users u ON d.user_id = u.id 
       WHERE ${whereClause}`,
      whereParams
    );

    res.json({
      success: true,
      data: {
        reports,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount.count,
          pages: Math.ceil(totalCount.count / limit)
        }
      }
    });

  } catch (error) {
    console.error('Report management error:', error);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

// Update report status (admin override)
router.put('/reports/:caseId/status', async (req, res) => {
  try {
    const { caseId } = req.params;
    const { status, admin_notes } = req.body;

    const validStatuses = ['open', 'under_review', 'resolved', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const report = await Database.selectOne('reports', '*', 'case_id = ?', [caseId]);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    await Database.update('reports', {
      status: status,
      lea_notes: admin_notes ? `${report.lea_notes || ''}\n\n[ADMIN UPDATE] ${admin_notes}` : report.lea_notes,
      updated_at: new Date()
    }, 'case_id = ?', [caseId]);

    // Log audit
    await Database.logAudit(
      req.user.id,
      'ADMIN_UPDATE_REPORT_STATUS',
      'reports',
      report.id,
      { status: report.status },
      { status: status, admin_notes },
      req.ip
    );

    res.json({
      success: true,
      message: 'Report status updated successfully',
      case_id: caseId,
      new_status: status
    });

  } catch (error) {
    console.error('Report status update error:', error);
    res.status(500).json({ error: 'Failed to update report status' });
  }
});

// ==================== SYSTEM MANAGEMENT ====================

// System configuration management
router.get('/system/config', async (req, res) => {
  try {
    const config = {
      email_configured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
      sms_configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      background_jobs_running: true, // Check actual status
      database_status: 'healthy',
      notification_queue_size: await Database.query('SELECT COUNT(*) as count FROM notifications WHERE status = "pending"').then(r => r[0].count),
      failed_notifications: await Database.query('SELECT COUNT(*) as count FROM notifications WHERE status = "failed"').then(r => r[0].count)
    };

    res.json({
      success: true,
      data: config
    });

  } catch (error) {
    console.error('System config error:', error);
    res.status(500).json({ error: 'Failed to load system configuration' });
  }
});

// Clear notification queue
router.post('/system/clear-notifications', async (req, res) => {
  try {
    const { status } = req.body; // 'failed', 'pending', or 'all'

    let whereClause = '1=1';
    if (status && status !== 'all') {
      whereClause = 'status = ?';
    }

    const result = await Database.query(
      `DELETE FROM notifications WHERE ${whereClause}`,
      status && status !== 'all' ? [status] : []
    );

    await Database.logAudit(
      req.user.id,
      'ADMIN_CLEAR_NOTIFICATIONS',
      'notifications',
      null,
      null,
      { cleared_status: status, count: result.affectedRows },
      req.ip
    );

    res.json({
      success: true,
      message: `Cleared ${result.affectedRows} notifications`,
      cleared_count: result.affectedRows
    });

  } catch (error) {
    console.error('Clear notifications error:', error);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

// Export system data
router.get('/export/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { format = 'csv', date_from, date_to } = req.query;

    let data = [];
    let filename = '';

    switch (type) {
      case 'users':
        data = await Database.query(`
          SELECT id, name, email, role, region, verified_at, created_at
          FROM users
          ${date_from ? 'WHERE created_at >= ?' : ''}
          ${date_to ? (date_from ? 'AND' : 'WHERE') + ' created_at <= ?' : ''}
          ORDER BY created_at DESC
        `, [date_from, date_to].filter(Boolean));
        filename = `users-export-${new Date().toISOString().split('T')[0]}.csv`;
        break;

      case 'devices':
        data = await Database.query(`
          SELECT d.id, d.brand, d.model, d.imei, d.serial, d.status, d.created_at,
                 u.name as owner_name, u.email as owner_email
          FROM devices d
          JOIN users u ON d.user_id = u.id
          ${date_from ? 'WHERE d.created_at >= ?' : ''}
          ${date_to ? (date_from ? 'AND' : 'WHERE') + ' d.created_at <= ?' : ''}
          ORDER BY d.created_at DESC
        `, [date_from, date_to].filter(Boolean));
        filename = `devices-export-${new Date().toISOString().split('T')[0]}.csv`;
        break;

      case 'reports':
        data = await Database.query(`
          SELECT r.case_id, r.report_type, r.status, r.occurred_at, r.location, r.created_at,
                 d.brand, d.model, d.imei, u.name as owner_name, u.region
          FROM reports r
          JOIN devices d ON r.device_id = d.id
          JOIN users u ON d.user_id = u.id
          ${date_from ? 'WHERE r.created_at >= ?' : ''}
          ${date_to ? (date_from ? 'AND' : 'WHERE') + ' r.created_at <= ?' : ''}
          ORDER BY r.created_at DESC
        `, [date_from, date_to].filter(Boolean));
        filename = `reports-export-${new Date().toISOString().split('T')[0]}.csv`;
        break;

      default:
        return res.status(400).json({ error: 'Invalid export type' });
    }

    if (format === 'csv') {
      // Generate CSV
      if (data.length === 0) {
        return res.status(404).json({ error: 'No data to export' });
      }

      const headers = Object.keys(data[0]).join(',');
      const rows = data.map(row => 
        Object.values(row).map(value => 
          `"${String(value || '').replace(/"/g, '""')}"`
        ).join(',')
      ).join('\n');

      const csv = headers + '\n' + rows;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        data: data,
        count: data.length
      });
    }

    // Log export
    await Database.logAudit(
      req.user.id,
      'ADMIN_EXPORT_DATA',
      'system',
      null,
      null,
      { export_type: type, format, count: data.length },
      req.ip
    );

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

module.exports = router;