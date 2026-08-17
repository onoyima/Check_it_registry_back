const Database = require('../config');
const CACVerificationService = require('./CACVerificationService');
const NotificationService = require('./NotificationService');

class BusinessVerificationService {
  static async initiateVerification(userId, rcNumber, companyName, companyType) {
    const profile = await Database.selectOne('business_profiles', '*', 'user_id = ?', [userId]);
    if (!profile) throw new Error('Business profile not found. Complete registration first.');
    if (profile.verification_status === 'verified') throw new Error('Business is already verified.');

    const fee = await this.getVerificationFee();

    return {
      profileId: profile.id,
      rcNumber: rcNumber || profile.business_registration_number,
      companyName: companyName || profile.business_name,
      fee,
      businessName: profile.business_name,
    };
  }

  static async getVerificationFee() {
    const row = await Database.selectOne('system_settings', 'setting_value',
      "setting_key = 'business_verification_fee'");
    return row ? parseFloat(row.setting_value) : 2500;
  }

  static async verifyAndRecord(userId, rcNumber, companyName, companyType, paymentReference, feeTransactionId) {
    const profile = await Database.selectOne('business_profiles', '*', 'user_id = ?', [userId]);
    if (!profile) throw new Error('Business profile not found.');
    if (profile.verification_status === 'verified') throw new Error('Business is already verified.');

    const fee = await this.getVerificationFee();

    const platformSnapshot = {
      business_name: profile.business_name,
      registration_number: profile.business_registration_number,
      business_type: profile.business_type,
      address: profile.business_address,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      email: profile.business_email,
      phone: profile.business_phone,
    };

    let providerResult = null;
    let status = 'failed';
    let statusReason = null;

    try {
      providerResult = await CACVerificationService.verifyRCNumber(
        rcNumber || profile.business_registration_number,
        companyName || profile.business_name,
        companyType || 'RC'
      );

      const comparison = this.compareData(platformSnapshot, providerResult);

      const attemptId = Database.generateUUID();
      await Database.insert('business_verification_attempts', {
        id: attemptId,
        business_profile_id: profile.id,
        user_id: userId,
        rc_number: rcNumber || profile.business_registration_number,
        company_name_submitted: companyName || profile.business_name,
        fee_amount: fee,
        fee_transaction_id: feeTransactionId || null,
        payment_reference: paymentReference || null,
        provider: providerResult.provider || 'prembly',
        platform_data_snapshot: JSON.stringify(platformSnapshot),
        provider_data_snapshot: JSON.stringify(providerResult),
        comparison_result: JSON.stringify(comparison),
        status: comparison.passed ? 'passed' : 'failed',
        status_reason: comparison.passed ? null : comparison.reason,
        created_at: new Date(),
      });

      if (comparison.passed) {
        await Database.update('business_profiles', {
          verification_status: 'verified',
          verified_at: new Date(),
          verified_by: null,
          updated_at: new Date(),
        }, 'id = ?', [profile.id]);

        await Database.update('users', {
          kyc_status: 'verified',
          is_verified: 1,
          role: 'business',
          verification_badge_visible: 1,
          caution_flag: 0,
          updated_at: new Date(),
        }, 'id = ?', [userId]);

        status = 'passed';
        await Database.logAudit(userId, 'BUSINESS_CAC_VERIFIED', 'business_profiles', profile.id,
          { verification_status: 'pending' },
          { verification_status: 'verified', rc_number: rcNumber, provider: providerResult.provider },
          null);
      } else {
        status = 'failed';
        statusReason = comparison.reason;
        await this.notifyAdminOfFailure(userId, profile, rcNumber, comparison, attemptId);
        await Database.logAudit(userId, 'BUSINESS_CAC_FAILED', 'business_profiles', profile.id,
          null,
          { rc_number: rcNumber, reason: comparison.reason, provider: providerResult.provider },
          null);
      }

      return {
        success: comparison.passed,
        status,
        statusReason,
        attemptId,
        platformData: platformSnapshot,
        providerData: providerResult,
        comparison,
      };
    } catch (error) {
      const attemptId = Database.generateUUID();
      await Database.insert('business_verification_attempts', {
        id: attemptId,
        business_profile_id: profile.id,
        user_id: userId,
        rc_number: rcNumber || profile.business_registration_number,
        company_name_submitted: companyName || profile.business_name,
        fee_amount: fee,
        fee_transaction_id: feeTransactionId || null,
        payment_reference: paymentReference || null,
        provider: 'prembly',
        platform_data_snapshot: JSON.stringify(platformSnapshot),
        provider_data_snapshot: null,
        comparison_result: null,
        status: 'error',
        status_reason: error.message,
        created_at: new Date(),
      });

      await this.notifyAdminOfFailure(userId, profile, rcNumber, { passed: false, reason: error.message }, attemptId);
      await Database.logAudit(userId, 'BUSINESS_CAC_ERROR', 'business_profiles', profile.id,
        null, { rc_number: rcNumber, error: error.message }, null);

      throw error;
    }
  }

