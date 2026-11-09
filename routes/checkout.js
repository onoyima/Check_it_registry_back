const express = require('express');
const router = express.Router();
const Database = require('../config');
const RevenueService = require('../services/RevenueService');
const PaystackService = require('../services/PaystackService');
const { authenticateToken } = require('../middleware/auth');

// Only allow same-origin relative paths so the post-payment redirect cannot be
// abused as an open redirect.
function safeReturnTo(value) {
  if (typeof value !== 'string') return '';
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '';
  if (/[\u0000-\u001f]/.test(path)) return '';
  return path.slice(0, 500);
}

// POST /api/checkout/initiate - Create a payment checkout session
router.post('/initiate', authenticateToken, async (req, res) => {
  try {
    const { purpose, device_id, metadata = {} } = req.body;
    const userId = req.user.id;

    if (!purpose) {
      return res.status(400).json({ error: 'Payment purpose is required' });
    }

    // Amounts always come from the admin's price list
    const PURPOSES = {
      report_verification: ['report_verification_fee', 'Report fee'],
      device_check: ['device_check_fee', 'Item check fee'],
      business_verification: ['business_verification_fee', 'Business verification fee'],
      device_release: ['device_release_fee', 'Release fee'],
      business_onboarding: ['business_onboarding_fee', 'Business Customer Onboarding'],
    };
    if (!PURPOSES[purpose]) return res.status(400).json({ error: 'Invalid payment purpose' });
    const feeKey = PURPOSES[purpose][0];
    const amount = await RevenueService.getFee(feeKey);
    const description = PURPOSES[purpose][1];

    if (amount <= 0) {
      return res.json({ success: true, requiresPayment: false, message: 'No fee required' });
    }

    // Paystack is the only working provider. Fee references use the same FEE-
    // prefix as every other fee flow so the callback can recognise them.
    const reference = PaystackService.generateReference('FEE');
    const returnTo = safeReturnTo(req.body.return_to);

    const invoiceId = await RevenueService.createPaymentInvoice(
      userId, amount, feeKey, reference, { device_id, ...metadata, return_to: returnTo }
    );

    const frontend = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const callbackQuery = new URLSearchParams({ kind: 'fee' });
    if (returnTo) callbackQuery.set('return_to', returnTo);
    const result = await PaystackService.initializeTransaction({
      email: req.user.email,
      amount,
      reference,
      metadata: { invoiceId, purpose: feeKey, userId, ...metadata },
      callbackUrl: `${frontend}/payment/callback?${callbackQuery.toString()}`,
    });
    const paymentData = {
      provider: 'paystack',
      authorization_url: result.data?.authorization_url,
      reference,
    };

    res.json({
      success: true,
      requiresPayment: true,
      invoice: {
        id: invoiceId,
        amount,
        currency: 'NGN',
        purpose: feeKey,
        description,
        reference,
      },
      payment: paymentData,
    });
  } catch (error) {
    if (!error.status) console.error('Checkout initiate error:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to initiate checkout' });
  }
});

// GET /api/checkout/status/:reference - Check checkout status
router.get('/status/:reference', authenticateToken, async (req, res) => {
  try {
    const { reference } = req.params;
    const invoice = await Database.selectOne('payment_invoices', '*', 'reference = ?', [reference]);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (invoice.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      data: {
        id: invoice.id,
        status: invoice.status,
        amount: parseFloat(invoice.amount),
        purpose: invoice.purpose,
        reference: invoice.reference,
        paid_at: invoice.paid_at || null,
        created_at: invoice.created_at,
      },
    });
  } catch (error) {
    console.error('Checkout status error:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

module.exports = router;
