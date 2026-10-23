// Paystack: Paystack has no escrow product, so the money waits in our own
// Paystack balance and the seller is paid by a Paystack transfer on release.
const Database = require('../../../config');
const PaystackService = require('../../PaystackService');

module.exports = {
  name: 'paystack',
  label: 'Paystack (money waits in our Paystack balance)',
  holdsFunds: false, // we hold the money, not Paystack
  ready: true,
  configured: () => !!process.env.PAYSTACK_SECRET_KEY,

  async initializePayment({ reference, amount, email, metadata, callbackUrl }) {
    const r = await PaystackService.initializeTransaction({ email, amount, reference, metadata, callbackUrl });
    return { authorizationUrl: r.data.authorization_url, accessCode: r.data.access_code };
  },

  async verifyPayment(reference) {
    const r = await PaystackService.verifyTransaction(reference);
    const ok = !!r?.status && r.data?.status === 'success';
    return { paid: ok, amount: ok ? Number(r.data.amount) / 100 : 0, currency: r.data?.currency || 'NGN' };
  },

  async release({ sellerId, amount, reference, reason }) {
    const bank = await Database.selectOne('seller_bank_accounts', '*', 'user_id = ? AND is_verified = 1', [sellerId]);
    if (!bank) throw new Error('Seller has no verified bank account for payout');
    if (!bank.recipient_code) throw new Error('Seller recipient code not found');
    const r = await PaystackService.initiateTransfer({ amount, recipientCode: bank.recipient_code, reference, reason });
    if (!r?.status) throw new Error('Payout failed: ' + (r?.message || 'unknown error'));
    return { success: true, transferCode: r.data.transfer_code || r.data.code || reference };
  },

  async refund({ paymentReference, amount }) {
    const r = await PaystackService.refund(paymentReference, amount);
    return { success: !!r?.status, refundReference: r?.data?.id ? String(r.data.id) : null };
  },
};
