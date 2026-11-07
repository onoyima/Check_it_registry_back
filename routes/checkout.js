const express = require('express');
const router = express.Router();
const Database = require('../config');
const RevenueService = require('../services/RevenueService');
const PaystackService = require('../services/PaystackService');
const MonifyService = require('../services/MonifyService');
const { authenticateToken } = require('../middleware/auth');

// POST /api/checkout/initiate - Create a payment checkout session
router.post('/initiate', authenticateToken, async (req, res) => {
  try {
    const { purpose, device_id, metadata = {} } = req.body;
    const userId = req.user.id;

    if (!purpose) {
      return res.status(400).json({ error: 'Payment purpose is required' });
    }

    // Determine amount based on purpose
    let amount = 0;
    let description = '';

    // Amounts always come from the admin's price list
    const PURPOSES = {
      report_verification: ['report_verification_fee', 'Report fee'],
      device_check: ['device_check_fee', 'Item check fee'],
      business_verification: ['business_verification_fee', 'Business verification fee'],
      device_release: ['device_release_fee', 'Release fee'],
      business_onboarding: ['business_onboarding_fee', 'Business Customer Onboarding'],
    };
    if (!PURPOSES[purpose]) return res.status(400).json({ error: 'Invalid payment purpose' });
    amount = await RevenueService.getFee(PURPOSES[purpose][0]);
    description = PURPOSES[purpose][1];

    if (amount <= 0) {
      return res.json({ success: true, requiresPayment: false, message: 'No fee required' });
    }

    // Paystack is the only working provider. The "Monify" integration pointed
    // at a non-existent API and is disabled until it is rebuilt on Monnify.
    const provider = 'paystack';

    // Create invoice
    const reference = provider === 'monify'
      ? MonifyService.generateReference('CHK')
      : PaystackService.generateReference('CHK');

    const invoiceId = await RevenueService.createPaymentInvoice(
      userId, amount, purpose, reference, { device_id, ...metadata }
    );

    // Initialize transaction with the active provider
    let paymentData;
    if (provider === 'monify') {
      const result = await MonifyService.initializeTransaction({
        email: req.user.email,
        amount,
        reference,
        metadata: { invoiceId, purpose, userId, ...metadata },
        description,
      });
      paymentData = {
        provider: 'monify',
        checkout_url: result.responseBody?.checkoutUrl || result.responseBody?.redirectUrl,
        reference,
      };
    } else {
      const result = await PaystackService.initializeTransaction({
        email: req.user.email,
        amount,
        reference,
        metadata: { invoiceId, purpose, userId, ...metadata },
        callbackUrl: `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/payment/callback?kind=fee`,
      });
      paymentData = {
        provider: 'paystack',
        authorization_url: result.data?.authorization_url,
        reference,
      };
    }

    res.json({
      success: true,
      requiresPayment: true,
      invoice: {
        id: invoiceId,
        amount,
        currency: 'NGN',
        purpose,
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
