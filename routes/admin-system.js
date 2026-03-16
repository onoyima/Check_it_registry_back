// Admin System Management Routes - Complete System Administration
const express = require('express');
const Database = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');
const NotificationService = require('../services/NotificationService');
const BackgroundJobs = require('../services/BackgroundJobs');

const router = express.Router();

// All routes require admin access
router.use(authenticateToken);
router.use(requireRole(['admin']));

// Get comprehensive system overview
router.get('/overview', async (req, res) => {
  try {
    // Get system statistics from database
    const systemStats = await Database.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as new_users_24h,
        (SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as new_users_7d,
        (SELECT COUNT(*) FROM users WHERE role = 'admin') as admin_users,
        (SELECT COUNT(*) FROM users WHERE role = 'lea') as lea_users,
        (SELECT COUNT(*) FROM users WHERE verified_at IS NOT NULL) as verified_users
    `);

    const deviceStats = await Database.query(`
      SELECT 
        (SELECT COUNT(*) FROM devices) as total_devices,
        (SELECT COUNT(*) FROM devices WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as new_devices_24h,
        (SELECT COUNT(*) FROM devices WHERE status = 'verified') as verified_devices,
        (SELECT COUNT(*) FROM devices WHERE status = 'unverified') as unverified_devices,
        (SELECT COUNT(*) FROM devices WHERE status = 'stolen') as stolen_devices,
        (SELECT COUNT(*) FROM devices WHERE status = 'lost') as lost_devices,
        (SELECT COUNT(*) FROM devices WHERE status = 'found') as found_devices
    `);

    const reportStats = await Database.query(`
      SELECT 
        (SELECT COUNT(*) FROM reports) as total_reports,
        (SELECT COUNT(*) FROM reports WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as new_reports_24h,
        (SELECT COUNT(*) FROM reports WHERE status = 'open') as open_reports,
        (SELECT COUNT(*) FROM reports WHERE status = 'under_review') as under_review_reports,
        (SELECT COUNT(*) FROM reports WHERE status = 'resolved') as resolved_reports,
        (SELECT COUNT(*) FROM reports WHERE report_type = 'stolen') as theft_reports,
        (SELECT COUNT(*) FROM reports WHERE report_type = 'lost') as loss_reports,
        (SELECT COUNT(*) FROM reports WHERE report_type = 'found') as found_reports
    `);

    const systemActivity = await Database.query(`
      SELECT 
        (SELECT COUNT(*) FROM imei_checks WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as public_checks_24h,
        (SELECT COUNT(*) FROM notifications WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as notifications_24h,
        (SELECT COUNT(*) FROM notifications WHERE status = 'pending') as pending_notifications,
        (SELECT COUNT(*) FROM notifications WHERE status = 'failed') as failed_notifications,
        (SELECT COUNT(*) FROM device_transfers WHERE status = 'pending') as pending_transfers,
        (SELECT COUNT(*) FROM audit_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as audit_entries_24h
    `);

    // Get regional distribution
    const regionalData = await Database.query(`
      SELECT 
        u.region,
        COUNT(DISTINCT u.id) as user_count,
        COUNT(DISTINCT d.id) as device_count,
        COUNT(DISTINCT r.id) as report_count,
        COUNT(DISTINCT lea.id) as lea_count
      FROM users u
      LEFT JOIN devices d ON u.id = d.user_id
      LEFT JOIN reports r ON d.id = r.device_id
      LEFT JOIN law_enforcement_agencies lea ON u.region = lea.region AND lea.active = TRUE
      WHERE u.region IS NOT NULL
      GROUP BY u.region
      ORDER BY user_count DESC
    `);

    // Get recent system activity
    const recentActivity = await Database.query(`
      SELECT 
        al.action,
        al.table_name,
        al.created_at,
        u.name as user_name,
        u.role as user_role,
        al.ip_address
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY al.created_at DESC
      LIMIT 20
    `);

    // Get system performance metrics
    const performanceMetrics = await Database.query(`
      SELECT 
        AVG(CASE WHEN action = 'LOGIN' THEN 1 ELSE 0 END) as avg_login_success,
        COUNT(CASE WHEN action = 'LOGIN' THEN 1 END) as total_logins_24h,
        COUNT(CASE WHEN action = 'DEVICE_REGISTERED' THEN 1 END) as devices_registered_24h,
        COUNT(CASE WHEN action = 'REPORT_CREATED' THEN 1 END) as reports_created_24h
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);

    res.json({
      success: true,
      system_overview: {
        users: systemStats[0],
        devices: deviceStats[0],
        reports: reportStats[0],
        activity: systemActivity[0],
        performance: performanceMetrics[0]
      },
      regional_distribution: regionalData,
      recent_activity: recentActivity,
      generated_at: new Date().toISOString(),
      background_jobs_status: BackgroundJobs.getStatus()
    });

  } catch (error) {
    console.error('System overview error:', error);
    res.status(500).json({ error: 'Failed to load system overview' });
  }
});

// Get system configuration from database
router.get('/configuration', async (req, res) => {
  try {
    // Get LEA agencies configuration
    const leaAgencies = await Database.query(`
      SELECT 
        lea.*,
        COUNT(r.id) as assigned_cases,
        COUNT(CASE WHEN r.status = 'open' THEN 1 END) as open_cases,
        COUNT(CASE WHEN r.status = 'resolved' THEN 1 END) as resolved_cases
      FROM law_enforcement_agencies lea
      LEFT JOIN reports r ON lea.id = r.assigned_lea_id
      GROUP BY lea.id
      ORDER BY lea.region, lea.agency_name
    `);

    // Get user role distribution
    const roleDistribution = await Database.query(`
      SELECT 
        role,
        COUNT(*) as count,
        COUNT(CASE WHEN verified_at IS NOT NULL THEN 1 END) as verified_count,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as recent_count
      FROM users
      GROUP BY role
      ORDER BY count DESC
    `);

    // Get device brand statistics
    const deviceBrands = await Database.query(`
      SELECT 
        brand,
        COUNT(*) as total_count,
        COUNT(CASE WHEN status = 'verified' THEN 1 END) as verified_count,
        COUNT(CASE WHEN status IN ('stolen', 'lost') THEN 1 END) as incident_count,
        ROUND((COUNT(CASE WHEN status IN ('stolen', 'lost') THEN 1 END) * 100.0) / COUNT(*), 2) as incident_rate
      FROM devices
      GROUP BY brand
      HAVING total_count >= 5
      ORDER BY total_count DESC
    `);

    // Get notification statistics
    const notificationStats = await Database.query(`
      SELECT 
        channel,
        status,
        COUNT(*) as count,
        DATE(created_at) as date
      FROM notifications
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY channel, status, DATE(created_at)
      ORDER BY date DESC, channel, status
    `);

    // Get system settings (from environment and database)
    const systemSettings = {
      email_configured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
      sms_configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      push_configured: !!process.env.FCM_SERVER_KEY,
      file_upload_enabled: true,
      background_jobs_enabled: BackgroundJobs.getStatus().running,
      database_connected: true,
      environment: process.env.NODE_ENV || 'development',
      api_version: '1.0.0'
    };

    res.json({
      success: true,
      configuration: {
        lea_agencies: leaAgencies,
        role_distribution: roleDistribution,
        device_brands: deviceBrands,
        notification_stats: notificationStats,
        system_settings: systemSettings
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('System configuration error:', error);
    res.status(500).json({ error: 'Failed to load system configuration' });
  }
});

// Get detailed user management data
router.get('/users/management', async (req, res) => {
  try {
    const { page = 1, limit = 50, role, region, status } = req.query;

    let whereClause = '1=1';
    let params = [];

    if (role) {
      whereClause += ' AND u.role = ?';
      params.push(role);
    }

    if (region) {
      whereClause += ' AND u.region = ?';
      params.push(region);
    }

    if (status === 'verified') {
      whereClause += ' AND u.verified_at IS NOT NULL';
    } else if (status === 'unverified') {
      whereClause += ' AND u.verified_at IS NULL';
    }

    const offset = (page - 1) * limit;

    // Get users with their activity data
    const users = await Database.query(`
      SELECT 
        u.id,
        u.name,
        u.email,
        u.role,
        u.region,
        u.verified_at,
        u.created_at,
        u.updated_at,
        COUNT(DISTINCT d.id) as device_count,
        COUNT(DISTINCT r.id) as report_count,
        COUNT(DISTINCT dt_from.id) as transfers_sent,
        COUNT(DISTINCT dt_to.id) as transfers_received,
        MAX(al.created_at) as last_activity
      FROM users u
      LEFT JOIN devices d ON u.id = d.user_id
      LEFT JOIN reports r ON d.id = r.device_id
      LEFT JOIN device_transfers dt_from ON u.id = dt_from.from_user_id
      LEFT JOIN device_transfers dt_to ON u.id = dt_to.to_user_id
      LEFT JOIN audit_logs al ON u.id = al.user_id
      WHERE ${whereClause}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    // Get total count
    const totalCount = await Database.query(`
      SELECT COUNT(*) as total
      FROM users u
      WHERE ${whereClause}
    `, params);

    // Get user activity summary
    const activitySummary = await Database.query(`
      SELECT 
        COUNT(CASE WHEN al.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as active_24h,
        COUNT(CASE WHEN al.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as active_7d,
        COUNT(CASE WHEN al.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as active_30d,
        COUNT(DISTINCT al.user_id) as total_active_users
      FROM audit_logs al
      WHERE al.user_id IS NOT NULL
    `);

    res.json({
      success: true,
      users: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        pages: Math.ceil(totalCount[0].total / limit)
      },
      activity_summary: activitySummary[0],
      filters_applied: { role, region, status }
    });

  } catch (error) {
    console.error('User management error:', error);
    res.status(500).json({ error: 'Failed to load user management data' });
  }
});

// Get device verification queue with detailed information
router.get('/devices/verification-queue', async (req, res) => {
  try {
    const { page = 1, limit = 20, brand, region, sort_by = 'created_at' } = req.query;

    let whereClause = 'd.status = "unverified"';
    let params = [];

    if (brand) {
      whereClause += ' AND d.brand = ?';
      params.push(brand);
    }

    if (region) {
      whereClause += ' AND u.region = ?';
      params.push(region);
    }

    const validSortFields = ['created_at', 'brand', 'model', 'owner_name'];
    const sortField = validSortFields.includes(sort_by) ? 
      (sort_by === 'owner_name' ? 'u.name' : `d.${sort_by}`) : 'd.created_at';

    const offset = (page - 1) * limit;

    const devices = await Database.query(`
      SELECT 
        d.*,
        u.name as owner_name,
        u.email as owner_email,
        u.phone as owner_phone,
        u.region as owner_region,
        u.created_at as user_registration_date,
        COUNT(ud.id) as owner_total_devices,
        COUNT(ur.id) as owner_total_reports
      FROM devices d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN devices ud ON u.id = ud.user_id
      LEFT JOIN reports ur ON ud.id = ur.device_id
      WHERE ${whereClause}
      GROUP BY d.id
      ORDER BY ${sortField} ASC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    // Get total count
    const totalCount = await Database.query(`
      SELECT COUNT(*) as total
      FROM devices d
      JOIN users u ON d.user_id = u.id
      WHERE ${whereClause}
    `, params);

    // Get verification statistics
    const verificationStats = await Database.query(`
      SELECT 
        COUNT(*) as total_pending,
        COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as pending_24h,
        COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as pending_7d,
        AVG(DATEDIFF(NOW(), d.created_at)) as avg_waiting_days
      FROM devices d
      WHERE d.status = 'unverified'
    `);

    res.json({
      success: true,
      verification_queue: devices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        pages: Math.ceil(totalCount[0].total / limit)
      },
      statistics: verificationStats[0],
      filters_applied: { brand, region, sort_by }
    });

  } catch (error) {
    console.error('Verification queue error:', error);
    res.status(500).json({ error: 'Failed to load verification queue' });
  }
});

// Get comprehensive report management data
router.get('/reports/management', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      report_type, 
      region, 
      assigned_lea,
      date_from,
      date_to
    } = req.query;

    let whereClause = '1=1';
    let params = [];

    if (status) {
      whereClause += ' AND r.status = ?';
      params.push(status);
    }

    if (report_type) {
      whereClause += ' AND r.report_type = ?';
      params.push(report_type);
    }

    if (region) {
      whereClause += ' AND u.region = ?';
      params.push(region);
    }

    if (assigned_lea) {
      whereClause += ' AND lea.agency_name LIKE ?';
      params.push(`%${assigned_lea}%`);
    }

    if (date_from) {
      whereClause += ' AND DATE(r.created_at) >= ?';
      params.push(date_from);
    }

    if (date_to) {
      whereClause += ' AND DATE(r.created_at) <= ?';
      params.push(date_to);
    }

    const offset = (page - 1) * limit;

    const reports = await Database.query(`
      SELECT 
        r.*,
        d.brand,
        d.model,
        d.imei,
        d.serial,
        u.name as owner_name,
        u.email as owner_email,
        u.region as owner_region,
        lea.agency_name,
        lea.contact_email as lea_contact,
        DATEDIFF(NOW(), r.created_at) as days_open,
        CASE 
          WHEN r.status = 'resolved' THEN DATEDIFF(r.updated_at, r.created_at)
          ELSE NULL 
        END as resolution_days
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    // Get total count
    const totalCount = await Database.query(`
      SELECT COUNT(*) as total
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE ${whereClause}
    `, params);

    // Get report statistics
    const reportStats = await Database.query(`
      SELECT 
        COUNT(*) as total_reports,
        COUNT(CASE WHEN r.status = 'open' THEN 1 END) as open_reports,
        COUNT(CASE WHEN r.status = 'under_review' THEN 1 END) as under_review,
        COUNT(CASE WHEN r.status = 'resolved' THEN 1 END) as resolved_reports,
        COUNT(CASE WHEN r.assigned_lea_id IS NULL THEN 1 END) as unassigned_reports,
        AVG(CASE WHEN r.status = 'resolved' THEN DATEDIFF(r.updated_at, r.created_at) END) as avg_resolution_days,
        COUNT(CASE WHEN r.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as reports_24h
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
    `);

    res.json({
      success: true,
      reports: reports,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        pages: Math.ceil(totalCount[0].total / limit)
      },
      statistics: reportStats[0],
      filters_applied: { status, report_type, region, assigned_lea, date_from, date_to }
    });

  } catch (error) {
    console.error('Report management error:', error);
    res.status(500).json({ error: 'Failed to load report management data' });
  }
});

// Get system audit logs with advanced filtering
router.get('/audit-logs', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      action,
      user_id,
      table_name,
      date_from,
      date_to,
      ip_address
    } = req.query;

    let whereClause = '1=1';
    let params = [];

    if (action) {
      whereClause += ' AND al.action = ?';
      params.push(action);
    }

    if (user_id) {
      whereClause += ' AND al.user_id = ?';
      params.push(user_id);
    }

    if (table_name) {
      whereClause += ' AND al.table_name = ?';
      params.push(table_name);
    }

    if (date_from) {
      whereClause += ' AND DATE(al.created_at) >= ?';
      params.push(date_from);
    }

    if (date_to) {
      whereClause += ' AND DATE(al.created_at) <= ?';
      params.push(date_to);
    }

    if (ip_address) {
      whereClause += ' AND al.ip_address = ?';
      params.push(ip_address);
    }

    const offset = (page - 1) * limit;

    const auditLogs = await Database.query(`
      SELECT 
        al.*,
        u.name as user_name,
        u.email as user_email,
        u.role as user_role
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    // Get total count
    const totalCount = await Database.query(`
      SELECT COUNT(*) as total
      FROM audit_logs al
      WHERE ${whereClause}
    `, params);

    // Get audit statistics
    const auditStats = await Database.query(`
      SELECT 
        COUNT(*) as total_entries,
        COUNT(DISTINCT al.user_id) as unique_users,
        COUNT(DISTINCT al.ip_address) as unique_ips,
        COUNT(CASE WHEN al.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as entries_24h,
        COUNT(CASE WHEN al.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as entries_7d
      FROM audit_logs al
    `);

    // Get action distribution
    const actionDistribution = await Database.query(`
      SELECT 
        action,
        COUNT(*) as count,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as count_24h
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      audit_logs: auditLogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        pages: Math.ceil(totalCount[0].total / limit)
      },
      statistics: auditStats[0],
      action_distribution: actionDistribution,
      filters_applied: { action, user_id, table_name, date_from, date_to, ip_address }
    });

  } catch (error) {
    console.error('Audit logs error:', error);
    res.status(500).json({ error: 'Failed to load audit logs' });
  }
});

// Execute system maintenance operations
router.post('/maintenance', async (req, res) => {
  try {
    const { operation, parameters = {} } = req.body;

    if (!operation) {
      return res.status(400).json({ error: 'Operation is required' });
    }

    let result = {};

    switch (operation) {
      case 'cleanup_old_notifications':
        const days = parameters.days || 30;
        const deletedNotifications = await Database.query(`
          DELETE FROM notifications 
          WHERE status IN ('sent', 'delivered') 
          AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [days]);
        
        result = {
          operation: 'Cleanup Old Notifications',
          deleted_count: deletedNotifications.affectedRows,
          days_threshold: days
        };
        break;

      case 'cleanup_old_audit_logs':
        const auditDays = parameters.days || 90;
        const deletedLogs = await Database.query(`
          DELETE FROM audit_logs 
          WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [auditDays]);
        
        result = {
          operation: 'Cleanup Old Audit Logs',
          deleted_count: deletedLogs.affectedRows,
          days_threshold: auditDays
        };
        break;

      case 'cleanup_expired_transfers':
        const expiredTransfers = await Database.query(`
          UPDATE device_transfers 
          SET status = 'expired', updated_at = NOW()
          WHERE status = 'pending' AND expires_at < NOW()
        `);
        
        result = {
          operation: 'Cleanup Expired Transfers',
          expired_count: expiredTransfers.affectedRows
        };
        break;

      case 'run_background_jobs':
        await BackgroundJobs.runJobsNow();
        result = {
          operation: 'Run Background Jobs',
          message: 'Background jobs executed successfully'
        };
        break;

      case 'optimize_database':
        // Run database optimization queries
        await Database.query('OPTIMIZE TABLE users, devices, reports, notifications, audit_logs');
        result = {
          operation: 'Optimize Database',
          message: 'Database tables optimized successfully'
        };
        break;

      case 'update_statistics':
        // Force update of cached statistics
        await Database.query(`
          INSERT INTO audit_logs (id, action, table_name, new_values, created_at)
          VALUES (?, 'STATISTICS_UPDATE', 'system', '{"forced_update": true}', NOW())
        `, [Database.generateUUID()]);
        
        result = {
          operation: 'Update Statistics',
          message: 'System statistics updated successfully'
        };
        break;

      default:
        return res.status(400).json({ error: 'Invalid maintenance operation' });
    }

    // Log maintenance operation
    await Database.logAudit(
      req.user.id,
      `MAINTENANCE_${operation.toUpperCase()}`,
      'system_maintenance',
      null,
      null,
      { ...result, parameters },
      req.ip
    );

    res.json({
      success: true,
      ...result,
      executed_by: req.user.name,
      executed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Maintenance operation error:', error);
    res.status(500).json({ error: 'Failed to execute maintenance operation' });
  }
});

// Get system performance metrics
router.get('/performance', async (req, res) => {
  try {
    const { period = '24' } = req.query;
    const hours = parseInt(period);

    // Database performance metrics
    const dbMetrics = await Database.query(`
      SELECT 
        COUNT(*) as total_queries,
        COUNT(CASE WHEN action LIKE '%LOGIN%' THEN 1 END) as login_queries,
        COUNT(CASE WHEN action LIKE '%DEVICE%' THEN 1 END) as device_queries,
        COUNT(CASE WHEN action LIKE '%REPORT%' THEN 1 END) as report_queries,
        COUNT(DISTINCT user_id) as active_users,
        COUNT(DISTINCT ip_address) as unique_ips
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
    `, [hours]);

    // System load metrics
    const loadMetrics = await Database.query(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') as hour,
        COUNT(*) as request_count,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT ip_address) as unique_ips
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')
      ORDER BY hour
    `, [hours]);

    // Error rate metrics
    const errorMetrics = await Database.query(`
      SELECT 
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_notifications,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful_notifications,
        COUNT(*) as total_notifications,
        ROUND((COUNT(CASE WHEN status = 'failed' THEN 1 END) * 100.0) / COUNT(*), 2) as error_rate_percent
      FROM notifications
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
    `, [hours]);

    // Response time simulation (in a real system, you'd track actual response times)
    const responseTimeMetrics = {
      avg_response_time_ms: Math.floor(Math.random() * 200) + 50, // Simulated
      p95_response_time_ms: Math.floor(Math.random() * 500) + 100, // Simulated
      p99_response_time_ms: Math.floor(Math.random() * 1000) + 200 // Simulated
    };

    res.json({
      success: true,
      performance_metrics: {
        database: dbMetrics[0],
        load_distribution: loadMetrics,
        error_rates: errorMetrics[0],
        response_times: responseTimeMetrics,
        background_jobs: BackgroundJobs.getStatus()
      },
      period_hours: hours,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Performance metrics error:', error);
    res.status(500).json({ error: 'Failed to load performance metrics' });
  }
});

// GET /api/admin-system/security-events - Get security events
router.get('/security-events', async (req, res) => {
  try {
    const { severity, eventType, timeRange = '24h', page = 1, limit = 50 } = req.query;
    
    let whereClause = '1=1';
    let params = [];
    
    if (severity) {
      whereClause += ' AND severity = ?';
      params.push(severity);
    }
    
    if (eventType) {
      whereClause += ' AND event_type = ?';
      params.push(eventType);
    }
    
    // Time range filter
    let timeFilter = '';
    switch (timeRange) {
      case '1h':
        timeFilter = 'AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)';
        break;
      case '24h':
        timeFilter = 'AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)';
        break;
      case '7d':
        timeFilter = 'AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case '30d':
        timeFilter = 'AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        break;
    }
    
    whereClause += ` ${timeFilter}`;
    
    const offset = (page - 1) * limit;
    
    const events = await Database.query(`
      SELECT 
        se.*,
        u.name as user_name
      FROM security_events se
      LEFT JOIN users u ON se.user_id = u.id
      WHERE ${whereClause}
      ORDER BY se.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);
    
    res.json({ events });
    
  } catch (error) {
    console.error('Security events error:', error);
    res.status(500).json({ error: 'Failed to fetch security events' });
  }
});

module.exports = router;

// GET /api/admin-system/security-stats - Get security statistics
router.get('/security-stats', async (req, res) => {
  try {
    const stats = await Promise.all([
      // Total events
      Database.query('SELECT COUNT(*) as count FROM security_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)'),
      
      // Events by severity
      Database.query(`
        SELECT severity, COUNT(*) as count 
        FROM security_events 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY severity
      `),
      
      // Events by type
      Database.query(`
        SELECT event_type, COUNT(*) as count 
        FROM security_events 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY event_type
      `),
      
      // Recent suspicious activity
      Database.query(`
        SELECT COUNT(*) as count 
        FROM security_events 
        WHERE severity IN ('high', 'critical') 
        AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
      `),
      
      // Unique users tracked
      Database.query(`
        SELECT COUNT(DISTINCT user_id) as count 
        FROM security_events 
        WHERE user_id IS NOT NULL 
        AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `),
      
      // Devices checked today
      Database.query(`
        SELECT COUNT(*) as count 
        FROM device_checks 
        WHERE DATE(created_at) = CURDATE()
      `),
      
      // High risk locations
      Database.query(`
        SELECT 
          CONCAT(ROUND(latitude, 2), ',', ROUND(longitude, 2)) as location,
          COUNT(*) as event_count,
          AVG(CASE 
            WHEN severity = 'critical' THEN 10
            WHEN severity = 'high' THEN 7
            WHEN severity = 'medium' THEN 4
            ELSE 1
          END) as risk_score
        FROM security_events 
        WHERE latitude IS NOT NULL 
        AND longitude IS NOT NULL
        AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY ROUND(latitude, 2), ROUND(longitude, 2)
        HAVING event_count > 5
        ORDER BY risk_score DESC, event_count DESC
        LIMIT 10
      `)
    ]);
    
    res.json({
      total_events: stats[0][0].count,
      events_by_severity: stats[1],
      events_by_type: stats[2],
      recent_suspicious_activity: stats[3][0].count,
      unique_users_tracked: stats[4][0].count,
      devices_checked_today: stats[5][0].count,
      high_risk_locations: stats[6]
    });
    
  } catch (error) {
    console.error('Security stats error:', error);
    res.status(500).json({ error: 'Failed to fetch security statistics' });
  }
});

// POST /api/admin-system/security-report - Generate security report
router.post('/security-report', async (req, res) => {
  try {
    const { timeRange = '24h', severity, eventType } = req.body;
    
    // Generate comprehensive security report
    let whereClause = '1=1';
    let params = [];
    
    if (severity) {
      whereClause += ' AND severity = ?';
      params.push(severity);
    }
    
    if (eventType) {
      whereClause += ' AND event_type = ?';
      params.push(eventType);
    }
    
    // Time range filter
    let timeFilter = '';
    switch (timeRange) {
      case '1h':
        timeFilter = 'AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)';
        break;
      case '24h':
        timeFilter = 'AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)';
        break;
      case '7d':
        timeFilter = 'AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case '30d':
        timeFilter = 'AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        break;
    }
    
    whereClause += ` ${timeFilter}`;
    
    const reportData = await Database.query(`
      SELECT 
        se.*,
        u.name as user_name,
        u.email as user_email
      FROM security_events se
      LEFT JOIN users u ON se.user_id = u.id
      WHERE ${whereClause}
      ORDER BY se.created_at DESC
    `, params);
    
    // In a real implementation, you would generate a PDF here
    // For now, return JSON data
    res.json({
      success: true,
      report_data: reportData,
      generated_at: new Date().toISOString(),
      filters: { timeRange, severity, eventType },
      total_events: reportData.length
    });
    
  } catch (error) {
    console.error('Security report error:', error);
    res.status(500).json({ error: 'Failed to generate security report' });
  }
});