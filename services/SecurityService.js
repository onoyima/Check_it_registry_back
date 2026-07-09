const Database = require('../config');
const OTPService = require('./OTPService');
const NINVerificationService = require('./NINVerificationService');

const CRITICAL_ACTIONS = {
  REPORT_DEVICE: { label: 'Report Device', requiresMfa: true, otpCount: 1, requiresIdentity: true },
  RECOVER_DEVICE: { label: 'Recover Device', requiresMfa: true, otpCount: 2, requiresIdentity: true, requiresPayment: true },
  TRANSFER_OWNERSHIP: { label: 'Transfer Ownership', requiresMfa: true, otpCount: 2, requiresIdentity: true },
  SELL_MARKETPLACE: { label: 'Sell on Marketplace', requiresMfa: true, otpCount: 1, requiresIdentity: true },
  ACCEPT_TRANSFER: { label: 'Accept Ownership Transfer', requiresMfa: true, otpCount: 1, requiresIdentity: true },
  REMOVE_OWNERSHIP: { label: 'Remove Ownership', requiresMfa: true, otpCount: 2, requiresIdentity: true },
  UPDATE_SENSITIVE: { label: 'Update Sensitive Info', requiresMfa: true, otpCount: 1 },
  BUSINESS_VERIFY: { label: 'Business Verification', requiresMfa: true, otpCount: 1, requiresIdentity: true },
  NIN_VERIFY: { label: 'NIN Verification', requiresMfa: true, otpCount: 1 },
  CHANGE_PHONE: { label: 'Change Phone/Email', requiresMfa: true, otpCount: 2 },
  ADMIN_APPROVE: { label: 'Admin Approval', requiresMfa: true, otpCount: 1 },
};

const CRITICAL_ACTION_TYPES = Object.keys(CRITICAL_ACTIONS);

class SecurityService {
  static getCriticalAction(actionType) {
    return CRITICAL_ACTIONS[actionType] || null;
  }

  static isCriticalAction(actionType) {
    return !!CRITICAL_ACTIONS[actionType];
  }

  static async enforcePreConditions(userId, actionType) {
    const action = this.getCriticalAction(actionType);
    if (!action) return { allowed: true };

    const user = await Database.selectOne('users', 'id, kyc_status, is_verified, caution_flag, role', 'id = ?', [userId]);
    if (!user) return { allowed: false, error: 'User not found' };

    if (action.requiresIdentity && !user.is_verified) {
      return { allowed: false, error: 'Identity verification required. Please complete NIN verification first.', requiresAction: 'nin_verification' };
    }

    if (user.caution_flag) {
      return { allowed: false, error: 'Account is flagged. Contact support to proceed.' };
    }

    const sessionOk = await this.checkSessionFreshness(userId);
    if (!sessionOk) {
      return { allowed: false, error: 'Session expired or requires re-authentication.', requiresAction: 'reauthenticate' };
    }

    const riskCheck = await this.assessRisk(userId, actionType);
    if (riskCheck.flagged) {
      return { allowed: false, error: riskCheck.reason, requiresAction: 'admin_review' };
    }

    return { allowed: true, action };
  }

  static async enforceMFA(userId, actionType, options = {}) {
    const action = CRITICAL_ACTIONS[actionType];
    if (!action || !action.requiresMfa) return { mfaPassed: true };

    const otpResults = [];
    const otpCount = options.otpCount || action.otpCount;

    if (otpCount >= 1) {
      const emailOtp = await OTPService.createOTP(userId, `${actionType.toLowerCase()}_email`, null, 10);
      otpResults.push({ type: 'email', sent: true, otpId: emailOtp.otpId });
    }

    if (otpCount >= 2) {
      const user = await Database.selectOne('users', 'phone', 'id = ?', [userId]);
      if (user?.phone) {
        const smsOtp = await OTPService.createOTP(userId, `${actionType.toLowerCase()}_sms`, null, 10);
        otpResults.push({ type: 'sms', sent: true, otpId: smsOtp.otpId });
      }
    }

    return { mfaPassed: false, otpResults, requiresOtp: true };
  }

