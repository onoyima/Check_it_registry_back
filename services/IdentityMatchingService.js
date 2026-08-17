const Database = require('../config');
const NINVerificationService = require('./NINVerificationService');
const EmailTemplate = require('./EmailTemplate');

class IdentityMatchingService {
  /**
   * Check if a user has already completed Prembly KYC verification.
   * Prembly must only be called once per user.
   */
  static async isUserKycVerified(userId) {
    const user = await Database.selectOne('users', 'kyc_status, is_verified', 'id = ?', [userId]);
    return user && user.kyc_status === 'verified' && user.is_verified === true;
  }

  /**
   * Get user's masked NIN (last 4 digits) if previously submitted.
   * Used for prefilling the NIN field.
   */
  static async getUserNinMasked(userId) {
    const user = await Database.selectOne('users', 'nin_last_digits', 'id = ?', [userId]);
    if (user && user.nin_last_digits) {
      return '****-****-****-' + user.nin_last_digits;
    }
    return null;
  }

  /**
   * Get the user's report count for display (Report #1, #2, etc.)
   */
  static async getUserReportCount(userId) {
    const [{ count }] = await Database.query(
      `SELECT COUNT(*) as count FROM reports
       WHERE reporter_id = ? AND status IN ('open', 'under_review', 'resolved')`,
      [userId]
    );
    return count;
  }

  /**
   * Perform full KYC verification for a user's first report.
   * Must be called AFTER successful payment.
   *
   * Steps:
   * 1. Check if user is already KYC verified (skip if yes)
   * 2. Call Prembly NIN API
   * 3. Perform identity matching
   * 4. Save results
   * 5. If failed, create admin alert
   *
   * @param {string} userId
   * @param {string} nin - 11-digit NIN
   * @param {string} reportId - The report being created
   * @returns {{ success: boolean, message: string, verificationId?: string }}
   */
  static async performKycVerification(userId, nin, reportId) {
    const alreadyVerified = await this.isUserKycVerified(userId);
    if (alreadyVerified) {
      return { success: true, message: 'KYC already verified', alreadyVerified: true };
    }

    if (!nin || !/^\d{11}$/.test(nin)) {
      return { success: false, message: 'Invalid NIN format. Must be 11 digits.' };
    }

    try {
      const ninData = await NINVerificationService.verifyNIN(nin);
      const matchResult = await NINVerificationService.matchIdentity(userId, ninData);

      const verificationId = Database.generateUUID();
      await Database.insert('kyc_verifications', {
        id: verificationId,
        user_id: userId,
        nin: NINVerificationService.encrypt(nin),
        nin_status: matchResult.matched ? 'verified' : 'failed',
        provider: 'prembly',
        verification_response: JSON.stringify({
          ninData: { ...ninData, nin: undefined },
          matchResult,
          provider: 'prembly',
          reportId
        }),
        verified_at: matchResult.matched ? new Date() : null,
        created_at: new Date()
      });

      if (matchResult.matched) {
        const lastDigits = nin.slice(-4);
        await Database.update('users', {
          kyc_status: 'verified',
          is_verified: true,
          nin_verified_at: new Date(),
          nin_last_digits: lastDigits,
          verified_full_name: `${ninData.first_name} ${ninData.last_name}`,
          verified_dob: ninData.date_of_birth || null,
          verified_gender: ninData.gender || null,
          verified_photo_url: ninData.photo_url || null,
          verification_badge_visible: true,
          caution_flag: false,
          updated_at: new Date()
        }, 'id = ?', [userId]);

        await Database.query(
          `UPDATE devices SET status = 'verified', verified_at = NOW(), updated_at = NOW() WHERE user_id = ? AND status = 'unverified'`,
          [userId]
        );

        await Database.logAudit(userId, 'NIN_VERIFIED_REPORT', 'kyc_verifications', verificationId,
          null, { match: matchResult, provider: 'prembly', reportId });

        return {
          success: true,
          verificationId,
          message: 'Identity verified successfully'
        };
      } else {
        await Database.update('users', {
          kyc_status: 'failed',
          caution_flag: true,
          updated_at: new Date()
        }, 'id = ?', [userId]);

        await Database.logAudit(userId, 'NIN_FAILED_REPORT', 'kyc_verifications', verificationId,
          null, { match: matchResult, provider: 'prembly', reportId });

        await this.createKycFailureAlert(userId, verificationId, matchResult, reportId);

        return {
          success: false,
          verificationId,
          message: matchResult.reason || 'Identity verification failed. The information retrieved could not be sufficiently matched with your account details.'
        };
      }
    } catch (error) {
      console.error('KYC Verification Error:', error);

      const verificationId = Database.generateUUID();
      await Database.insert('kyc_verifications', {
        id: verificationId,
        user_id: userId,
        nin: NINVerificationService.encrypt(nin),
        nin_status: 'failed',
        provider: 'prembly',
        verification_response: JSON.stringify({ error: error.message, provider: 'prembly', reportId }),
        verified_at: null,
        created_at: new Date()
      });

      await this.createKycFailureAlert(userId, verificationId, {
        matched: false,
        reason: `Prembly API error: ${error.message}`,
        matchedFields: [],
        failedFields: [],
        confidence: 'none'
      }, reportId);

      return {
        success: false,
        verificationId,
        message: 'Identity verification is temporarily unavailable. Please try again later.'
      };
    }
  }

