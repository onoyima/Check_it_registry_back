// System Health Monitoring Routes
const express = require("express");
const Database = require("../config");
const { authenticateToken, requireRole } = require("../middleware/auth");
const NotificationService = require("../services/NotificationService");
const BackgroundJobs = require("../services/BackgroundJobs");
const fs = require("fs").promises;
const path = require("path");

const router = express.Router();

// All routes require admin access
router.use(authenticateToken);
router.use(requireRole(["admin"]));

// Get comprehensive system health status
router.get("/status", async (req, res) => {
  try {
    const healthChecks = await Promise.allSettled([
      checkDatabaseHealth(),
      checkEmailHealth(),
      checkFileSystemHealth(),
      checkBackgroundJobsHealth(),
      checkSystemResources(),
    ]);

    const health = {
      overall_status: "healthy",
      timestamp: new Date().toISOString(),
      checks: {
        database:
          healthChecks[0].status === "fulfilled"
            ? healthChecks[0].value
            : { status: "error", error: healthChecks[0].reason },
        email:
          healthChecks[1].status === "fulfilled"
            ? healthChecks[1].value
            : { status: "error", error: healthChecks[1].reason },
        filesystem:
          healthChecks[2].status === "fulfilled"
            ? healthChecks[2].value
            : { status: "error", error: healthChecks[2].reason },
        background_jobs:
          healthChecks[3].status === "fulfilled"
            ? healthChecks[3].value
            : { status: "error", error: healthChecks[3].reason },
        system_resources:
          healthChecks[4].status === "fulfilled"
            ? healthChecks[4].value
            : { status: "error", error: healthChecks[4].reason },
      },
    };

    // Determine overall status
    const hasErrors = Object.values(health.checks).some(
      (check) => check.status === "error"
    );
    const hasWarnings = Object.values(health.checks).some(
      (check) => check.status === "warning"
    );

    if (hasErrors) {
      health.overall_status = "error";
    } else if (hasWarnings) {
      health.overall_status = "warning";
    }

    res.json(health);
  } catch (error) {
    console.error("System health check error:", error);
    res.status(500).json({
      overall_status: "error",
      error: "Failed to perform health checks",
      timestamp: new Date().toISOString(),
    });
  }
});

// Database health check
async function checkDatabaseHealth() {
  try {
    const startTime = Date.now();

    // Test basic connectivity
    await Database.query("SELECT 1 as test");

    // Check table counts
    const tableCounts = await Database.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM devices) as devices,
        (SELECT COUNT(*) FROM reports) as reports,
        (SELECT COUNT(*) FROM notifications) as notifications,
        (SELECT COUNT(*) FROM audit_logs) as audit_logs
    `);

    // Check for recent activity
    const recentActivity = await Database.query(`
      SELECT COUNT(*) as recent_count
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `);

    const responseTime = Date.now() - startTime;

    return {
      status: responseTime > 1000 ? "warning" : "healthy",
      response_time_ms: responseTime,
      table_counts: tableCounts[0],
      recent_activity: recentActivity[0].recent_count,
      details:
        responseTime > 1000
          ? "Slow database response time"
          : "Database responding normally",
    };
  } catch (error) {
    return {
      status: "error",
      error: error.message,
      details: "Database connection failed",
    };
  }
}

// Email system health check
async function checkEmailHealth() {
  try {
    const emailConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS);

    if (!emailConfigured) {
      return {
        status: "warning",
        configured: false,
        details: "Email system not configured",
      };
    }

    // Check recent notification statistics
    const notificationStats = await Database.query(`
      SELECT 
        COUNT(*) as total_notifications,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
      FROM notifications
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);

    const stats = notificationStats[0];
    const failureRate =
      stats.total_notifications > 0
        ? (stats.failed_count / stats.total_notifications) * 100
        : 0;

    return {
      status: failureRate > 20 ? "warning" : "healthy",
      configured: true,
      smtp_host: process.env.SMTP_HOST,
      smtp_port: process.env.SMTP_PORT,
      from_address: process.env.MAIL_FROM_ADDRESS,
      last_24h_stats: stats,
      failure_rate_percent: Math.round(failureRate * 100) / 100,
      details:
        failureRate > 20
          ? "High email failure rate detected"
          : "Email system functioning normally",
    };
  } catch (error) {
    return {
      status: "error",
      error: error.message,
      details: "Failed to check email system health",
    };
  }
}