  static async verifyMFA(userId, actionType, otpCodes = {}) {
    const action = CRITICAL_ACTIONS[actionType];
    if (!action || !action.requiresMfa) return { verified: true };

    const verifications = [];

    if (otpCodes.emailOtp) {
      const emailResult = await OTPService.verifyOTP(userId, otpCodes.emailOtp, `${actionType.toLowerCase()}_email`);
      verifications.push({ type: 'email', success: emailResult.success });
      if (!emailResult.success) {
        await this.logFailedAttempt(userId, actionType, `Email OTP failed: ${emailResult.message}`);
        return { verified: false, error: emailResult.message };
      }
    }

    if (otpCodes.smsOtp) {
      const smsResult = await OTPService.verifyOTP(userId, otpCodes.smsOtp, `${actionType.toLowerCase()}_sms`);
      verifications.push({ type: 'sms', success: smsResult.success });
      if (!smsResult.success) {
        await this.logFailedAttempt(userId, actionType, `SMS OTP failed: ${smsResult.message}`);
        return { verified: false, error: smsResult.message };
      }
    }

    return { verified: true, verifications };
  }

  static async verifyIdentity(userId) {
    const user = await Database.selectOne('users', 'id, kyc_status, is_verified, verified_full_name', 'id = ?', [userId]);
    if (!user || !user.is_verified) {
      return { verified: false, error: 'Identity not verified. Please complete NIN verification.' };
    }

    await Database.logAudit(userId, 'IDENTITY_CONFIRMED', 'users', userId, null,
      { method: 'nin_check', verified_name: user.verified_full_name });

    return { verified: true, name: user.verified_full_name };
  }

  static async checkSessionFreshness(userId) {
    const session = await Database.selectOne('user_sessions', 'created_at, expires_at',
      'user_id = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1', [userId]);
    if (!session) return false;

    const sessionMinutes = (Date.now() - new Date(session.created_at).getTime()) / 60000;
    return sessionMinutes < 60;
  }

  static async logCriticalAction(userId, actionType, details) {
    const auditId = Database.generateUUID();
    await Database.insert('audit_logs', {
      id: auditId,
      user_id: userId,
      user_name: null,
      action: `CRITICAL_${actionType}`,
      table_name: 'critical_actions',
      record_id: details.deviceId || details.reference || null,
      old_values: details.oldValues ? JSON.stringify(details.oldValues) : null,
      new_values: details.newValues ? JSON.stringify(details.newValues) : null,
      ip_address: details.ipAddress || null,
      mac_address: details.macAddress || null,
      user_agent: details.userAgent || null,
      session_id: details.sessionId || null,
      request_method: 'SYSTEM',
      request_url: `/api/security/${actionType.toLowerCase()}`,
      response_status: details.success ? 200 : 400,
      execution_time_ms: details.executionTime || 0,
      created_at: new Date()
    });

    await Database.insert('security_events', {
      id: Database.generateUUID(),
      event_type: `CRITICAL_${actionType}`,
      severity: details.success ? 'info' : 'critical',
      user_id: userId,
      details: JSON.stringify(details),
      ip_address: details.ipAddress || null,
      created_at: new Date()
    });
  }

  static async logFailedAttempt(userId, actionType, reason) {
    await Database.insert('security_events', {
      id: Database.generateUUID(),
      event_type: `FAILED_${actionType}`,
      severity: 'warning',
      user_id: userId,
      details: JSON.stringify({ reason, actionType }),
      created_at: new Date()
    });
  }

  static async assessRisk(userId, actionType) {
    const recentFailures = await Database.query(
      `SELECT COUNT(*) as count FROM security_events
       WHERE user_id = ? AND event_type LIKE ? AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
      [userId, `FAILED_%`]
    );

    if (recentFailures[0]?.count >= 5) {
      return { flagged: true, reason: 'Too many recent failed attempts. Account temporarily locked.' };
    }

    const highRiskActions = await Database.query(
      `SELECT COUNT(*) as count FROM security_events
       WHERE user_id = ? AND severity = 'critical' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [userId]
    );

    if (highRiskActions[0]?.count >= 3) {
      return { flagged: true, reason: 'Unusual activity detected. Action blocked for security.' };
    }

    const user = await Database.selectOne('users', 'caution_flag', 'id = ?', [userId]);
    if (user?.caution_flag) {
      return { flagged: true, reason: 'Account under review. Contact support.' };
    }

    return { flagged: false };
  }

  static async requireReauthentication(userId) {
    const otpResult = await OTPService.createOTP(userId, 'reauthentication', null, 5);
    return {
      requiresReauth: true,
      message: 'Please verify your identity to continue.',
      otpId: otpResult.otpId
    };
  }

  static async completeReauthentication(userId, otpCode) {
    const result = await OTPService.verifyOTP(userId, otpCode, 'reauthentication');
    if (!result.success) return { success: false, error: result.message };

    await Database.update('user_sessions',
      { created_at: new Date() },
      'user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);

    return { success: true };
  }
}

module.exports = SecurityService;
