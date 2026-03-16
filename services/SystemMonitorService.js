// System Monitoring Service - Professional System Health Monitoring
const Database = require('../config');
const NotificationService = require('./NotificationService');

class SystemMonitorService {
  constructor() {
    this.monitoringInterval = null;
    this.alertThresholds = {
      failed_notifications: 10,
      pending_verifications: 50,
      open_reports: 100,
      database_response_time: 1000, // ms
      disk_usage: 80, // percentage
      memory_usage: 85 // percentage
    };
  }

  // Start system monitoring
  start() {
    if (this.monitoringInterval) {
      console.log('System monitoring already running');
      return;
    }

    console.log('🔍 Starting system monitoring...');
    
    // Run initial check
    this.performHealthCheck();
    
    // Schedule regular checks every 5 minutes
    this.monitoringInterval = setInterval(() => {
      this.performHealthCheck();
    }, 5 * 60 * 1000);

    console.log('✅ System monitoring started');
  }

  // Stop system monitoring
  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('🛑 System monitoring stopped');
    }
  }

  // Perform comprehensive health check
  async performHealthCheck() {
    try {
      const healthReport = {
        timestamp: new Date(),
        status: 'healthy',
        checks: {},
        alerts: []
      };

      // Database health check
      healthReport.checks.database = await this.checkDatabaseHealth();
      
      // Notification system check
      healthReport.checks.notifications = await this.checkNotificationHealth();
      
      // User activity check
      healthReport.checks.user_activity = await this.checkUserActivity();
      
      // System resources check
      healthReport.checks.system_resources = await this.checkSystemResources();
      
      // Security check
      healthReport.checks.security = await this.checkSecurityHealth();
      
      // Data integrity check
      healthReport.checks.data_integrity = await this.checkDataIntegrity();

      // Determine overall health status
      const failedChecks = Object.values(healthReport.checks).filter(check => check.status !== 'healthy');
      if (failedChecks.length > 0) {
        healthReport.status = failedChecks.some(check => check.severity === 'critical') ? 'critical' : 'warning';
      }

      // Generate alerts for failed checks
      for (const check of failedChecks) {
        if (check.severity === 'critical' || check.severity === 'high') {
          await this.createSystemAlert(check.category, check.severity, check.message, check.details);
        }
      }

      // Log health report
      await this.logHealthReport(healthReport);

      console.log(`🔍 System health check completed: ${healthReport.status.toUpperCase()}`);
      
      return healthReport;

    } catch (error) {
      console.error('Health check error:', error);
      await this.createSystemAlert('system', 'critical', 'Health check failed', { error: error.message });
    }
  }

  // Check database health
  async checkDatabaseHealth() {
    try {
      const startTime = Date.now();
      
      // Test basic connectivity
      await Database.query('SELECT 1');
      
      const responseTime = Date.now() - startTime;
      
      // Check table sizes and performance
      const tableStats = await Database.query(`
        SELECT 
          table_name,
          table_rows,
          data_length,
          index_length
        FROM information_schema.tables 
        WHERE table_schema = DATABASE()
      `);

      // Check for locked tables
      const lockedTables = await Database.query('SHOW OPEN TABLES WHERE In_use > 0');

      const health = {
        status: 'healthy',
        category: 'database',
        response_time: responseTime,
        table_stats: tableStats,
        locked_tables: lockedTables.length,
        details: {
          response_time_ms: responseTime,
          tables_count: tableStats.length,
          locked_tables_count: lockedTables.length
        }
      };

      // Check thresholds
      if (responseTime > this.alertThresholds.database_response_time) {
        health.status = 'warning';
        health.severity = 'medium';
        health.message = `Database response time is high: ${responseTime}ms`;
      }

      if (lockedTables.length > 5) {
        health.status = 'critical';
        health.severity = 'high';
        health.message = `Too many locked tables: ${lockedTables.length}`;
      }

      return health;

    } catch (error) {
      return {
        status: 'critical',
        category: 'database',
        severity: 'critical',
        message: 'Database connection failed',
        details: { error: error.message }
      };
    }
  }

  // Check notification system health
  async checkNotificationHealth() {
    try {
      const [pendingCount] = await Database.query(
        'SELECT COUNT(*) as count FROM notifications WHERE status = "pending"'
      );
      
      const [failedCount] = await Database.query(
        'SELECT COUNT(*) as count FROM notifications WHERE status = "failed" AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
      );

      const [recentSent] = await Database.query(
        'SELECT COUNT(*) as count FROM notifications WHERE status = "sent" AND sent_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
      );

      const health = {
        status: 'healthy',
        category: 'notifications',
        pending_notifications: pendingCount.count,
        failed_notifications: failedCount.count,
        recent_sent: recentSent.count,
        details: {
          pending: pendingCount.count,
          failed_last_hour: failedCount.count,
          sent_last_hour: recentSent.count
        }
      };

      // Check thresholds
      if (failedCount.count > this.alertThresholds.failed_notifications) {
        health.status = 'warning';
        health.severity = 'medium';
        health.message = `High number of failed notifications: ${failedCount.count}`;
      }

      if (pendingCount.count > 100) {
        health.status = 'warning';
        health.severity = 'medium';
        health.message = `Large notification queue: ${pendingCount.count}`;
      }

      return health;

    } catch (error) {
      return {
        status: 'critical',
        category: 'notifications',
        severity: 'high',
        message: 'Notification system check failed',
        details: { error: error.message }
      };
    }
  }

  // Check user activity patterns
  async checkUserActivity() {
    try {
      const [activeUsers] = await Database.query(`
        SELECT COUNT(DISTINCT user_id) as count 
        FROM audit_logs 
        WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `);

      const [newRegistrations] = await Database.query(`
        SELECT COUNT(*) as count 
        FROM users 
        WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `);

      const [newDevices] = await Database.query(`
        SELECT COUNT(*) as count 
        FROM devices 
        WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `);

      const [newReports] = await Database.query(`
        SELECT COUNT(*) as count 
        FROM reports 
        WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `);

      return {
        status: 'healthy',
        category: 'user_activity',
        active_users_24h: activeUsers.count,
        new_registrations_24h: newRegistrations.count,
        new_devices_24h: newDevices.count,
        new_reports_24h: newReports.count,
        details: {
          active_users: activeUsers.count,
          new_registrations: newRegistrations.count,
          new_devices: newDevices.count,
          new_reports: newReports.count
        }
      };

    } catch (error) {
      return {
        status: 'warning',
        category: 'user_activity',
        severity: 'low',
        message: 'User activity check failed',
        details: { error: error.message }
      };
    }
  }

  // Check system resources
  async checkSystemResources() {
    try {
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();

      const health = {
        status: 'healthy',
        category: 'system_resources',
        memory_usage: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
          heap_used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          heap_total: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
          external: Math.round(memoryUsage.external / 1024 / 1024) // MB
        },
        uptime_hours: Math.round(uptime / 3600),
        details: {
          memory_mb: Math.round(memoryUsage.rss / 1024 / 1024),
          uptime_seconds: uptime
        }
      };

      // Check memory usage (basic check)
      const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      if (memoryUsagePercent > this.alertThresholds.memory_usage) {
        health.status = 'warning';
        health.severity = 'medium';
        health.message = `High memory usage: ${memoryUsagePercent.toFixed(1)}%`;
      }

      return health;

    } catch (error) {
      return {
        status: 'warning',
        category: 'system_resources',
        severity: 'low',
        message: 'System resources check failed',
        details: { error: error.message }
      };
    }
  }

  // Check security health
  async checkSecurityHealth() {
    try {
      // Check for suspicious activity
      const [suspiciousLogins] = await Database.query(`
        SELECT COUNT(*) as count 
        FROM audit_logs 
        WHERE action = 'LOGIN' 
        AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
        GROUP BY ip_address 
        HAVING count > 10
        ORDER BY count DESC 
        LIMIT 1
      `);

      const [failedLogins] = await Database.query(`
        SELECT COUNT(*) as count 
        FROM audit_logs 
        WHERE action LIKE '%FAILED%' 
        AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
      `);

      const [activeSuspensions] = await Database.query(`
        SELECT COUNT(*) as count 
        FROM user_suspensions 
        WHERE is_active = TRUE
      `);

      const health = {
        status: 'healthy',
        category: 'security',
        suspicious_activity: suspiciousLogins?.count || 0,
        failed_attempts: failedLogins.count,
        active_suspensions: activeSuspensions.count,
        details: {
          max_logins_per_ip: suspiciousLogins?.count || 0,
          failed_attempts_last_hour: failedLogins.count,
          active_suspensions: activeSuspensions.count
        }
      };

      // Check for security issues
      if ((suspiciousLogins?.count || 0) > 20) {
        health.status = 'warning';
        health.severity = 'high';
        health.message = `Suspicious login activity detected: ${suspiciousLogins.count} attempts from single IP`;
      }

      if (failedLogins.count > 50) {
        health.status = 'warning';
        health.severity = 'medium';
        health.message = `High number of failed login attempts: ${failedLogins.count}`;
      }

      return health;

    } catch (error) {
      return {
        status: 'warning',
        category: 'security',
        severity: 'low',
        message: 'Security check failed',
        details: { error: error.message }
      };
    }
  }

  // Check data integrity
  async checkDataIntegrity() {
    try {
      // Check for orphaned records
      const [orphanedDevices] = await Database.query(`
        SELECT COUNT(*) as count 
        FROM devices d 
        LEFT JOIN users u ON d.user_id = u.id 
        WHERE u.id IS NULL
      `);

      const [orphanedReports] = await Database.query(`
        SELECT COUNT(*) as count 
        FROM reports r 
        LEFT JOIN devices d ON r.device_id = d.id 
        WHERE d.id IS NULL
      `);

      // Check for duplicate IMEIs
      const [duplicateIMEIs] = await Database.query(`
        SELECT COUNT(*) as count 
        FROM (
          SELECT imei 
          FROM devices 
          WHERE imei IS NOT NULL 
          GROUP BY imei 
          HAVING COUNT(*) > 1
        ) as duplicates
      `);

      const health = {
        status: 'healthy',
        category: 'data_integrity',
        orphaned_devices: orphanedDevices.count,
        orphaned_reports: orphanedReports.count,
        duplicate_imeis: duplicateIMEIs.count,
        details: {
          orphaned_devices: orphanedDevices.count,
          orphaned_reports: orphanedReports.count,
          duplicate_imeis: duplicateIMEIs.count
        }
      };

      // Check for data integrity issues
      if (orphanedDevices.count > 0 || orphanedReports.count > 0) {
        health.status = 'warning';
        health.severity = 'medium';
        health.message = `Data integrity issues found: ${orphanedDevices.count} orphaned devices, ${orphanedReports.count} orphaned reports`;
      }

      if (duplicateIMEIs.count > 0) {
        health.status = 'warning';
        health.severity = 'low';
        health.message = `Duplicate IMEIs found: ${duplicateIMEIs.count}`;
      }

      return health;

    } catch (error) {
      return {
        status: 'warning',
        category: 'data_integrity',
        severity: 'low',
        message: 'Data integrity check failed',
        details: { error: error.message }
      };
    }
  }

  // Create system alert
  async createSystemAlert(alertType, severity, title, details) {
    try {
      const alertId = Database.generateUUID();
      
      await Database.insert('system_alerts', {
        id: alertId,
        alert_type: alertType,
        severity: severity,
        title: title,
        message: title,
        details: JSON.stringify(details),
        is_resolved: false,
        created_at: new Date()
      });

      // Notify admins for high/critical alerts
      if (['high', 'critical'].includes(severity)) {
        const admins = await Database.query(
          'SELECT email FROM users WHERE role = "admin"'
        );

        for (const admin of admins) {
          await NotificationService.queueNotification(
            null,
            'email',
            admin.email,
            `System Alert: ${title}`,
            `
              <h2>System Alert - ${severity.toUpperCase()}</h2>
              <p><strong>Type:</strong> ${alertType}</p>
              <p><strong>Message:</strong> ${title}</p>
              <p><strong>Details:</strong></p>
              <pre>${JSON.stringify(details, null, 2)}</pre>
              <p><strong>Time:</strong> ${new Date().toISOString()}</p>
              <p>Please check the admin dashboard for more information.</p>
            `,
            {
              type: 'system_alert',
              alert_id: alertId,
              severity: severity
            }
          );
        }
      }

      console.log(`🚨 System alert created: ${severity.toUpperCase()} - ${title}`);

    } catch (error) {
      console.error('Failed to create system alert:', error);
    }
  }

  // Log health report
  async logHealthReport(healthReport) {
    try {
      await Database.logAudit(
        null,
        'SYSTEM_HEALTH_CHECK',
        'system',
        null,
        null,
        {
          status: healthReport.status,
          checks: Object.keys(healthReport.checks).map(key => ({
            category: key,
            status: healthReport.checks[key].status
          })),
          timestamp: healthReport.timestamp
        },
        'system'
      );
    } catch (error) {
      console.error('Failed to log health report:', error);
    }
  }

  // Get system status
  getStatus() {
    return {
      monitoring_active: !!this.monitoringInterval,
      alert_thresholds: this.alertThresholds,
      last_check: this.lastCheckTime || null
    };
  }

  // Update alert thresholds
  updateThresholds(newThresholds) {
    this.alertThresholds = { ...this.alertThresholds, ...newThresholds };
    console.log('Alert thresholds updated:', this.alertThresholds);
  }
}

// Create singleton instance
const systemMonitor = new SystemMonitorService();

module.exports = systemMonitor;