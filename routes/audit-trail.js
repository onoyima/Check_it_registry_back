const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const AuditService = require('../services/AuditService');
const Database = require('../config');
const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Admin-only middleware for specific endpoints
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// GET /logs - Get audit trail with filtering and pagination
router.get('/logs', requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search,
      severity,
      resource_type,
      status,
      user_id,
      action,
      start_date,
      end_date,
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Build WHERE clause
    let whereConditions = [];
    let queryParams = [];

    if (search) {
      whereConditions.push(`(
        al.action LIKE ? OR 
        al.details LIKE ? OR 
        u.name LIKE ? OR 
        u.email LIKE ?
      )`);
      const searchTerm = `%${search}%`;
      queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (severity) {
      whereConditions.push('al.severity = ?');
      queryParams.push(severity);
    }

    if (resource_type) {
      whereConditions.push('al.resource_type = ?');
      queryParams.push(resource_type);
    }

    if (status) {
      whereConditions.push('al.status = ?');
      queryParams.push(status);
    }

    if (user_id) {
      whereConditions.push('al.user_id = ?');
      queryParams.push(user_id);
    }

    if (action) {
      whereConditions.push('al.action = ?');
      queryParams.push(action);
    }

    if (start_date && end_date) {
      whereConditions.push('DATE(al.created_at) BETWEEN ? AND ?');
      queryParams.push(start_date, end_date);
    } else if (start_date) {
      whereConditions.push('DATE(al.created_at) >= ?');
      queryParams.push(start_date);
    } else if (end_date) {
      whereConditions.push('DATE(al.created_at) <= ?');
      queryParams.push(end_date);
    }

    const whereClause = whereConditions.length > 0 ? 
      `WHERE ${whereConditions.join(' AND ')}` : '';

    // Validate sort parameters
    const allowedSortFields = ['created_at', 'action', 'severity', 'user_id', 'resource_type'];
    const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Get audit logs with user information
    const logs = await Database.query(`
      SELECT 
        al.id,
        al.user_id,
        u.name as user_name,
        u.email as user_email,
        u.role as user_role,
        al.action,
        al.resource_type,
        al.resource_id,
        al.details,
        al.ip_address,
        al.user_agent,
        al.severity,
        al.status,
        al.created_at
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.${sortField} ${sortDirection}
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), offset]);

    // Get total count for pagination
    const countResult = await Database.query(`
      SELECT COUNT(*) as total
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
    `, queryParams);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / parseInt(limit));

    // Log this audit trail access
    await AuditService.logActivity(req, req.user.id, 'audit_trail_accessed', 'system', null, null, null, { details: `Admin accessed audit trail (page ${page})` });

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: totalPages,
        has_next: parseInt(page) < totalPages,
        has_prev: parseInt(page) > 1
      },
      filters: {
        search,
        severity,
        resource_type,
        status,
        user_id,
        action,
        start_date,
        end_date
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// GET /stats - Get audit statistics
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const { period = '30' } = req.query;

    // Get comprehensive audit statistics
    const stats = await Database.query(`
      SELECT 
        COUNT(*) as total_events,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as events_24h,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_events,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_actions,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(CASE WHEN action LIKE '%login%' THEN 1 END) as login_events,
        COUNT(CASE WHEN resource_type = 'device' THEN 1 END) as device_events,
        COUNT(CASE WHEN resource_type = 'report' THEN 1 END) as report_events,
        COUNT(CASE WHEN resource_type = 'user' THEN 1 END) as user_events
      FROM audit_logs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [parseInt(period)]);

    // Get top actions
    const topActions = await Database.query(`
      SELECT 
        action,
        COUNT(*) as count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
      FROM audit_logs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY action 
      ORDER BY count DESC 
      LIMIT 10
    `, [parseInt(period)]);

    // Get top users by activity
    const topUsers = await Database.query(`
      SELECT 
        al.user_id,
        u.name,
        u.email,
        u.role,
        COUNT(*) as activity_count,
        COUNT(CASE WHEN al.status = 'failed' THEN 1 END) as failed_count
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY al.user_id, u.name, u.email, u.role
      ORDER BY activity_count DESC 
      LIMIT 10
    `, [parseInt(period)]);

    // Get activity by hour (last 24 hours)
    const hourlyActivity = await Database.query(`
      SELECT 
        HOUR(created_at) as hour,
        COUNT(*) as count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
      FROM audit_logs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY HOUR(created_at)
      ORDER BY hour
    `);

    // Get security events
    const securityEvents = await Database.query(`
      SELECT 
        COUNT(CASE WHEN action LIKE '%failed_login%' THEN 1 END) as failed_logins,
        COUNT(CASE WHEN action LIKE '%password_change%' THEN 1 END) as password_changes,
        COUNT(CASE WHEN action LIKE '%role_change%' THEN 1 END) as role_changes,
        COUNT(CASE WHEN action LIKE '%account_locked%' THEN 1 END) as account_locks,
        COUNT(CASE WHEN severity = 'critical' AND resource_type = 'auth' THEN 1 END) as critical_auth_events
      FROM audit_logs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [parseInt(period)]);

    res.json({
      overview: stats[0],
      top_actions: topActions,
      top_users: topUsers,
      hourly_activity: hourlyActivity,
      security_events: securityEvents[0],
      period: parseInt(period)
    });
  } catch (error) {
    console.error('Error fetching audit statistics:', error);
    res.status(500).json({ error: 'Failed to fetch audit statistics' });
  }
});

// GET /logs/:id - Get specific audit log details
router.get('/logs/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const logs = await Database.query(`
      SELECT 
        al.*,
        u.name as user_name,
        u.email as user_email,
        u.role as user_role
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.id = ?
    `, [id]);

    if (logs.length === 0) {
      return res.status(404).json({ error: 'Audit log not found' });
    }

    // Get related logs (same user, same resource, within 1 hour)
    const log = logs[0];
    const relatedLogs = await Database.query(`
      SELECT 
        id, action, resource_type, resource_id, details, created_at, status
      FROM audit_logs 
      WHERE 
        id != ? AND
        (user_id = ? OR (resource_type = ? AND resource_id = ?)) AND
        ABS(TIMESTAMPDIFF(MINUTE, created_at, ?)) <= 60
      ORDER BY created_at DESC
      LIMIT 10
    `, [id, log.user_id, log.resource_type, log.resource_id, log.created_at]);

    await AuditService.logActivity(req, req.user.id, 'audit_log_viewed', 'system', id, null, null, { details: `Admin viewed audit log details (ID: ${id})` });

    res.json({
      log,
      related_logs: relatedLogs
    });
  } catch (error) {
    console.error('Error fetching audit log details:', error);
    res.status(500).json({ error: 'Failed to fetch audit log details' });
  }
});

// GET /export - Export audit logs
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const {
      format = 'json',
      start_date,
      end_date,
      severity,
      resource_type,
      user_id
    } = req.query;

    // Build WHERE clause for export
    let whereConditions = [];
    let queryParams = [];

    if (start_date && end_date) {
      whereConditions.push('DATE(al.created_at) BETWEEN ? AND ?');
      queryParams.push(start_date, end_date);
    }

    if (severity) {
      whereConditions.push('al.severity = ?');
      queryParams.push(severity);
    }

    if (resource_type) {
      whereConditions.push('al.resource_type = ?');
      queryParams.push(resource_type);
    }

    if (user_id) {
      whereConditions.push('al.user_id = ?');
      queryParams.push(user_id);
    }

    const whereClause = whereConditions.length > 0 ? 
      `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get audit logs for export (limit to 10000 for performance)
    const logs = await Database.query(`
      SELECT 
        al.id,
        al.user_id,
        u.name as user_name,
        u.email as user_email,
        u.role as user_role,
        al.action,
        al.resource_type,
        al.resource_id,
        al.details,
        al.ip_address,
        al.user_agent,
        al.severity,
        al.status,
        al.created_at
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT 10000
    `, queryParams);

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `audit-logs-${timestamp}`;

    if (format === 'csv') {
      // Convert to CSV
      const csv = [
        // Header
        'ID,User ID,User Name,User Email,User Role,Action,Resource Type,Resource ID,Details,IP Address,User Agent,Severity,Status,Created At',
        // Data rows
        ...logs.map(log => [
          log.id,
          log.user_id || '',
          log.user_name || '',
          log.user_email || '',
          log.user_role || '',
          log.action,
          log.resource_type,
          log.resource_id || '',
          `"${(log.details || '').replace(/"/g, '""')}"`,
          log.ip_address,
          `"${(log.user_agent || '').replace(/"/g, '""')}"`,
          log.severity,
          log.status,
          log.created_at
        ].join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csv);
    } else {
      // JSON format
      const exportData = {
        exported_at: new Date().toISOString(),
        exported_by: req.user.id,
        filters: { start_date, end_date, severity, resource_type, user_id },
        total_records: logs.length,
        logs
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json(exportData);
    }

    // Log the export
    await AuditService.logActivity(req, req.user.id, 'audit_logs_exported', 'system', null, null, null, { details: `Admin exported ${logs.length} audit logs (format: ${format})` });

  } catch (error) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({ error: 'Failed to export audit logs' });
  }
});

// GET /system-health - Get system health metrics
router.get('/system-health', requireAdmin, async (req, res) => {
  try {
    // Get database health
    const dbHealth = await Database.query('SELECT 1 as healthy');
    
    // Get recent error rates
    const errorRates = await Database.query(`
      SELECT 
        COUNT(*) as total_events,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_events,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_events
      FROM audit_logs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `);

    // Get active sessions
    const activeSessions = await Database.query(`
      SELECT COUNT(DISTINCT user_id) as active_users
      FROM audit_logs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
    `);

    // Get system performance metrics
    const performanceMetrics = await Database.query(`
      SELECT 
        AVG(CASE WHEN action LIKE '%_response_time' THEN CAST(details AS UNSIGNED) END) as avg_response_time,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) THEN 1 END) as events_last_5min
      FROM audit_logs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `);

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        status: dbHealth.length > 0 ? 'healthy' : 'unhealthy',
        connection: true
      },
      error_rates: {
        total_events: errorRates[0].total_events,
        failed_events: errorRates[0].failed_events,
        critical_events: errorRates[0].critical_events,
        error_rate: errorRates[0].total_events > 0 ? 
          (errorRates[0].failed_events / errorRates[0].total_events * 100).toFixed(2) : 0
      },
      active_sessions: activeSessions[0].active_users,
      performance: {
        avg_response_time: performanceMetrics[0].avg_response_time || 0,
        events_last_5min: performanceMetrics[0].events_last_5min
      }
    };

    res.json(health);
  } catch (error) {
    console.error('Error fetching system health:', error);
    res.status(500).json({ 
      status: 'unhealthy',
      error: 'Failed to fetch system health metrics',
      timestamp: new Date().toISOString()
    });
  }
});

