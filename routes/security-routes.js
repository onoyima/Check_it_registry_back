const express = require('express');
const router = express.Router();
const Database = require('../config');
const SecurityService = require('../services/SecurityService');
const RevenueService = require('../services/RevenueService');
const NINVerificationService = require('../services/NINVerificationService');
const CACVerificationService = require('../services/CACVerificationService');
const FraudDetectionService = require('../services/FraudDetectionService');
const { authenticateToken } = require('../middleware/auth');

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

    const token = Database.generateJWT({
      id: req.user.id,
      mfa_verified: true,
      mfa_action: actionType,
      mfa_time: Date.now()
    });

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
    const user = await Database.selectOne('users', 'is_verified, nin_verified_at, nin_last_digits',
      'id = ?', [req.user.id]);
    const kycRecords = await Database.query(
      'SELECT verification_type, status, verified_at FROM kyc_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
      [req.user.id]
    );
    res.json({
      nin_verified: user?.is_verified === 1,
      nin_verified_at: user?.nin_verified_at || null,
      nin_last_digits: user?.nin_last_digits || null,
      kyc_records: kycRecords || [],
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

router.post('/nin/verify', async (req, res) => {
  try {
    const { nin } = req.body;
    if (!nin) return res.status(400).json({ error: 'NIN is required' });

    const fee = await RevenueService.getFee('nin_verification_fee');

    /* Check payment */
    const { pay_by_pass } = req.body;
    if (!pay_by_pass) {
      const invoiceId = await RevenueService.createPaymentInvoice(
        req.user.id, fee, 'nin_verification',
        `NIN-${req.user.id}-${Date.now()}`,
        { nin }
      );
      return res.json({
        requiresPayment: true,
        invoiceId,
        amount: fee,
        purpose: 'NIN Verification Fee',
        message: `Payment of ₦${fee} required for NIN verification.`
      });
    }

    const fraudCheck = await FraudDetectionService.checkAndFlag(req.user.id, 'NIN_VERIFY', {
      ipAddress: req.clientIp
    });

    const result = await NINVerificationService.verifyAndLink(req.user.id, nin);

    await SecurityService.logCriticalAction(req.user.id, 'NIN_VERIFY', {
      success: result.success,
      deviceId: null,
      reference: result.verificationId,
      ipAddress: req.clientIp,
      userAgent: req.userAgent,
      executionTime: 0
    });

    res.json(result);
  } catch (error) {
    console.error('NIN verify error:', error);
    res.status(400).json({ error: error.message });
  }
});

router.post('/cac/verify', async (req, res) => {
  try {
    const { rcNumber, businessName } = req.body;
    if (!rcNumber) return res.status(400).json({ error: 'RC Number is required' });

    const fee = await RevenueService.getFee('business_verification_fee');

    const { pay_by_pass } = req.body;
    if (!pay_by_pass) {
      const invoiceId = await RevenueService.createPaymentInvoice(
        req.user.id, fee, 'business_verification',
        `CAC-${req.user.id}-${Date.now()}`,
        { rcNumber, businessName }
      );
      return res.json({
        requiresPayment: true,
        invoiceId,
        amount: fee,
        purpose: 'Business Verification Fee',
        message: `Payment of ₦${fee} required for CAC verification.`
      });
    }

    const result = await CACVerificationService.verifyAndLink(req.user.id, rcNumber, businessName);

    await SecurityService.logCriticalAction(req.user.id, 'BUSINESS_VERIFY', {
      success: true,
      reference: result.verificationId,
      ipAddress: req.clientIp
    });

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
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
