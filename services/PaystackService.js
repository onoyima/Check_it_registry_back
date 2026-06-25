const axios = require('axios');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = process.env.PAYSTACK_PAYMENT_URL || 'https://api.paystack.co';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

class PaystackService {
  static get headers() {
    return {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    };
  }

  // Initialize a transaction (buyer pays)
  static async initializeTransaction({ email, amount, reference, metadata }) {
    const url = `${PAYSTACK_BASE_URL}/transaction/initialize`;
    const response = await axios.post(url, {
      email,
      amount: Math.round(amount * 100), // Paystack uses kobo
      reference,
      callback_url: `${FRONTEND_URL}/payment/callback`,
      metadata,
    }, { headers: this.headers });
    return response.data;
  }

  // Verify transaction after payment
  static async verifyTransaction(reference) {
    const url = `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`;
    const response = await axios.get(url, { headers: this.headers });
    return response.data;
  }

  // List banks for dropdown
  static async listBanks() {
    const url = `${PAYSTACK_BASE_URL}/bank?country=nigeria`;
    const response = await axios.get(url, { headers: this.headers });
    return response.data;
  }

  // Resolve account number to get account name
  static async resolveAccountNumber(accountNumber, bankCode) {
    const url = `${PAYSTACK_BASE_URL}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`;
    const response = await axios.get(url, { headers: this.headers });
    return response.data;
  }

  // Create transfer recipient (seller's bank account)
  static async createTransferRecipient({ name, accountNumber, bankCode }) {
    const url = `${PAYSTACK_BASE_URL}/transferrecipient`;
    const response = await axios.post(url, {
      type: 'nuban',
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN',
    }, { headers: this.headers });
    return response.data;
  }

  // Initiate transfer to seller
  static async initiateTransfer({ amount, recipientCode, reference, reason }) {
    const url = `${PAYSTACK_BASE_URL}/transfer`;
    const response = await axios.post(url, {
      source: 'balance',
      amount: Math.round(amount * 100), // Kobo
      recipient: recipientCode,
      reference,
      reason: reason || 'Marketplace payout',
    }, { headers: this.headers });
    return response.data;
  }

  // Verify transfer status
  static async verifyTransfer(transferCode) {
    const url = `${PAYSTACK_BASE_URL}/transfer/verify/${transferCode}`;
    const response = await axios.get(url, { headers: this.headers });
    return response.data;
  }

  // Get balance
  static async getBalance() {
    const url = `${PAYSTACK_BASE_URL}/balance`;
    const response = await axios.get(url, { headers: this.headers });
    return response.data;
  }

  // Generate unique reference
  static generateReference(prefix = 'CHKIT') {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return `${prefix}-${timestamp}-${random}`;
  }
}

module.exports = PaystackService;
