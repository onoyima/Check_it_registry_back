const express = require('express');
const router = express.Router();
const Database = require('../config');
const notifier = require('../services/EnhancedNotificationService');
const crypto = require('crypto');
const { escapeHtml } = require('../utils/escape-html');

// IMPORTANT: this router is mounted in app.js BEFORE express.json(), so the
// body below is the exact raw bytes Paystack signed.

// POST /api/payments/webhook/paystack - Paystack webhook
router.post('/paystack', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    console.error('Paystack webhook received but PAYSTACK_SECRET_KEY is not set');
    return res.status(500).json({ error: 'Payments are not configured' });
  }

  const signature = String(req.headers['x-paystack-signature'] || '');
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

  const sigOk = signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!sigOk) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Acknowledge quickly; Paystack retries on non-2xx
  res.sendStatus(200);

  try {
    if (event.event === 'charge.success' && event.data) {
      const { reference, amount, currency } = event.data;
      await handlePaymentSuccess(reference, Number(amount) / 100, currency || 'NGN');
    }
  } catch (error) {
    console.error('Paystack webhook processing error:', error);
  }
});

// POST /api/payments/webhook/monnify and /flutterwave - marketplace escrow
// providers. Each checks its own signature, then completes the sale the same
// way as Paystack does.
for (const name of ['monnify', 'flutterwave']) {
  router.post(`/${name}`, express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const provider = require('../services/escrow').get(name);
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    let parsed;
    try { parsed = provider.parseWebhook(rawBody, req.headers); } catch (e) { return res.status(400).json({ error: 'Invalid payload' }); }
    if (!parsed || !parsed.valid) return res.status(400).json({ error: 'Invalid signature' });
    res.sendStatus(200);
    try {
      if (parsed.paid && parsed.reference) await handlePaymentSuccess(parsed.reference, parsed.amount, parsed.currency || 'NGN');
    } catch (error) {
      console.error(`${name} webhook processing error:`, error);
    }
  });
}

async function handlePaymentSuccess(reference, amountPaid, currency) {
  if (!reference) return;

  // 1) Fee invoices (device check, report, NIN, recovery, onboarding ...)
  const invoice = await Database.selectOne('payment_invoices', '*', 'reference = ?', [reference]);
  if (invoice) {
    if (invoice.status === 'completed') return; // already processed (idempotent)
    if (currency !== 'NGN' || amountPaid + 0.001 < Number(invoice.amount)) {
      console.error(`Webhook amount mismatch for ${reference}: paid ${amountPaid} ${currency}, expected ${invoice.amount} NGN`);
      return;
    }
    const result = await Database.query(
      "UPDATE payment_invoices SET status = 'completed', paid_at = NOW() WHERE id = ? AND status <> 'completed'",
      [invoice.id]
    );
    if (!result || result.affectedRows !== 1) return;

    const user = await Database.selectOne('users', 'email, name', 'id = ?', [invoice.user_id]);
    if (user?.email) {
      await notifier.sendEmail(user.email, 'Payment Confirmed', `
        <p>Hi ${escapeHtml(user.name)},</p>
        <p>Your payment of ₦${escapeHtml(amountPaid)} for ${escapeHtml(invoice.purpose)} has been confirmed.</p>
        <p>Reference: ${escapeHtml(reference)}</p>
      `).catch(() => {});
    }
    return;
  }

  // 2) Marketplace purchases (buyer closed the tab before returning)
  const MarketplaceService = require('../services/MarketplaceService');
  const txs = await Database.select('transactions', 'id, status', 'reference = ?', [reference]);
  if (!txs.length || txs.every((t) => t.status === 'completed')) return;
  try {
    if (txs.length > 1 || reference.startsWith('BUL')) {
      await MarketplaceService.bulkCompletePurchase(reference);
    } else {
      await MarketplaceService.completePurchase(reference);
    }
  } catch (err) {
    console.error(`Webhook could not complete purchase ${reference}:`, err.message);
  }
}

// GET /api/payments/webhook/status/:reference - payment status (owner only)
router.get('/status/:reference', express.json(), async (req, res) => {
  try {
    const { authenticateToken } = require('../middleware/auth');
    await new Promise((resolve) => authenticateToken(req, res, resolve));
    if (!req.user) return undefined; // middleware already answered

    const { reference } = req.params;
    const invoice = await Database.selectOne('payment_invoices', '*', 'reference = ?', [reference]);
    if (!invoice || (invoice.user_id !== req.user.id && !['admin', 'super_admin'].includes(req.user.role))) {
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
