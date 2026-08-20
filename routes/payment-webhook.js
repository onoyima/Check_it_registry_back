const express = require('express');
const router = express.Router();
const Database = require('../config');
const RevenueService = require('../services/RevenueService');
const notifier = require('../services/EnhancedNotificationService');

// POST /api/payments/webhook/paystack - Paystack webhook
router.post('/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const crypto = require('crypto');
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.body;

    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    if (hash !== signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(rawBody);

    if (event.event === 'charge.success') {
      const { reference, status, amount, metadata } = event.data;
      await handlePaymentSuccess(reference, status, amount / 100, metadata);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Paystack webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// POST /api/payments/webhook/monify - Monify webhook
router.post('/monify', express.json(), async (req, res) => {
  try {
    const MonifyService = require('../services/MonifyService');
    const signature = req.headers['x-monify-signature'];
    const timestamp = req.headers['x-monify-timestamp'];

    if (!MonifyService.verifyWebhookSignature(req.body, signature, timestamp)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body;

    if (event.eventType === 'SUCCESSFUL_TRANSACTION') {
      const { paymentReference, amountPaid } = event.transactionInformation;
      await handlePaymentSuccess(paymentReference, 'success', parseFloat(amountPaid), event.customerInformation);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Monify webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function handlePaymentSuccess(reference, status, amount, metadata) {
  try {
    const invoice = await Database.selectOne('payment_invoices', '*', 'reference = ?', [reference]);
    if (!invoice || invoice.status === 'completed') return;

    await Database.transaction(async (connection) => {
      await connection.execute(
        'UPDATE payment_invoices SET status = ?, paid_at = NOW() WHERE id = ?',
        ['completed', invoice.id]
      );

      await connection.execute(
        `INSERT INTO transactions (id, user_id, type, amount, status, reference, related_entity_id, description, created_at)
         VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, NOW())`,
        [
          Database.generateUUID(),
          invoice.user_id,
          invoice.purpose,
          amount,
          reference,
          invoice.metadata ? JSON.parse(invoice.metadata).device_id || null : null,
          `Payment for ${invoice.purpose}`
        ]
      );
    });

    const user = await Database.selectOne('users', 'email, name', 'id = ?', [invoice.user_id]);
    if (user?.email) {
      await notifier.sendEmail(user.email, 'Payment Confirmed', `
        <p>Hi ${user.name},</p>
        <p>Your payment of ₦${amount} for ${invoice.purpose} has been confirmed.</p>
        <p>Reference: ${reference}</p>
      `);
    }
  } catch (error) {
    console.error('handlePaymentSuccess error:', error);
  }
}

// GET /api/payments/webhook/status/:reference - Check payment status
router.get('/status/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const invoice = await Database.selectOne('payment_invoices', '*', 'reference = ?', [reference]);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json({
      reference,
      status: invoice.status,
      amount: parseFloat(invoice.amount),
      purpose: invoice.purpose,
      paid_at: invoice.paid_at || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

module.exports = router;
