// Background Job Processor - Simple job queue without Redis
const Database = require('../config');
const NotificationService = require('./NotificationService');
const FileUploadService = require('./FileUploadService');

class BackgroundJobs {
  constructor() {
    this.isRunning = false;
    this.jobInterval = null;
    this.intervalMs = 30000; // Run every 30 seconds
  }

  // Start the background job processor
  start() {
    if (this.isRunning) {
      console.log('Background jobs already running');
      return;
    }

    console.log('🚀 Starting background job processor...');
    this.isRunning = true;

    // Run jobs immediately, then on interval
    this.processJobs();
    this.jobInterval = setInterval(() => {
      this.processJobs();
    }, this.intervalMs);

    console.log(`✅ Background jobs started (interval: ${this.intervalMs}ms)`);
  }

  // Stop the background job processor
  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping background job processor...');
    this.isRunning = false;

    if (this.jobInterval) {
      clearInterval(this.jobInterval);
      this.jobInterval = null;
    }

    console.log('✅ Background jobs stopped');
  }

  // Process all background jobs
  async processJobs() {
    if (!this.isRunning) {
      return;
    }

    try {
      const startTime = Date.now();
      
      // Run all job types
      const results = await Promise.allSettled([
        this.processNotifications(),
        this.cleanupExpiredTransfers(),
        this.processLEAAssignments(),
        this.cleanupOldFiles(),
        this.updateDeviceStatuses(),
        this.generateDailyReports()
      ]);

      // Log results
      const duration = Date.now() - startTime;
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed > 0) {
        console.log(`⚠️  Background jobs completed: ${successful} successful, ${failed} failed (${duration}ms)`);
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.error(`Job ${index} failed:`, result.reason);
          }
        });
      } else {
        console.log(`✅ Background jobs completed: ${successful} jobs (${duration}ms)`);
      }

    } catch (error) {
      console.error('❌ Background job processor error:', error);
    }
  }

  // Process pending notifications
  async processNotifications() {
    try {
      const result = await NotificationService.processPendingNotifications(20);
      
      if (result.total > 0) {
        console.log(`📧 Processed ${result.processed}/${result.total} notifications`);
      }

      // Retry failed notifications
      const retryResult = await NotificationService.retryFailedNotifications(3);
      if (retryResult.total > 0) {
        console.log(`🔄 Retried ${retryResult.retried}/${retryResult.total} failed notifications`);
      }

      return { notifications: result, retries: retryResult };
    } catch (error) {
      console.error('Notification processing error:', error);
      throw error;
    }
  }

  // Cleanup expired device transfers
  async cleanupExpiredTransfers() {
    try {
      const expiredTransfers = await Database.query(`
        SELECT dt.*, d.id as device_id
        FROM device_transfers dt
        JOIN devices d ON dt.device_id = d.id
        WHERE dt.status = 'pending' AND dt.expires_at < NOW()
        LIMIT 50
      `);

      let cleaned = 0;
      for (const transfer of expiredTransfers) {
        // Update transfer status
        await Database.update('device_transfers', {
          status: 'expired',
          updated_at: new Date()
        }, 'id = ?', [transfer.id]);

        // Reset device status
        await Database.update('devices', {
          status: 'verified',
          updated_at: new Date()
        }, 'id = ?', [transfer.device_id]);

        // Notify users about expiration
        const fromUser = await Database.selectOne('users', 'name, email', 'id = ?', [transfer.from_user_id]);
        const toUser = await Database.selectOne('users', 'name, email', 'id = ?', [transfer.to_user_id]);
        const device = await Database.selectOne('devices', 'brand, model', 'id = ?', [transfer.device_id]);

        if (fromUser && toUser && device) {
          // Notify sender
          await NotificationService.queueNotification(
            transfer.from_user_id,
            'email',
            fromUser.email,
            'Device Transfer Expired',
            `
              <h2>Device Transfer Expired</h2>
              <p>Your device transfer request to <strong>${toUser.name}</strong> has expired.</p>
              <p><strong>Device:</strong> ${device.brand} ${device.model}</p>
              <p>You can initiate a new transfer if needed.</p>
            `,
            { type: 'transfer_expired' }
          );

          // Notify recipient
          await NotificationService.queueNotification(
            transfer.to_user_id,
            'email',
            toUser.email,
            'Device Transfer Expired',
            `
              <h2>Device Transfer Expired</h2>
              <p>The device transfer request from <strong>${fromUser.name}</strong> has expired.</p>
              <p><strong>Device:</strong> ${device.brand} ${device.model}</p>
              <p><strong>Transfer Code:</strong> ${transfer.transfer_code}</p>
            `,
            { type: 'transfer_expired' }
          );
        }

        cleaned++;
      }

      if (cleaned > 0) {
        console.log(`🔄 Cleaned up ${cleaned} expired transfers`);
      }

      return { cleaned };
    } catch (error) {
      console.error('Transfer cleanup error:', error);
      throw error;
    }
  }

  // Auto-assign LEA to new reports
  async processLEAAssignments() {
    try {
      const unassignedReports = await Database.query(`
        SELECT r.*, u.region
        FROM reports r
        JOIN devices d ON r.device_id = d.id
        JOIN users u ON d.user_id = u.id
        WHERE r.assigned_lea_id IS NULL
        AND r.report_type IN ('stolen', 'lost', 'found')
        AND r.created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
        LIMIT 20
      `);

      let assigned = 0;
      for (const report of unassignedReports) {
        // Find LEA for the region
        const lea = await Database.selectOne(
          'law_enforcement_agencies',
          '*',
          'region = ? AND active = TRUE',
          [report.region]
        );

        if (lea) {
          // Assign LEA to report
          await Database.update('reports', {
            assigned_lea_id: lea.id,
            updated_at: new Date()
          }, 'id = ?', [report.id]);

          // Get device and case info for notification
          const device = await Database.selectOne('devices', 'brand, model, imei', 'id = ?', [report.device_id]);
          
          // Notify LEA
          await NotificationService.notifyLEANewCase(lea.id, {
            case_id: report.case_id,
            report_type: report.report_type,
            device_brand: device.brand,
            device_model: device.model,
            device_imei: device.imei,
            location: report.location,
            occurred_at: report.occurred_at
          });

          assigned++;
        }
      }

      if (assigned > 0) {
        console.log(`👮 Assigned ${assigned} reports to LEA`);
      }

      return { assigned };
    } catch (error) {
      console.error('LEA assignment error:', error);
      throw error;
    }
  }

  // Cleanup old files
  async cleanupOldFiles() {
    try {
      // Only run file cleanup once per day
      const lastCleanup = await Database.selectOne(
        'audit_logs',
        'created_at',
        'action = "FILE_CLEANUP"',
        [],
        'created_at DESC'
      );

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      if (lastCleanup && new Date(lastCleanup.created_at) > oneDayAgo) {
        return { skipped: true, reason: 'Already cleaned up today' };
      }

      const result = await FileUploadService.cleanupOldFiles(30); // 30 days old

      // Log cleanup activity
      await Database.logAudit(
        null,
        'FILE_CLEANUP',
        'files',
        null,
        null,
        { deleted_count: result.deleted },
        'system'
      );

      if (result.deleted > 0) {
        console.log(`🗑️  Cleaned up ${result.deleted} old files`);
      }

      return result;
    } catch (error) {
      console.error('File cleanup error:', error);
      throw error;
    }
  }

  // Update device statuses based on reports
  async updateDeviceStatuses() {
    try {
      // Find devices that should be marked as found
      const foundDevices = await Database.query(`
        SELECT DISTINCT d.id, d.status
        FROM devices d
        JOIN reports r ON d.id = r.device_id
        WHERE d.status IN ('stolen', 'lost')
        AND r.report_type = 'found'
        AND r.status = 'resolved'
        AND d.updated_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
      `);

      let updated = 0;
      for (const device of foundDevices) {
        await Database.update('devices', {
          status: 'verified', // Device is recovered and verified
          updated_at: new Date()
        }, 'id = ?', [device.id]);
        updated++;
      }

      if (updated > 0) {
        console.log(`📱 Updated ${updated} device statuses`);
      }

      return { updated };
    } catch (error) {
      console.error('Device status update error:', error);
      throw error;
    }
  }

  // Generate daily reports (summary statistics)
  async generateDailyReports() {
    try {
      // Only run once per day
      const today = new Date().toISOString().split('T')[0];
      const existingReport = await Database.selectOne(
        'audit_logs',
        'id',
        'action = "DAILY_REPORT" AND DATE(created_at) = ?',
        [today]
      );

      if (existingReport) {
        return { skipped: true, reason: 'Daily report already generated' };
      }

      // Generate statistics for yesterday
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const stats = await Database.query(`
        SELECT 
          (SELECT COUNT(*) FROM devices WHERE DATE(created_at) = ?) as devices_registered,
          (SELECT COUNT(*) FROM reports WHERE DATE(created_at) = ?) as reports_filed,
          (SELECT COUNT(*) FROM reports WHERE DATE(created_at) = ? AND report_type = 'stolen') as stolen_reports,
          (SELECT COUNT(*) FROM reports WHERE DATE(created_at) = ? AND report_type = 'lost') as lost_reports,
          (SELECT COUNT(*) FROM reports WHERE DATE(created_at) = ? AND report_type = 'found') as found_reports,
          (SELECT COUNT(*) FROM reports WHERE DATE(updated_at) = ? AND status = 'resolved') as resolved_cases,
          (SELECT COUNT(*) FROM users WHERE DATE(created_at) = ?) as new_users,
          (SELECT COUNT(*) FROM imei_checks WHERE DATE(created_at) = ?) as public_checks
      `, [yesterday, yesterday, yesterday, yesterday, yesterday, yesterday, yesterday, yesterday]);

      const dailyStats = stats[0];

      // Log the daily report
      await Database.logAudit(
        null,
        'DAILY_REPORT',
        'system',
        null,
        null,
        dailyStats,
        'system'
      );

      console.log(`📊 Generated daily report for ${yesterday}:`, dailyStats);

      return { generated: true, stats: dailyStats };
    } catch (error) {
      console.error('Daily report error:', error);
      throw error;
    }
  }

  // Get job processor status
  getStatus() {
    return {
      running: this.isRunning,
      interval_ms: this.intervalMs,
      uptime: this.isRunning ? Date.now() - this.startTime : 0
    };
  }

  // Process jobs manually (for testing)
  async runJobsNow() {
    console.log('🔧 Running background jobs manually...');
    await this.processJobs();
  }
}

// Create singleton instance
const backgroundJobs = new BackgroundJobs();

// Auto-start in production
if (process.env.NODE_ENV === 'production') {
  backgroundJobs.start();
}

module.exports = backgroundJobs;