  /**
   * Create an admin alert when KYC fails.
   * Recorded in system_alerts for admin investigation.
   */
  static async createKycFailureAlert(userId, verificationId, matchResult, reportId) {
    try {
      const user = await Database.selectOne(
        'users',
        'name, first_name, middle_name, last_name, email',
        'id = ?',
        [userId]
      );

      const userName = user ? `${user.first_name || user.name || ''} ${user.last_name || ''}`.trim() : 'Unknown';

      await Database.insert('system_alerts', {
        id: Database.generateUUID(),
        alert_type: 'security',
        severity: 'high',
        title: 'KYC Verification Failed During Report',
        message: `User "${userName}" failed identity verification when submitting a device report. Prembly verification did not match account information.`,
        details: JSON.stringify({
          userId,
          userName,
          userEmail: user?.email,
          verificationId,
          reportId,
          matchedFields: matchResult.matchedFields,
          failedFields: matchResult.failedFields,
          reason: matchResult.reason,
          confidence: matchResult.confidence,
          timestamp: new Date().toISOString()
        }),
        is_resolved: false,
        created_at: new Date()
      });

      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        const subject = 'KYC Verification Failed — Report Submission';
        const message = `
          <p>A user's identity verification failed during report submission.</p>
          <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 16px; border-radius: 8px; margin: 15px 0;">
            <p style="margin: 0; color: #991B1B;"><strong>User:</strong> ${userName} (${user?.email})</p>
            <p style="margin: 5px 0 0; color: #991B1B;"><strong>Reason:</strong> ${matchResult.reason}</p>
            <p style="margin: 5px 0 0; color: #991B1B;"><strong>Matched Fields:</strong> ${matchResult.matchedFields.join(', ') || 'None'}</p>
            <p style="margin: 5px 0 0; color: #991B1B;"><strong>Failed Fields:</strong> ${matchResult.failedFields.join(', ') || 'N/A'}</p>
          </div>
          <p>Please investigate this failed verification in the admin dashboard.</p>
        `;
        const wrappedHtml = EmailTemplate.wrapContent(subject, message);
        const NotificationService = require('./NotificationService');
        await NotificationService.queueNotification(null, 'email', adminEmail, subject, wrappedHtml, {
          type: 'kyc_failure_alert', userId, verificationId, reportId
        });
      }

      console.log(`[IdentityMatching] KYC failure alert created for user ${userId}, verification ${verificationId}`);
    } catch (alertError) {
      console.error('[IdentityMatching] Failed to create KYC failure alert:', alertError);
    }
  }
}

module.exports = IdentityMatchingService;
