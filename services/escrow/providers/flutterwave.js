// Flutterwave: the buyer pays into our Flutterwave balance; release pays the
// seller with a Flutterwave transfer, refund uses Flutterwave's refund API.
//
// Settings (backend .env): FLW_SECRET_KEY, FLW_SECRET_HASH (the webhook
// "secret hash" set in your Flutterwave dashboard), FLW_BASE_URL (optional).
const axios = require('axios');
const crypto = require('crypto');
const Database = require('../../../config');

const BASE = () => (process.env.FLW_BASE_URL || 'https://api.flutterwave.com').replace(/\/+$/, '');
const headers = () => ({ Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' });

module.exports = {
  name: 'flutterwave',
  label: 'Flutterwave',
  holdsFunds: false,
  ready: true,
  configured: () => !!(process.env.FLW_SECRET_KEY && process.env.FLW_SECRET_HASH),

  async initializePayment({ reference, amount, email, name, description, callbackUrl, metadata }) {
    const r = await axios.post(`${BASE()}/v3/payments`, {
      tx_ref: reference, amount: Number(amount), currency: 'NGN', redirect_url: callbackUrl,
      customer: { email, name: name || email }, meta: metadata || {},
      customizations: { title: 'Prove Ownership', description: description || 'Marketplace purchase' },
    }, { headers: headers(), timeout: 20000 });
    if (!r.data?.data?.link) throw new Error(r.data?.message || 'Flutterwave could not start the payment');
    return { authorizationUrl: r.data.data.link };
  },

  async verifyPayment(reference) {
    const r = await axios.get(`${BASE()}/v3/transactions/verify_by_reference`, { params: { tx_ref: reference }, headers: headers(), timeout: 20000 });
    const d = r.data?.data || {};
    const paid = r.data?.status === 'success' && d.status === 'successful';
    return { paid, amount: paid ? Number(d.amount) : 0, currency: d.currency || 'NGN', providerReference: d.id ? String(d.id) : null };
  },

  async release({ sellerId, amount, reference, reason }) {
    const bank = await Database.selectOne('seller_bank_accounts', '*', 'user_id = ? AND is_verified = 1', [sellerId]);
    if (!bank) throw new Error('Seller has no verified bank account for payout');
    const r = await axios.post(`${BASE()}/v3/transfers`, {
      account_bank: bank.bank_code, account_number: bank.account_number, amount: Number(amount),
      narration: reason || 'Prove Ownership payout', currency: 'NGN', reference,
    }, { headers: headers(), timeout: 30000 });
    if (r.data?.status !== 'success') throw new Error('Payout failed: ' + (r.data?.message || 'unknown error'));
    return { success: true, transferCode: r.data?.data?.id ? String(r.data.data.id) : reference };
  },

  async refund({ providerReference, amount }) {
    const r = await axios.post(`${BASE()}/v3/transactions/${providerReference}/refund`, { amount: Number(amount) }, { headers: headers(), timeout: 30000 });
    return { success: r.data?.status === 'success', refundReference: r.data?.data?.id ? String(r.data.data.id) : null };
  },

  // Flutterwave sends the dashboard "secret hash" in the verif-hash header
  parseWebhook(rawBody, hdrs) {
    const hash = String(hdrs['verif-hash'] || '');
    const want = String(process.env.FLW_SECRET_HASH || '');
    if (!want || hash.length !== want.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(want))) return { valid: false };
    const event = JSON.parse(rawBody.toString('utf8'));
    const d = event.data || {};
    return { valid: true, paid: event.event === 'charge.completed' && d.status === 'successful', reference: d.tx_ref, amount: Number(d.amount || 0), currency: d.currency || 'NGN' };
  },
};
