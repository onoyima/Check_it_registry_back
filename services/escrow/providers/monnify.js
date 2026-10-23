// Monnify (Moniepoint): the buyer pays into our Monnify account; on release
// we pay the seller with a Monnify disbursement, on a refund Monnify returns
// the money to the buyer. When your Monnify account has escrow switched on,
// set MONNIFY_ESCROW=true and fill in the two escrow calls marked below with
// the endpoints from Monnify's escrow documentation.
//
// Settings (backend .env):
//   MONNIFY_API_KEY, MONNIFY_SECRET_KEY, MONNIFY_CONTRACT_CODE
//   MONNIFY_WALLET_ACCOUNT  - the Monnify wallet account sellers are paid from
//   MONNIFY_BASE_URL        - https://sandbox.monnify.com (testing) or https://api.monnify.com (live)
const axios = require('axios');
const crypto = require('crypto');
const Database = require('../../../config');

const env = (k) => process.env[`MONNIFY_${k}`] || process.env[`MONIFY_${k}`] || '';
const BASE = () => (env('BASE_URL') || 'https://sandbox.monnify.com').replace(/\/+$/, '').replace(/\/api\/v\d+$/, '');
let token = null;
let tokenUntil = 0;

async function authHeaders() {
  if (!token || Date.now() > tokenUntil) {
    const basic = Buffer.from(`${env('API_KEY')}:${env('SECRET_KEY')}`).toString('base64');
    const r = await axios.post(`${BASE()}/api/v1/auth/login`, {}, { headers: { Authorization: `Basic ${basic}` }, timeout: 20000 });
    token = r.data?.responseBody?.accessToken;
    tokenUntil = Date.now() + ((Number(r.data?.responseBody?.expiresIn) || 3000) - 60) * 1000;
    if (!token) throw new Error('Monnify sign-in failed');
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

module.exports = {
  name: 'monnify',
  label: 'Monnify',
  get holdsFunds() { return env('ESCROW') === 'true'; },
  ready: true,
  configured: () => !!(env('API_KEY') && env('SECRET_KEY') && env('CONTRACT_CODE')),

  async initializePayment({ reference, amount, email, name, description, callbackUrl, metadata }) {
    const r = await axios.post(`${BASE()}/api/v1/merchant/transactions/init-transaction`, {
      amount: Number(amount),
      customerName: name || email,
      customerEmail: email,
      paymentReference: reference,
      paymentDescription: description || 'Prove Ownership marketplace purchase',
      currencyCode: 'NGN',
      contractCode: env('CONTRACT_CODE'),
      redirectUrl: callbackUrl,
      paymentMethods: ['CARD', 'ACCOUNT_TRANSFER'],
      metaData: metadata || {},
    }, { headers: await authHeaders(), timeout: 20000 });
    const body = r.data?.responseBody || {};
    if (!body.checkoutUrl) throw new Error(r.data?.responseMessage || 'Monnify could not start the payment');
    return { authorizationUrl: body.checkoutUrl, providerReference: body.transactionReference };
  },

  async verifyPayment(reference) {
    const r = await axios.get(`${BASE()}/api/v2/merchant/transactions/query`, {
      params: { paymentReference: reference }, headers: await authHeaders(), timeout: 20000,
    });
    const b = r.data?.responseBody || {};
    const paid = b.paymentStatus === 'PAID' || b.paymentStatus === 'OVERPAID';
    return { paid, amount: paid ? Number(b.amountPaid) : 0, currency: b.currencyCode || 'NGN', providerReference: b.transactionReference };
  },

  async release({ sellerId, amount, reference, reason }) {
    // Native escrow (when switched on for your account): approve the held
    // payment here using Monnify's escrow endpoint, then return.
    const bank = await Database.selectOne('seller_bank_accounts', '*', 'user_id = ? AND is_verified = 1', [sellerId]);
    if (!bank) throw new Error('Seller has no verified bank account for payout');
    const r = await axios.post(`${BASE()}/api/v2/disbursements/single`, {
      amount: Number(amount), reference, narration: reason || 'Prove Ownership payout',
      destinationBankCode: bank.bank_code, destinationAccountNumber: bank.account_number,
      currency: 'NGN', sourceAccountNumber: env('WALLET_ACCOUNT'),
    }, { headers: await authHeaders(), timeout: 30000 });
    const ok = !!r.data?.requestSuccessful;
    if (!ok) throw new Error('Payout failed: ' + (r.data?.responseMessage || 'unknown error'));
    return { success: true, transferCode: r.data?.responseBody?.reference || reference };
  },

  async refund({ providerReference, amount, reason, reference }) {
    // Native escrow: reject/return the held payment with Monnify's escrow endpoint.
    const r = await axios.post(`${BASE()}/api/v1/refunds/initiate-refund`, {
      transactionReference: providerReference, refundReference: reference, refundAmount: Number(amount),
      refundReason: reason || 'Order refunded', customerNote: 'Your Prove Ownership order was refunded',
    }, { headers: await authHeaders(), timeout: 30000 });
    return { success: !!r.data?.requestSuccessful, refundReference: reference };
  },

  // Monnify signs the raw body with HMAC-SHA512 of the secret key
  parseWebhook(rawBody, headers) {
    const sig = String(headers['monnify-signature'] || '');
    const expected = crypto.createHmac('sha512', env('SECRET_KEY')).update(rawBody).digest('hex');
    if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return { valid: false };
    const event = JSON.parse(rawBody.toString('utf8'));
    const d = event.eventData || {};
    const paid = event.eventType === 'SUCCESSFUL_TRANSACTION' && (d.paymentStatus === 'PAID' || d.paymentStatus === 'OVERPAID');
    return { valid: true, paid, reference: d.paymentReference, amount: Number(d.amountPaid || 0), currency: d.currency || 'NGN' };
  },
};