  static compareData(platformData, providerData) {
    const platformName = (platformData.business_name || '').toLowerCase().trim();
    const providerName = (providerData.company_name || '').toLowerCase().trim();

    const nameSimilarity = this.calculateSimilarity(platformName, providerName);

    const platformStatus = (platformData.registration_number || '').replace(/\s/g, '').toUpperCase();
    const providerStatus = (providerData.rc_number || '').replace(/\s/g, '').toUpperCase();
    const rcMatch = platformStatus === providerStatus;

    const providerCompanyStatus = (providerData.status || '').toLowerCase();
    const isActive = ['active', 'registered', 'in business'].some(s => providerCompanyStatus.includes(s));

    const passed = nameSimilarity >= 0.6 && isActive;

    let reason = null;
    if (nameSimilarity < 0.6) {
      reason = `Company name mismatch: platform="${platformData.business_name}" vs CAC="${providerData.company_name}"`;
    } else if (!isActive) {
      reason = `Company status is "${providerData.status}" (expected active)`;
    }

    return {
      passed,
      nameSimilarity: Math.round(nameSimilarity * 100),
      rcMatch,
      companyStatus: providerData.status,
      isActive,
      reason,
      providerCompanyData: {
        name: providerData.company_name,
        status: providerData.status,
        registrationDate: providerData.registration_date,
        address: providerData.address,
        directors: providerData.directors || [],
      },
    };
  }

  static calculateSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const aClean = a.replace(/[^a-z0-9\s]/g, '').trim();
    const bClean = b.replace(/[^a-z0-9\s]/g, '').trim();

    if (aClean === bClean) return 1;
    if (aClean.includes(bClean) || bClean.includes(aClean)) return 0.9;

    const aWords = aClean.split(/\s+/).filter(w => w.length > 2);
    const bWords = bClean.split(/\s+/).filter(w => w.length > 2);

    if (aWords.length === 0 || bWords.length === 0) return 0;

    let matches = 0;
    for (const word of aWords) {
      if (bWords.some(bw => bw === word || bw.includes(word) || word.includes(bw))) {
        matches++;
      }
    }

    return matches / Math.max(aWords.length, bWords.length);
  }

  static async notifyAdminOfFailure(userId, profile, rcNumber, comparison, attemptId) {
    try {
      const admins = await Database.query(
        "SELECT id, email, name FROM users WHERE role IN ('admin', 'super_admin') LIMIT 5"
      );

      for (const admin of admins) {
        await NotificationService.queueNotification(
          admin.id,
          'email',
          admin.email,
          'Business Verification Failed - Manual Review Required',
          `
            <h2>Business Verification Failed</h2>
            <p>A business verification attempt failed and requires manual review.</p>
            <div style="background:#FEF2F2;border-left:4px solid #EF4444;padding:16px;border-radius:8px;margin:16px 0;">
              <h3 style="color:#991B1B;margin:0 0 8px;">Verification Failure Details</h3>
              <p><strong>Business:</strong> ${profile.business_name}</p>
              <p><strong>RC Number:</strong> ${rcNumber || profile.business_registration_number}</p>
              <p><strong>Submitted by:</strong> ${userId}</p>
              <p><strong>Reason:</strong> ${comparison.reason || 'Unknown error'}</p>
              <p><strong>Attempt ID:</strong> ${attemptId}</p>
            </div>
            <p>Please review this verification attempt in the admin dashboard.</p>
          `,
          { type: 'business_verification_failure', attemptId, businessId: profile.id }
        );
      }
    } catch (err) {
      console.error('[BusinessVerificationService] Failed to notify admin:', err.message);
    }
  }

  static async getVerificationHistory(userId) {
    const attempts = await Database.query(
      `SELECT id, rc_number, company_name_submitted, status, status_reason,
              provider, fee_amount, created_at
       FROM business_verification_attempts
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    );
    return attempts;
  }

  static async getVerificationStatus(userId) {
    const profile = await Database.selectOne('business_profiles',
      'id, verification_status, verified_at, business_name, business_registration_number',
      'user_id = ?', [userId]);

    const lastAttempt = await Database.selectOne('business_verification_attempts',
      'id, status, status_reason, created_at',
      'user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);

    return {
      profileId: profile?.id || null,
      verificationStatus: profile?.verification_status || 'pending',
      verifiedAt: profile?.verified_at || null,
      businessName: profile?.business_name || null,
      rcNumber: profile?.business_registration_number || null,
      lastAttempt: lastAttempt || null,
    };
  }
}

module.exports = BusinessVerificationService;
