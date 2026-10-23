// Vesicash: a Nigerian escrow-only service (vesicash.com). Its API needs a
// merchant account and its documentation, so this adapter is not switched on
// yet: it shows as "not ready" in the admin settings and cannot be chosen.
// To finish it, fill in the calls below from Vesicash's API docs and set
// ready: true. Settings (backend .env): VESICASH_API_KEY, VESICASH_BASE_URL.
const notReady = async () => { throw new Error('Vesicash is not set up yet'); };

module.exports = {
  name: 'vesicash',
  label: 'Vesicash (escrow service)',
  holdsFunds: true, // Vesicash holds the money itself
  ready: false,
  configured: () => !!(process.env.VESICASH_API_KEY && process.env.VESICASH_BASE_URL),
  initializePayment: notReady, // create an escrow transaction and return its payment link
  verifyPayment: notReady,     // has the buyer paid into the escrow?
  release: notReady,           // release the escrow to the seller
  refund: notReady,            // return the escrow to the buyer
  parseWebhook: () => ({ valid: false }),
};
