const axios = require('axios');
const crypto = require('crypto');

const MONIFY_API_KEY = process.env.MONIFY_API_KEY;
const MONIFY_SECRET_KEY = process.env.MONIFY_SECRET_KEY;
const MONIFY_BASE_URL = process.env.MONIFY_BASE_URL || 'https://monify.io/api/v1';
const MONIFY_CONTRACT_CODE = process.env.MONIFY_CONTRACT_CODE;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

class MonifyService {
  static _accessToken = null;
  static _tokenExpiry = 0;

  static async getAccessToken() {
    if (this._accessToken && Date.now() < this._tokenExpiry) {
      return this._accessToken;
    }

    const response = await axios.post(`${MONIFY_BASE_URL}/auth/login`, {
      api_key: MONIFY_API_KEY,
      secret_key: MONIFY_SECRET_KEY,
    });

    this._accessToken = response.data.responseBody.accessToken;
    this._tokenExpiry = Date.now() + (response.data.responseBody.expiresIn * 1000) - 60000;
    return this._accessToken;
  }

  static get headers() {
    return {
      'Content-Type': 'application/json',
    };
  }

  static async getAuthHeaders() {
    const token = await this.getAccessToken();
    return {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };
  }

  static async initializeTransaction({ email, amount, reference, metadata = {}, description }) {
    const headers = await this.getAuthHeaders();
    const response = await axios.post(`${MONIFY_BASE_URL}/transactions/initialize`, {
      email,
      amount: String(amount),
      reference,
      contract_code: MONIFY_CONTRACT_CODE,
      currency: 'NGN',
      callback_url: `${FRONTEND_URL}/payment/callback?kind=fee`,
      metadata: {
        ...metadata,
        mchRef: reference,
      },
      description: description || 'Prove Ownership Payment',
    }, { headers });
    return response.data;
  }

  static async verifyTransaction(reference) {
    const headers = await this.getAuthHeaders();
    const response = await axios.get(
      `${MONIFY_BASE_URL}/transactions/${reference}`,
      { headers }
    );
    return response.data;
  }

  static async initiateTransfer({ amount, bankCode, accountNumber, accountName, reference, narration }) {
    const headers = await this.getAuthHeaders();
    const response = await axios.post(`${MONIFY_BASE_URL}/disbursements/single`, {
      amount: String(amount),
      bankCode,
      accountNumber,
      accountName,
      reference,
      currency: 'NGN',
      contractCode: MONIFY_CONTRACT_CODE,
      narration: narration || 'Prove Ownership Payout',
    }, { headers });
    return response.data;
  }

  static async verifyTransfer(reference) {
    const headers = await this.getAuthHeaders();
    const response = await axios.get(
      `${MONIFY_BASE_URL}/disbursements/${reference}`,
      { headers }
    );
    return response.data;
  }

  static verifyWebhookSignature(payload, signature, timestamp) {
    const secret = MONIFY_SECRET_KEY;
    const expectedSignature = crypto
      .createHmac('sha512', secret)
      .update(JSON.stringify(payload) + timestamp)
      .digest('hex');
    return expectedSignature === signature;
  }

  static generateReference(prefix = 'MON') {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return `${prefix}-${timestamp}-${random}`;
  }
}

module.exports = MonifyService;
