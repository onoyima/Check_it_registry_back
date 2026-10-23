// Stand-in for Paystack's servers during tests. Payment confirmation still
// goes through the real signed webhook; this only answers the outgoing API
// calls (start a payment, verify it, pay a seller) without the network.
const PaystackService = require('../../services/PaystackService');
const payments = new Map();
function install() {
  PaystackService.initializeTransaction = async ({ reference, amount }) => {
    payments.set(reference, { amount: Number(amount), paid: false });
    return { status: true, data: { authorization_url: `https://checkout.paystack.test/${reference}`, reference } };
  };
  PaystackService.verifyTransaction = async (reference) => {
    const p = payments.get(reference);
    if (!p || !p.paid) return { status: true, data: { status: 'abandoned', amount: 0, currency: 'NGN', reference } };
    return { status: true, data: { status: 'success', amount: Math.round(p.amount * 100), currency: 'NGN', reference } };
  };
  PaystackService.createTransferRecipient = async () => ({ status: true, data: { recipient_code: 'RCP_test' } });
  PaystackService.initiateTransfer = async ({ reference }) => ({ status: true, data: { transfer_code: `TRF_${reference}`, status: 'pending' } });
}
// What the person does on Paystack's page
function markPaid(reference) { const p = payments.get(reference); if (p) p.paid = true; return p; }
module.exports = { install, markPaid, payments };
