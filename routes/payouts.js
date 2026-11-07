const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const Database = require('../config');
const PaymentService = require('../services/PaymentService');

// Seller payout accounts are checked and paid through the payment provider
// switched on for marketplace payments (Admin > Modules & payments), not a
// fixed one: each provider has its own bank list and bank codes.
const Escrow = require('../services/escrow');
const payoutProvider = () => Escrow.current();
const fail = (res, err, what) => {
  if (!err.status) console.error(what, err.response?.data || err.message);
  res.status(err.status || 502).json({ error: err.status ? err.message : `${what}. Please try again shortly.` });
};

// GET /api/payments/banks — banks from the payout provider
router.get('/banks', authenticateToken, async (req, res) => {
  try {
    const p = await payoutProvider();
    res.json({ data: await p.listBanks(), provider: p.name });
  } catch (err) { fail(res, err, 'The bank list is unavailable'); }
});

// POST /api/payments/resolve-account — the account holder's name
router.post('/resolve-account', authenticateToken, async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body || {};
    if (!/^\d{10}$/.test(String(accountNumber || '')) || !bankCode) return res.status(400).json({ error: 'Enter a 10-digit account number and choose the bank' });
    const p = await payoutProvider();
    res.json({ ...(await p.resolveAccount(String(accountNumber), String(bankCode))), provider: p.name });
  } catch (err) { fail(res, err, 'We could not check that account'); }
});

// GET /api/payments/seller-bank-account — the seller's saved account
router.get('/seller-bank-account', authenticateToken, async (req, res) => {
  try {
    const account = await Database.selectOne('seller_bank_accounts', '*', 'user_id = ?', [req.user.id]);
    if (!account) return res.json({ data: null });
    const current = await Escrow.currentName().catch(() => null);
    res.json({
      data: {
        id: account.id,
        bankName: account.bank_name,
        bankCode: account.bank_code,
        accountNumber: account.account_number,
        accountName: account.account_name,
        isVerified: !!account.is_verified,
        provider: account.provider || null,
        // Saved with a different provider: bank codes differ, so the
        // seller must choose their bank again before the next payout
        needsUpdate: !!current && account.provider !== current,
      },
    });
  } catch (err) {
    console.error('Get seller bank account error:', err);
    res.status(500).json({ error: 'Failed to fetch bank account' });
  }
});

// POST /api/payments/seller-bank-account — save the seller's account. The
// name is looked up with the provider here; the name the browser sends is
// not trusted.
router.post('/seller-bank-account', authenticateToken, async (req, res) => {
  try {
    const { bankCode, bankName, accountNumber } = req.body || {};
    if (!bankCode || !bankName || !/^\d{10}$/.test(String(accountNumber || ''))) {
      return res.status(400).json({ error: 'Choose the bank and enter a 10-digit account number' });
    }
    const p = await payoutProvider();
    const { accountName } = await p.resolveAccount(String(accountNumber), String(bankCode));
    const extra = await p.prepareRecipient({ accountName, accountNumber: String(accountNumber), bankCode: String(bankCode) });
    const row = {
      bank_name: String(bankName).slice(0, 255),
      bank_code: String(bankCode).slice(0, 10),
      account_number: String(accountNumber),
      account_name: accountName,
      recipient_code: extra.recipient_code || null,
      provider: p.name,
      is_verified: 1,
    };
    const existing = await Database.selectOne('seller_bank_accounts', 'id', 'user_id = ?', [req.user.id]);
    if (existing) await Database.update('seller_bank_accounts', { ...row, updated_at: new Date() }, 'user_id = ?', [req.user.id]);
    else await Database.insert('seller_bank_accounts', { id: Database.generateUUID(), user_id: req.user.id, ...row, created_at: new Date() });
    await Database.logAudit(req.user.id, 'PAYOUT_ACCOUNT_SAVED', 'seller_bank_accounts', req.user.id, null,
      { bank: row.bank_name, last4: row.account_number.slice(-4), provider: p.name }, req.ip).catch(() => {});
    res.json({ success: true, accountName, message: 'Bank account saved and verified for payouts' });
  } catch (err) { fail(res, err, 'We could not save the account'); }
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

// GET /api/payments/payouts - list seller's payout history from transactions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let whereClause = "t.user_id = ? AND t.type = 'marketplace_sale'";
    const params = [req.user.id];

    if (status && status !== 'all') {
      whereClause += ' AND t.status = ?';
      params.push(status);
    }

    const countResult = await Database.query(
      `SELECT COUNT(*) AS total FROM transactions t WHERE ${whereClause}`,
      params
    );
    const total = countResult[0]?.total || 0;

    const rows = await Database.query(
      `SELECT t.id, t.amount, t.currency, t.type, t.status, t.reference,
              t.related_entity_type, t.related_entity_id, t.created_at, t.updated_at,
              ml.title AS listing_title
       FROM transactions t
       LEFT JOIN marketplace_listings ml ON ml.id = t.related_entity_id
       WHERE ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const payouts = rows.map(r => ({
      id: r.id,
      amount: Number(r.amount),
      currency: r.currency || 'NGN',
      status: r.status,
      method: 'Bank Transfer',
      requestedAt: r.created_at,
      listingTitle: r.listing_title || null,
      reference: r.reference || null,
    }));

    res.json({
      data: payouts,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (err) {
    console.error('List payouts error:', err);
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

module.exports = router;