// File system health check
async function checkFileSystemHealth() {
  try {
    const uploadsDir = path.join(__dirname, "../uploads");

    // Check if uploads directory exists
    try {
      await fs.access(uploadsDir);
    } catch (error) {
      return {
        status: "warning",
        uploads_dir_exists: false,
        details: "Uploads directory does not exist",
      };
    }

    // Get directory statistics
    const subdirs = [
      "proofs",
      "devices",
      "evidence",
      "transfers",
      "ids",
      "misc",
    ];
    const dirStats = {};
    let totalFiles = 0;
    let totalSize = 0;

    for (const subdir of subdirs) {
      const subdirPath = path.join(uploadsDir, subdir);
      try {
        const files = await fs.readdir(subdirPath);
        let subdirSize = 0;

        for (const file of files) {
          const filePath = path.join(subdirPath, file);
          const stats = await fs.stat(filePath);
          subdirSize += stats.size;
        }

        dirStats[subdir] = {
          file_count: files.length,
          size_bytes: subdirSize,
        };

        totalFiles += files.length;
        totalSize += subdirSize;
      } catch (error) {
        dirStats[subdir] = {
          file_count: 0,
          size_bytes: 0,
          error: "Directory not accessible",
        };
      }
    }

    // Check disk space (simplified)
    const sizeInMB = Math.round((totalSize / 1024 / 1024) * 100) / 100;

    return {
      status: sizeInMB > 1000 ? "warning" : "healthy", // Warning if over 1GB
      uploads_dir_exists: true,
      total_files: totalFiles,
      total_size_mb: sizeInMB,
      directory_stats: dirStats,
      details:
        sizeInMB > 1000 ? "High disk usage detected" : "File system healthy",
    };
  } catch (error) {
    return {
      status: "error",
      error: error.message,
      details: "Failed to check file system health",
    };
  }
}

// Background jobs health check
async function checkBackgroundJobsHealth() {
  try {
    const jobStatus = BackgroundJobs.getStatus();

    // Check recent job execution logs
    const recentJobs = await Database.query(`
      SELECT 
        action,
        COUNT(*) as execution_count,
        MAX(created_at) as last_execution
      FROM audit_logs
      WHERE action IN ('DAILY_REPORT', 'FILE_CLEANUP', 'TRANSFER_CLEANUP')
      AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY action
    `);

    const jobExecutions = {};
    recentJobs.forEach((job) => {
      jobExecutions[job.action] = {
        count: job.execution_count,
        last_execution: job.last_execution,
      };
    });

    return {
      status: jobStatus.running ? "healthy" : "error",
      running: jobStatus.running,
      interval_ms: jobStatus.interval_ms,
      recent_executions: jobExecutions,
      details: jobStatus.running
        ? "Background jobs running normally"
        : "Background jobs not running",
    };
  } catch (error) {
    return {
      status: "error",
      error: error.message,
      details: "Failed to check background jobs health",
    };
  }
}