// GET /my/logs - User's own audit logs
router.get('/my/logs', async (req, res) => {
  try {
    const { page = 1, limit = 50, start_date, end_date, action, resource_type, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereConditions = ['al.user_id = ?'];
    let queryParams = [req.user.id];

    if (action) { whereConditions.push('al.action = ?'); queryParams.push(action); }
    if (resource_type) { whereConditions.push('al.resource_type = ?'); queryParams.push(resource_type); }
    if (status) { whereConditions.push('al.status = ?'); queryParams.push(status); }
    if (start_date && end_date) {
      whereConditions.push('DATE(al.created_at) BETWEEN ? AND ?');
      queryParams.push(start_date, end_date);
    }

    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const logs = await Database.query(`
      SELECT 
        al.id, al.user_id, al.action, al.resource_type, al.resource_id, al.details,
        al.ip_address, al.user_agent, al.severity, al.status, al.created_at,
        u.name as user_name, u.email as user_email, u.role as user_role
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), offset]);

    const countResult = await Database.query(`
      SELECT COUNT(*) as total
      FROM audit_logs al
      ${whereClause}
    `, queryParams);

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        pages: Math.ceil(countResult[0].total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching my audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch your audit logs' });
  }
});

// GET /lea/logs - Region-scoped audit logs for LEA
router.get('/lea/logs', requireRole(['lea','admin']), async (req, res) => {
  try {
    const { page = 1, limit = 50, start_date, end_date, action, resource_type, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const region = req.user.region;
    let whereConditions = ['COALESCE(u.region, "") = ?'];
    let queryParams = [region];

    if (action) { whereConditions.push('al.action = ?'); queryParams.push(action); }
    if (resource_type) { whereConditions.push('al.resource_type = ?'); queryParams.push(resource_type); }
    if (status) { whereConditions.push('al.status = ?'); queryParams.push(status); }
    if (start_date && end_date) {
      whereConditions.push('DATE(al.created_at) BETWEEN ? AND ?');
      queryParams.push(start_date, end_date);
    }

    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const logs = await Database.query(`
      SELECT 
        al.id, al.user_id, u.name as user_name, u.email as user_email, u.role as user_role,
        al.action, al.resource_type, al.resource_id, al.details,
        al.ip_address, al.user_agent, al.severity, al.status, al.created_at
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), offset]);

    const countResult = await Database.query(`
      SELECT COUNT(*) as total
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
    `, queryParams);

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        pages: Math.ceil(countResult[0].total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching LEA audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch LEA audit logs' });
  }
});

module.exports = router;