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

  async listBanks() {
    const r = await PaystackService.listBanks();
    if (!Array.isArray(r?.data) || !r.data.length) throw new Error('Paystack returned no banks');
    return r.data.map((b) => ({ name: b.name, code: String(b.code) }));
  },

  async resolveAccount(accountNumber, bankCode) {
    const r = await PaystackService.resolveAccountNumber(accountNumber, bankCode)
      .catch((e) => { throw Object.assign(new Error(e.response?.data?.message || 'We could not find that account'), { status: 400 }); });
    if (!r?.data?.account_name) throw Object.assign(new Error('We could not find that account'), { status: 400 });
    return { accountName: r.data.account_name };
  },

  // Paystack pays to a saved "transfer recipient"
  async prepareRecipient({ accountName, accountNumber, bankCode }) {
    const r = await PaystackService.createTransferRecipient({ name: accountName, accountNumber, bankCode });
    if (!r?.status) throw new Error(r?.message || 'Paystack could not save the account');
    return { recipient_code: r.data.recipient_code };
  },

  async release({ sellerId, amount, reference, reason }) {
    const bank = await Database.selectOne('seller_bank_accounts', '*', "user_id = ? AND is_verified = 1 AND provider = 'paystack'", [sellerId]);
    if (!bank) throw new Error('The seller needs to confirm their bank account for payouts');
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
