const Database = require('../config');
const notifier = require('./EnhancedNotificationService');

class FraudDetectionService {
  static async checkAndFlag(userId, action, context = {}) {
    const checks = await Promise.all([
      this.checkFailedOTPAttempts(userId),
      this.checkFailedVerifications(userId),
      this.checkRepeatedChecksOnReported(userId, context.deviceId),
      this.checkUnusualLocation(userId, context.ipAddress, context.location),
      this.checkRapidOwnershipChanges(userId),
      this.checkMultipleAccountsSameNIN(userId),
      this.checkSuspiciousTiming(userId, action),
    ]);

    const flags = checks.filter(c => c.flagged);
    const riskScore = checks.reduce((sum, c) => sum + (c.score || 0), 0);

    if (flags.length > 0) {
      await this.recordFlags(userId, flags, riskScore, action, context);
    }

    if (riskScore >= 70) {
      await this.escalateToAdmin(userId, flags, riskScore, action, context);
    }

    return { flags, riskScore, blocked: riskScore >= 90 };
  }

  static async checkFailedOTPAttempts(userId) {
    const recent = await Database.query(
      `SELECT COUNT(*) as count FROM security_events
       WHERE user_id = ? AND event_type LIKE 'FAILED_%' AND event_type LIKE '%OTP%'
       AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)`,
      [userId]
    );
    const count = recent[0]?.count || 0;
    return {
      flagged: count >= 5,
      score: Math.min(count * 10, 50),
      detail: `${count} failed OTP attempts in 30 minutes`,
      type: 'excessive_failed_otp'
    };
  }

  static async checkFailedVerifications(userId) {
    const recent = await Database.query(
      `SELECT COUNT(*) as count FROM security_events
       WHERE user_id = ? AND (event_type LIKE '%NIN_FAILED%' OR event_type LIKE '%CAC_FAILED%')
       AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
      [userId]
    );
    const count = recent[0]?.count || 0;
    return {
      flagged: count >= 3,
      score: Math.min(count * 15, 60),
      detail: `${count} failed identity verifications in 24 hours`,
      type: 'excessive_verification_failures'
    };
  }

  static async checkRepeatedChecksOnReported(userId, deviceId) {
    if (!deviceId) return { flagged: false, score: 0 };

    const checks = await Database.query(
      `SELECT COUNT(*) as count FROM device_check_logs
       WHERE device_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [deviceId]
    );
    const count = checks[0]?.count || 0;
    return {
      flagged: count >= 10,
      score: Math.min(count * 5, 40),
      detail: `${count} checks on device ${deviceId} in 1 hour`,
      type: 'repeated_device_checks'
    };
  }

  static async checkUnusualLocation(userId, ipAddress, location) {
    if (!ipAddress && !location) return { flagged: false, score: 0 };

    const recent = await Database.query(
      `SELECT DISTINCT ip_address FROM security_events
       WHERE user_id = ? AND ip_address IS NOT NULL
       AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
      [userId]
    );

    if (recent.length >= 3 && !recent.some(r => r.ip_address === ipAddress)) {
      return {
        flagged: true,
        score: 25,
        detail: 'Login from unusual IP address',
        type: 'unusual_location'
      };
    }

    return { flagged: false, score: 0 };
  }

  static async checkRapidOwnershipChanges(userId) {
    const changes = await Database.query(
      `SELECT COUNT(*) as count FROM device_transfers
       WHERE (from_user_id = ? OR to_user_id = ?)
       AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
      [userId, userId]
    );
    const count = changes[0]?.count || 0;
    return {
      flagged: count >= 5,
      score: Math.min(count * 10, 50),
      detail: `${count} ownership changes in 24 hours`,
      type: 'rapid_ownership_changes'
    };
  }

  static async checkMultipleAccountsSameNIN(userId) {
    const user = await Database.selectOne('users', 'kyc_status', 'id = ?', [userId]);
    if (!user || user.kyc_status !== 'verified') return { flagged: false, score: 0 };

    const verifiedUsers = await Database.query(
      `SELECT COUNT(*) as count FROM users WHERE is_verified = 1 AND kyc_status = 'verified'`
    );

    return { flagged: false, score: 0 };
  }

  static async checkSuspiciousTiming(userId, action) {
    const actions = await Database.query(
      `SELECT COUNT(*) as count FROM security_events
       WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
      [userId]
    );
    const count = actions[0]?.count || 0;
    return {
      flagged: count >= 20,
      score: count >= 20 ? 40 : 0,
      detail: `${count} actions in 5 minutes`,
      type: 'suspicious_timing'
    };
  }

  static async recordFlags(userId, flags, riskScore, action, context) {
    await Database.insert('security_events', {
      id: Database.generateUUID(),
      event_type: 'FRAUD_FLAG',
      severity: riskScore >= 70 ? 'critical' : 'warning',
      user_id: userId,
      details: JSON.stringify({
        flags: flags.map(f => f.type),
        riskScore,
        action,
        context: {
          ip: context.ipAddress,
          deviceId: context.deviceId,
          mac: context.macAddress
        }
      }),
      ip_address: context.ipAddress || null,
      created_at: new Date()
    });

    if (riskScore >= 50) {
      await Database.update('users',
        { caution_flag: true, updated_at: new Date() },
        'id = ?', [userId]);
    }
  }

  static async escalateToAdmin(userId, flags, riskScore, action, context) {
    const user = await Database.selectOne('users', 'name, email', 'id = ?', [userId]);

    const subject = `FRAUD ALERT: High-risk activity detected (User: ${user?.name || userId})`;
    const html = `
      <h2>Fraud Alert - High Risk Activity</h2>
      <p><strong>User:</strong> ${user?.name || 'Unknown'} (${user?.email || userId})</p>
      <p><strong>Action:</strong> ${action}</p>
      <p><strong>Risk Score:</strong> ${riskScore}/100</p>
      <p><strong>Flags:</strong></p>
      <ul>${flags.map(f => `<li><strong>${f.type}:</strong> ${f.detail} (Score: ${f.score})</li>`).join('')}</ul>
      <p><strong>IP:</strong> ${context.ipAddress || 'Unknown'}</p>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      <p>Immediate review required. Consider contacting LEA if fraud is confirmed.</p>
    `;

    if (process.env.ADMIN_EMAIL) {
      await notifier.sendEmail(process.env.ADMIN_EMAIL, subject, html);
    }

    await Database.insert('notifications', {
      id: Database.generateUUID(),
      user_id: null,
      channel: 'email',
      recipient: process.env.ADMIN_EMAIL || 'admin@proveownership.com',
      subject,
      message: `Fraud alert: Risk score ${riskScore}`,
      payload: JSON.stringify({ userId, flags, riskScore, action }),
      status: 'pending',
      created_at: new Date()
    });
  }
}

module.exports = FraudDetectionService;
