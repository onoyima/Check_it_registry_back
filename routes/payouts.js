const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const Database = require('../config');
const PaystackService = require('../services/PaystackService');
const PaymentService = require('../services/PaymentService');

// GET /api/payments/banks — list Nigerian banks from Paystack
router.get('/banks', authenticateToken, async (req, res) => {
  try {
    const result = await PaystackService.listBanks();
    res.json({ data: result.data });
  } catch (err) {
    console.error('List banks error:', err);
    res.status(500).json({ error: 'Failed to fetch banks' });
  }
});

// POST /api/payments/resolve-account — resolve account name from number + bank code
router.post('/resolve-account', authenticateToken, async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body;
    if (!accountNumber || !bankCode) return res.status(400).json({ error: 'Account number and bank code required' });
    const result = await PaystackService.resolveAccountNumber(accountNumber, bankCode);
    res.json({ accountName: result.data.account_name });
  } catch (err) {
    console.error('Resolve account error:', err);
    res.status(400).json({ error: err.response?.data?.message || 'Failed to resolve account' });
  }
});

// GET /api/payments/seller-bank-account — get seller's saved bank account
router.get('/seller-bank-account', authenticateToken, async (req, res) => {
  try {
    const account = await Database.selectOne('seller_bank_accounts', '*', 'user_id = ?', [req.user.id]);
    if (!account) return res.json({ data: null });
    res.json({
      data: {
        id: account.id,
        bankName: account.bank_name,
        bankCode: account.bank_code,
        accountNumber: account.account_number,
        accountName: account.account_name,
        isVerified: !!account.is_verified,
      },
    });
  } catch (err) {
    console.error('Get seller bank account error:', err);
    res.status(500).json({ error: 'Failed to fetch bank account' });
  }
});

// POST /api/payments/seller-bank-account — save/update seller's bank account
router.post('/seller-bank-account', authenticateToken, async (req, res) => {
  try {
    const { bankCode, bankName, accountNumber, accountName } = req.body;
    if (!bankCode || !bankName || !accountNumber || !accountName) {
      return res.status(400).json({ error: 'All bank fields required' });
    }

    // Create transfer recipient on Paystack
    const recipient = await PaystackService.createTransferRecipient({
      name: accountName,
      accountNumber,
      bankCode,
    });

    if (!recipient.status) throw new Error(recipient.message || 'Failed to create recipient');

    const existing = await Database.selectOne('seller_bank_accounts', 'id', 'user_id = ?', [req.user.id]);

    if (existing) {
      await Database.update('seller_bank_accounts', {
        bank_name: bankName,
        bank_code: bankCode,
        account_number: accountNumber,
        account_name: accountName,
        recipient_code: recipient.data.recipient_code,
        is_verified: 1,
        updated_at: new Date(),
      }, 'user_id = ?', [req.user.id]);
    } else {
      await Database.insert('seller_bank_accounts', {
        id: Database.generateUUID(),
        user_id: req.user.id,
        bank_name: bankName,
        bank_code: bankCode,
        account_number: accountNumber,
        account_name: accountName,
        recipient_code: recipient.data.recipient_code,
        is_verified: 1,
        created_at: new Date(),
      });
    }

    res.json({ success: true, message: 'Bank account saved and verified for payouts' });
  } catch (err) {
    console.error('Save seller bank account error:', err);
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// DELETE /api/payments/seller-bank-account — remove seller's bank account
router.delete('/seller-bank-account', authenticateToken, async (req, res) => {
  try {
    await Database.delete('seller_bank_accounts', 'user_id = ?', [req.user.id]);
    res.json({ success: true, message: 'Bank account removed' });
  } catch (err) {
    console.error('Delete seller bank account error:', err);
    res.status(500).json({ error: 'Failed to remove bank account' });
  }
});

// GET /api/payments/paystack-balance — admin only: check Paystack balance
router.get('/paystack-balance', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const balances = await PaymentService.getPaystackBalance();
    res.json({ data: balances });
  } catch (err) {
    console.error('Paystack balance error:', err);
    res.status(500).json({ error: 'Failed to fetch Paystack balance' });
  }
});

module.exports = router;
