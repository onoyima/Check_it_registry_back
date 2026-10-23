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

    switch (purpose) {
      case 'report_verification':
        const shouldCharge = await RevenueService.shouldChargeForReport(userId, device_id);
        if (!shouldCharge) {
          return res.json({ success: true, requiresPayment: false, message: 'Free report available' });
        }
        amount = await RevenueService.getFee('report_verification_fee');
        description = 'Report Verification Fee';
        break;
      case 'device_check':
        const onFreeTier = await RevenueService.deductFreeCheckCredit(userId);
        if (onFreeTier) {
          return res.json({ success: true, requiresPayment: false, message: 'Free device check available' });
        }
        amount = await RevenueService.getFee('device_check_fee');
        description = 'Device Check Fee';
        break;
      case 'nin_verification':
        amount = await RevenueService.getFee('nin_verification_per_device_fee');
        description = 'NIN Verification Fee';
        break;
      case 'recovery_service':
        amount = await RevenueService.getFee('device_recovery_fee');
        description = 'Device Recovery Service';
        break;
      case 'business_onboarding':
        amount = await RevenueService.getFee('business_onboarding_fee');
        description = 'Business Customer Onboarding';
        break;
      default:
        return res.status(400).json({ error: 'Invalid payment purpose' });
      }

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
    console.error('Checkout initiate error:', error);
    res.status(500).json({ error: 'Failed to initiate checkout' });
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
