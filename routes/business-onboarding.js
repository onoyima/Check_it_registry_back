const express = require('express');
const router = express.Router();
const Database = require('../config');
const RevenueService = require('../services/RevenueService');
const FraudDetectionService = require('../services/FraudDetectionService');
const NotificationService = require('../services/NotificationService');
const PIIEncryptionService = require('../services/PIIEncryptionService');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { buildUserNameFields, getDisplayName } = require('../utils/user-helpers');

router.use(authenticateToken);

router.post('/onboard', requireRole(['business', 'admin']), async (req, res) => {
  try {
    const {
      customer_first_name, customer_last_name, customer_middle_name,
      customer_email, customer_phone,
      device_brand, device_model, device_imei,
      pay_by_pass
    } = req.body;

    const customerName = getDisplayName(buildUserNameFields({
      first_name: customer_first_name, last_name: customer_last_name, middle_name: customer_middle_name
    })) || req.body.customer_name;

    if (!customerName) return res.status(400).json({ error: 'Customer name is required' });

    // Validate email/phone uniqueness for new customer accounts
    if (customer_email) {
      const existingEmail = await Database.selectOne('users', 'id', 'email_hash = ?', [PIIEncryptionService.hashEmail(customer_email)]);
      if (existingEmail) {
        return res.status(409).json({ error: 'A user with this email already exists. Cannot onboard duplicate account.' });
      }
    }
    if (customer_phone) {
      const existingPhone = await Database.selectOne('users', 'id', 'phone_hash = ?', [PIIEncryptionService.hashPhone(customer_phone)]);
      if (existingPhone) {
        return res.status(409).json({ error: 'A user with this phone number already exists. Cannot onboard duplicate account.' });
      }
    }

    const fee = await RevenueService.getFee('business_onboarding_fee');
    const commissionPercent = await RevenueService.getFee('business_onboarding_commission_percent');

    if (!pay_by_pass) {
      const invoiceId = await RevenueService.createPaymentInvoice(
        req.user.id, fee, 'business_onboarding',
        `BON-${req.user.id}-${Date.now()}`,
        { customer_name: customerName, customer_email, customer_phone, device_brand, device_model, device_imei }
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
    if (fraudCheck.blocked) {
      return res.status(403).json({ error: 'Action blocked due to security concerns.' });
    }

    // Create customer user account
    const customerUserId = Database.generateUUID();
    const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';
    const passwordHash = await Database.hashPassword(tempPassword);

    await Database.insert('users', {
      id: customerUserId,
      ...buildUserNameFields({
        first_name: customer_first_name, last_name: customer_last_name, middle_name: customer_middle_name
      }),
      name: customerName,
      email: customer_email ? customer_email.toLowerCase().trim() : `${customerUserId}@onboarded.local`,
      password_hash: passwordHash,
      phone: customer_phone?.trim() || null,
      role: 'user',
      region: 'default',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const commissionAmount = parseFloat((fee * commissionPercent / 100).toFixed(2));

    const onboardingId = await RevenueService.createBusinessOnboarding({
      business_id: req.user.id,
      customer_name: customerName,
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

    await Database.logAudit(req.user.id, 'BUSINESS_ONBOARD', 'business_onboardings', onboardingId,
      null, { customer_name: customerName, customer_user_id: customerUserId, fee, commissionAmount }, req.ip);

    // Send welcome email with temporary password to new customer
    if (customer_email) {
      try {
        await NotificationService.queueNotification(
          customerUserId, 'email', customer_email,
          'Welcome to Prove Ownership - Your Account',
          `
            <h2>Welcome to Prove Ownership!</h2>
            <p><strong>${customerName}</strong>, a business partner has created an account for you.</p>
            <div style="background:#EFF6FF;border-left:4px solid #2563EB;padding:16px;border-radius:8px;margin:16px 0;">
              <p><strong>Login Email:</strong> ${customer_email}</p>
              <p><strong>Temporary Password:</strong> <code style="font-size:16px;background:#E5E7EB;padding:4px 8px;border-radius:4px;">${tempPassword}</code></p>
            </div>
            <p>Please log in and change your password immediately for security.</p>
            <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="display:inline-block;padding:12px 24px;background:#2563EB;color:white;border-radius:8px;text-decoration:none;">Login Now</a></p>
          `,
          { type: 'onboarding_welcome', business_id: req.user.id }
        );
      } catch (emailErr) {
        console.error('[Onboarding] Welcome email error:', emailErr.message);
      }
    }

    res.json({
      success: true,
      onboardingId,
      customerId: customerUserId,
      fee_amount: fee,
      commission_amount: commissionAmount,
      message: `Customer onboarded successfully. Your commission: ₦${commissionAmount}`,
    });
  } catch (error) {
    console.error('[Onboarding] Error:', error);
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

router.post('/payout-settings', async (req, res) => {
  try {
    const { bank_name, account_number, account_name } = req.body;
    if (!account_number || !account_name) {
      return res.status(400).json({ error: 'Account number and name are required' });
    }
    await Database.update('users', {
      payout_bank_name: bank_name,
      payout_account_number: account_number,
      payout_account_name: account_name,
      updated_at: new Date()
    }, 'id = ?', [req.user.id]);
    res.json({ message: 'Payout settings updated successfully' });
  } catch (error) {
    console.error('Payout settings error:', error);
    res.status(500).json({ error: 'Failed to update payout settings' });
  }
});

module.exports = router;
