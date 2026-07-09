const express = require('express');
const router = express.Router();
const Database = require('../config');
const RevenueService = require('../services/RevenueService');
const FraudDetectionService = require('../services/FraudDetectionService');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/onboard', requireRole(['business', 'admin']), async (req, res) => {
  try {
    const { customer_name, customer_email, customer_phone, device_brand, device_model, device_imei, pay_by_pass } = req.body;
    if (!customer_name) return res.status(400).json({ error: 'Customer name is required' });

    const fee = await RevenueService.getFee('business_onboarding_fee');
    const commissionPercent = await RevenueService.getFee('business_onboarding_commission_percent');

    if (!pay_by_pass) {
      const invoiceId = await RevenueService.createPaymentInvoice(
        req.user.id, fee, 'business_onboarding',
        `BON-${req.user.id}-${Date.now()}`,
        { customer_name, customer_email, customer_phone, device_brand, device_model, device_imei }
      );
      return res.json({
        requiresPayment: true,
        invoiceId,
        amount: fee,
        commissionPercent,
        purpose: 'Business Customer Onboarding Fee',
        message: `Payment of ₦${fee} required for customer onboarding.`
      });
    }

    const fraudCheck = await FraudDetectionService.checkAndFlag(req.user.id, 'BUSINESS_ONBOARD', {
      ipAddress: req.clientIp,
    });

    const commissionAmount = parseFloat((fee * commissionPercent / 100).toFixed(2));

    const onboardingId = await RevenueService.createBusinessOnboarding({
      business_id: req.user.id,
      customer_name,
      customer_email,
      customer_phone,
      device_brand,
      device_model,
      device_imei,
      fee_amount: fee,
      commission_amount: commissionAmount,
      commission_percent: commissionPercent,
      fee_transaction_id: null,
    });

    const commissionTxnId = await RevenueService.recordOnboardingCommission(req.user.id, onboardingId, commissionAmount);

    await Database.update('business_onboardings',
      { commission_transaction_id: commissionTxnId, status: 'completed' },
      'id = ?', [onboardingId]);

    await RevenueService.markInvoicePaid(pay_by_pass);

    await Database.logAudit(req.user.id, 'BUSINESS_ONBOARD', 'business_onboardings', onboardingId,
      null, { customer_name, fee, commissionAmount }, req.ip);

    res.json({
      success: true,
      onboardingId,
      fee_amount: fee,
      commission_amount: commissionAmount,
      message: `Customer onboarded successfully. Your commission: ₦${commissionAmount}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to onboard customer' });
  }
});

router.get('/onboardings', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params = [];
    if (req.user.role !== 'admin') {
      where += ' AND bo.business_id = ?';
      params.push(req.user.id);
    }

    const onboardings = await Database.query(`
      SELECT bo.*, u.name as business_name, u.email as business_email
      FROM business_onboardings bo
      LEFT JOIN users u ON bo.business_id = u.id
      ${where}
      ORDER BY bo.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const [{ total }] = await Database.query(
      `SELECT COUNT(*) as total FROM business_onboardings bo ${where}`, params
    );

    res.json({
      data: onboardings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch onboardings' });
  }
});

router.get('/onboardings/stats', async (req, res) => {
  try {
    let where = 'WHERE bo.status = ?';
    const params = ['completed'];
    if (req.user.role !== 'admin') {
      where += ' AND bo.business_id = ?';
      params.push(req.user.id);
    }

    const stats = await Database.query(`
      SELECT
        COUNT(*) as total_onboardings,
        COALESCE(SUM(bo.commission_amount), 0) as total_commission,
        COALESCE(SUM(bo.fee_amount), 0) as total_fees
      FROM business_onboardings bo
      ${where}
    `, params);

    res.json({
      total_onboardings: stats[0]?.total_onboardings || 0,
      total_commission: parseFloat(stats[0]?.total_commission || 0),
      total_fees: parseFloat(stats[0]?.total_fees || 0),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch onboarding stats' });
  }
});

module.exports = router;
