const express = require('express');
const router = express.Router();
const Database = require('../config');
const SecurityService = require('../services/SecurityService');
const RevenueService = require('../services/RevenueService');
const NINVerificationService = require('../services/NINVerificationService');
const CACVerificationService = require('../services/CACVerificationService');
const BusinessVerificationService = require('../services/BusinessVerificationService');
const FraudDetectionService = require('../services/FraudDetectionService');
const IdentityService = require('../services/IdentityService');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/mfa/initiate', async (req, res) => {
  try {
    const { actionType, options = {} } = req.body;
    if (!SecurityService.isCriticalAction(actionType)) {
      return res.status(400).json({ error: 'Invalid or non-critical action type' });
    }

    const preCheck = await SecurityService.enforcePreConditions(req.user.id, actionType);
    if (!preCheck.allowed) {
      return res.status(403).json({
        error: preCheck.error,
        requiresAction: preCheck.requiresAction
      });
    }

    const fraudCheck = await FraudDetectionService.checkAndFlag(req.user.id, actionType, {
      ipAddress: req.clientIp,
      macAddress: req.macAddress,
    });
    if (fraudCheck.blocked) {
      return res.status(403).json({ error: 'Action blocked due to security concerns. Contact support.' });
    }

    const mfaResult = await SecurityService.enforceMFA(req.user.id, actionType, options);
    if (mfaResult.requiresOtp) {
      return res.json({
        requiresMfa: true,
        actionType,
        message: `Verification code(s) sent. Complete MFA to proceed.`,
        ...(mfaResult.otpResults ? { otpSent: mfaResult.otpResults } : {})
      });
    }

    res.json({ allowed: true, actionType });
  } catch (error) {
    console.error('MFA initiate error:', error);
    res.status(500).json({ error: 'Failed to initiate security check' });
  }
});

router.post('/mfa/verify', async (req, res) => {
  try {
    const { actionType, emailOtp, smsOtp } = req.body;
    if (!actionType) {
      return res.status(400).json({ error: 'Action type is required' });
    }

    const result = await SecurityService.verifyMFA(req.user.id, actionType, { emailOtp, smsOtp });
    if (!result.verified) {
      return res.status(400).json({ error: result.error || 'MFA verification failed' });
    }

    const token = Database.generatePurposeJWT('mfa_token', {
      userId: req.user.id,
      mfa_action: actionType,
    }, '10m');

    res.json({
      success: true,
      message: 'MFA verified successfully',
      mfaToken: token,
      expiresIn: '10m'
    });
  } catch (error) {
    console.error('MFA verify error:', error);
    res.status(500).json({ error: 'MFA verification failed' });
  }
});

