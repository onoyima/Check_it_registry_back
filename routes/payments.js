const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const PaymentService = require('../services/PaymentService');
const Database = require('../config');

// Add a new payment method
// Saving cards is switched off: card numbers and CVVs must never reach this
// server (PCI DSS). Payments go through Paystack's hosted page instead.
router.post('/methods', authenticateToken, (req, res) => {
  res.status(410).json({ error: 'Cards are entered on Paystack when you pay; they are not saved here.' });
});

// Get user payment methods
router.get('/methods', authenticateToken, async (req, res) => {
  try {
    const methods = await PaymentService.getPaymentMethods(req.user.id);
    res.json(methods);
  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

// Remove a payment method
router.delete('/methods/:id', authenticateToken, async (req, res) => {
  try {
    await PaymentService.removePaymentMethod(req.user.id, req.params.id);
    res.json({ message: 'Payment method removed' });
  } catch (error) {
    console.error('Delete payment method error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Initiate payment (mobile money, used by mobile checkout)
router.post('/initiate', authenticateToken, async (req, res) => {
  try {
    const { amount, phone, listing_id, type } = req.body;

    if (!amount || !phone) {
      return res.status(400).json({ error: 'Amount and phone are required' });
    }

    const reference = 'PAY-' + req.user.id + '-' + Date.now();
    const transaction = await PaymentService.createTransaction(
      req.user.id, amount, type || 'marketplace_purchase', null, { reference, listing_id, phone }
    );

    await Database.update('transactions', {
      reference,
      updated_at: new Date()
    }, 'id = ?', [transaction.id]);

    res.json({
      success: true,
      reference,
      transactionId: transaction.id,
      message: 'Payment initiated. Check your phone to complete.'
    });
  } catch (error) {
    console.error('Initiate payment error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get payment history (mobile)
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const rows = await Database.query(`
      SELECT id, type, amount, status, reference, created_at
      FROM transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, parseInt(limit), parseInt(offset)]);

    res.json(rows.map(r => ({
      id: r.id,
      type: r.type === 'marketplace_purchase' ? 'payment' : r.type,
      amount: parseFloat(r.amount),
      status: r.status,
      reference: r.reference || r.id,
      created_at: r.created_at,
    })));
  } catch (err) {
    console.error('Get payment history error:', err);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

// Get Wallet Balance
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const balance = await PaymentService.getWalletBalance(req.user.id);
    res.json({ balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user transactions
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const sql = `
      SELECT id, type, amount, status, reference, related_entity_type as method, created_at
      FROM transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await Database.query(sql, [userId, parseInt(limit), parseInt(offset)]);

    const map = rows.map(r => ({
      id: r.id,
      type: r.type === 'marketplace_purchase' || r.type === 'marketplace_sale' ? 'payment' : r.type === 'refunded' ? 'refund' : 'fee',
      amount: parseFloat(r.amount),
      status: r.status,
      method: r.method || 'manual',
      description: r.type === 'marketplace_purchase' ? 'Marketplace purchase' : r.type === 'marketplace_sale' ? 'Marketplace sale' : r.type,
      reference: r.reference || r.id,
      created_at: r.created_at,
    }));

    res.json({ data: map });
  } catch (err) {
    console.error('Get transactions error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Get single transaction by ID
router.get('/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const sql = `
      SELECT id, type, amount, status, reference, related_entity_type as method, created_at
      FROM transactions
      WHERE id = ? AND user_id = ?
    `;
    const rows = await Database.query(sql, [id, userId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const r = rows[0];
    res.json({
      data: {
        id: r.id,
        amount: parseFloat(r.amount),
        status: r.status,
        method: r.method || 'manual',
        description: r.type === 'marketplace_purchase' ? 'Marketplace purchase'
          : r.type === 'marketplace_sale' ? 'Marketplace sale'
          : r.type === 'service_fee' ? 'Platform fee' : r.type,
        reference: r.reference || r.id,
        created_at: r.created_at,
      },
    });
  } catch (err) {
    console.error('Get transaction error:', err);
    res.status(500).json({ error: 'Failed to fetch transaction' });
  }
});

module.exports = router;
