const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const PaymentService = require('../services/PaymentService');

// Add a new payment method
router.post('/methods', authenticateToken, async (req, res) => {
  try {
    const method = await PaymentService.addPaymentMethod(req.user.id, req.body);
    res.status(201).json(method);
  } catch (error) {
    console.error('Add payment method error:', error);
    res.status(400).json({ error: error.message });
  }
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

// Process a payment (Simulated transaction)
router.post('/charge', authenticateToken, async (req, res) => {
  try {
    const { amount, methodId, description } = req.body;
    
    // Create transaction record
    const transaction = await PaymentService.createTransaction(
      req.user.id, 
      amount, 
      'marketplace_purchase', // generic for now
      null, // related entity
      null
    );

    // Process payment
    const result = await PaymentService.processPayment(req.user.id, amount, methodId);
    
    // Update transaction status
    const Database = require('../config.js'); // Direct DB access to update transaction status
    await Database.update('transactions', { 
      status: 'completed', 
      reference: result.transaction_id,
      updated_at: new Date()
    }, 'id = ?', [transaction.id]);

    res.json({ success: true, transactionId: transaction.id });
  } catch (error) {
    console.error('Payment charge error:', error);
    res.status(400).json({ error: error.message });
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

module.exports = router;