router.get('/verification-status', async (req, res) => {
  try {
    const user = await Database.selectOne('users', 'nin_verified_at', 'id = ?', [req.user.id]);
    const st = await IdentityService.status(req.user.id);
    // (The saved NIN is never shown back, not even its last digits)
    res.json({
      nin_verified: st.identity_confirmed,
      identity_confirmed: st.identity_confirmed,
      business_confirmed: st.business_confirmed,
      nin_verified_at: st.identity_confirmed ? user?.nin_verified_at || null : null,
      names_locked: st.identity_confirmed,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch verification status' });
  }
});

router.post('/reauthenticate', async (req, res) => {
  try {
    const result = await SecurityService.requireReauthentication(req.user.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to initiate reauthentication' });
  }
});

router.post('/reauthenticate/verify', async (req, res) => {
  try {
    const { otpCode } = req.body;
    if (!otpCode) return res.status(400).json({ error: 'OTP code is required' });

    const result = await SecurityService.completeReauthentication(req.user.id, otpCode);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, message: 'Reauthentication successful' });
  } catch (error) {
    res.status(500).json({ error: 'Reauthentication failed' });
  }
});

// Confirm your identity with your NIN (free). Reports also ask for the NIN
// every time; this page just lets people do it before they ever need to.
router.post('/nin/verify', async (req, res) => {
  try {
    const { nin } = req.body || {};
    await IdentityService.confirmNin(req.user.id, nin, 'identity_page');
    await SecurityService.logCriticalAction(req.user.id, 'NIN_VERIFY', { success: true, ipAddress: req.clientIp }).catch(() => {});
    res.json({ success: true, message: 'Your identity is confirmed.' });
  } catch (error) {
    if (error instanceof IdentityService.IdentityError) return res.status(error.status || 400).json({ success: false, error: error.message });
    console.error('NIN verify error:', error);
    res.status(500).json({ error: 'Could not confirm your identity. Please try again.' });
  }
});

// Business verification: pay the business verification fee, then the CAC
// registration number is checked (with Prembly the first time only). The
// fee is only used when the business is confirmed, so trying again after a
// mistake costs nothing extra.
router.post('/cac/verify', async (req, res) => {
  try {
    const { rcNumber, pay_by_pass } = req.body || {};
    if (!rcNumber) return res.status(400).json({ error: 'Enter your business registration number (RC or BN number).' });
    const profile = await Database.selectOne('business_profiles', 'id, verification_status', 'user_id = ?', [req.user.id]);
    if (!profile) return res.status(400).json({ error: 'Complete your business profile first.' });
    if (profile.verification_status === 'verified') return res.json({ success: true, status: 'passed', message: 'Your business is already verified.' });

    const fee = Number(await BusinessVerificationService.getVerificationFee()) || 0;
    let invoice = null;
    if (fee > 0) {
      if (!pay_by_pass) return res.json({ requiresPayment: true, amount: fee, feeType: 'business_verification_fee', purpose: 'Business verification fee' });
      invoice = await RevenueService.findPaidInvoice(req.user.id, pay_by_pass, ['business_verification_fee']);
      if (!invoice) return res.status(402).json({ requiresPayment: true, amount: fee, feeType: 'business_verification_fee', error: 'We could not confirm your payment for business verification.' });
    }

    const fraudCheck = await FraudDetectionService.checkAndFlag(req.user.id, 'BUSINESS_VERIFY', { ipAddress: req.clientIp });
    if (fraudCheck.blocked) return res.status(403).json({ error: 'Action blocked due to security concerns.' });

    let result;
    try {
      result = await IdentityService.confirmBusiness(req.user.id, rcNumber, 'business_verification');
    } catch (e) {
      if (!(e instanceof IdentityService.IdentityError)) throw e;
      await Database.insert('business_verification_attempts', {
        id: Database.generateUUID(), business_profile_id: profile.id, user_id: req.user.id, rc_number: String(rcNumber).slice(0, 20),
        fee_amount: fee, payment_reference: invoice?.reference || null, provider: 'prembly', status: 'failed', status_reason: e.code, created_at: new Date(),
      }).catch(() => {});
      return res.status(e.status || 400).json({ success: false, status: 'failed', paid: !!invoice, error: e.message });
    }

    if (invoice) {
      const used = await RevenueService.redeemPaidInvoice(req.user.id, invoice.reference, ['business_verification_fee']);
      if (!used) return res.status(402).json({ requiresPayment: true, amount: fee, error: 'This payment has already been used.' });
      await Database.insert('transactions', { id: Database.generateUUID(), user_id: req.user.id, type: 'business_verification_fee', amount: fee, status: 'completed', reference: invoice.reference, description: 'Business verification fee', created_at: new Date() }).catch(() => {});
    }
    await Database.update('business_profiles', { verification_status: 'verified', verified_at: new Date(), updated_at: new Date() }, 'id = ?', [profile.id]);
    await Database.update('users', { verification_badge_visible: 1, updated_at: new Date() }, 'id = ?', [req.user.id]).catch(() => {});
    await Database.insert('business_verification_attempts', {
      id: Database.generateUUID(), business_profile_id: profile.id, user_id: req.user.id, rc_number: String(rcNumber).slice(0, 20),
      fee_amount: fee, payment_reference: invoice?.reference || null, provider: 'prembly', status: 'passed', created_at: new Date(),
    }).catch(() => {});
    await Database.logAudit(req.user.id, 'BUSINESS_VERIFIED', 'business_profiles', profile.id).catch(() => {});
    res.json({ success: true, status: 'passed', company: result.company, message: 'Your business is verified.' });
  } catch (error) {
    console.error('CAC verify error:', error);
    res.status(500).json({ error: 'Could not verify the business. Please try again.' });
  }
});

router.get('/cac/history', async (req, res) => {
  try {
    const history = await BusinessVerificationService.getVerificationHistory(req.user.id);
    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch verification history' });
  }
});

router.get('/cac/status', async (req, res) => {
  try {
    const status = await BusinessVerificationService.getVerificationStatus(req.user.id);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch verification status' });
  }
});

// Admin: verification queue
router.get('/admin/verification-queue', requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const statusFilter = req.query.status || 'pending';

    const items = await Database.query(`
      SELECT avq.*, u.name as submitter_name, u.email as submitter_email
      FROM admin_verification_queue avq
      LEFT JOIN users u ON avq.submitted_by = u.id
      WHERE avq.item_type = 'business' AND avq.status = ?
      ORDER BY
        CASE avq.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        avq.created_at DESC
      LIMIT ? OFFSET ?
    `, [statusFilter, limit, offset]);

    const [{ total }] = await Database.query(
      `SELECT COUNT(*) as total FROM admin_verification_queue WHERE item_type = 'business' AND status = ?`,
      [statusFilter]
    );

    res.json({ data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch verification queue' });
  }
});

router.put('/admin/verification-queue/:id', requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;
    const allowedStatuses = ['pending', 'in_review', 'approved', 'rejected', 'requires_info'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updateData = { status, reviewed_by: req.user.id, reviewed_at: new Date() };
    if (admin_notes) updateData.admin_notes = admin_notes;

    await Database.update('admin_verification_queue', updateData, 'id = ?', [id]);
    await Database.logAudit(req.user.id, 'VERIFICATION_QUEUE_UPDATED', 'admin_verification_queue', id,
      null, { status, admin_notes }, req.ip);

    res.json({ success: true, message: `Item marked as ${status}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update queue item' });
  }
});

router.post('/check-risk', async (req, res) => {
  try {
    const { action, deviceId } = req.body;
    const result = await FraudDetectionService.checkAndFlag(req.user.id, action || 'general', {
      ipAddress: req.clientIp,
      macAddress: req.macAddress,
      deviceId
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Risk check failed' });
  }
});

module.exports = router;