// System resources health check
async function checkSystemResources() {
  try {
    const startTime = process.hrtime();

    // Memory usage
    const memUsage = process.memoryUsage();
    const memUsageMB = {
      rss: Math.round((memUsage.rss / 1024 / 1024) * 100) / 100,
      heapTotal: Math.round((memUsage.heapTotal / 1024 / 1024) * 100) / 100,
      heapUsed: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
      external: Math.round((memUsage.external / 1024 / 1024) * 100) / 100,
    };

    // CPU usage (simplified)
    const cpuUsage = process.cpuUsage();

    // Uptime
    const uptimeSeconds = process.uptime();
    const uptimeHours = Math.round((uptimeSeconds / 3600) * 100) / 100;

    // Response time test
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const responseTimeMs =
      Math.round((seconds * 1000 + nanoseconds / 1000000) * 100) / 100;

    const highMemoryUsage = memUsageMB.heapUsed > 500; // Warning if over 500MB

    return {
      status: highMemoryUsage ? "warning" : "healthy",
      memory_usage_mb: memUsageMB,
      cpu_usage: cpuUsage,
      uptime_hours: uptimeHours,
      response_time_ms: responseTimeMs,
      node_version: process.version,
      platform: process.platform,
      details: highMemoryUsage
        ? "High memory usage detected"
        : "System resources normal",
    };
  } catch (error) {
    return {
      status: "error",
      error: error.message,
      details: "Failed to check system resources",
    };
  }
}

// Get detailed audit logs
router.get("/audit-logs", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      action,
      user_id,
      table_name,
      start_date,
      end_date,
    } = req.query;

    let whereClause = "1=1";
    let params = [];

    if (action) {
      whereClause += " AND action = ?";
      params.push(action);
    }

    if (user_id) {
      whereClause += " AND user_id = ?";
      params.push(user_id);
    }

    if (table_name) {
      whereClause += " AND table_name = ?";
      params.push(table_name);
    }

    if (start_date && end_date) {
      whereClause += " AND DATE(created_at) BETWEEN ? AND ?";
      params.push(start_date, end_date);
    }

    const offset = (page - 1) * limit;

    const [logs, totalCount] = await Promise.all([
      Database.query(
        `
        SELECT 
          al.*,
          u.name as user_name,
          u.email as user_email
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT ? OFFSET ?
      `,
        [...params, parseInt(limit), offset]
      ),

      Database.query(
        `
        SELECT COUNT(*) as total
        FROM audit_logs al
        WHERE ${whereClause}
      `,
        params
      ),
    ]);

    res.json({
      success: true,
      audit_logs: logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        pages: Math.ceil(totalCount[0].total / limit),
      },
    });
  } catch (error) {
    console.error("Audit logs error:", error);
    res.status(500).json({ error: "Failed to retrieve audit logs" });
  }
});

// System maintenance operations
router.post("/maintenance/:operation", async (req, res) => {
  try {
    const { operation } = req.params;
    let result = {};

    switch (operation) {
      case "cleanup-files":
        const FileUploadService = require("../services/FileUploadService");
        const cleanupResult = await FileUploadService.cleanupOldFiles(30);
        result = {
          operation: "File Cleanup",
          files_deleted: cleanupResult.deleted,
          message: `Cleaned up ${cleanupResult.deleted} old files`,
        };
        break;

      case "cleanup-notifications":
        const deletedNotifications = await Database.query(`
          DELETE FROM notifications 
          WHERE status IN ('sent', 'failed') 
          AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
        `);
        result = {
          operation: "Notification Cleanup",
          notifications_deleted: deletedNotifications.affectedRows,
          message: `Cleaned up ${deletedNotifications.affectedRows} old notifications`,
        };
        break;

      case "cleanup-audit-logs":
        const deletedLogs = await Database.query(`
          DELETE FROM audit_logs 
          WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
        `);
        result = {
          operation: "Audit Log Cleanup",
          logs_deleted: deletedLogs.affectedRows,
          message: `Cleaned up ${deletedLogs.affectedRows} old audit logs`,
        };
        break;

      case "run-background-jobs":
        await BackgroundJobs.runJobsNow();
        result = {
          operation: "Background Jobs",
          message: "Background jobs executed successfully",
        };
        break;

      default:
        return res.status(400).json({ error: "Invalid maintenance operation" });
    }

    // Log maintenance operation
    await Database.logAudit(
      req.user.id,
      `MAINTENANCE_${operation.toUpperCase()}`,
      "system",
      null,
      null,
      result,
      req.ip
    );

    res.json({
      success: true,
      ...result,
      executed_by: req.user.name,
      executed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Maintenance operation error:", error);
    res.status(500).json({ error: "Failed to execute maintenance operation" });
  }
});

module.exports = router;
