const Database = require('../config.js');
const PaystackService = require('./PaystackService');

class PaymentService {
  static async addPaymentMethod(userId, data) {
    const { type, provider, name, number, exp, cvc, country, address, city, postal, isDefault } = data;
    
    if (!number || number.length < 13) throw new Error('Invalid card number');

    const id = Database.generateUUID();
    const last4 = number.slice(-4);
    const [expMonth, expYear] = exp.split('/').map(n => parseInt(n.trim()));

    const details = JSON.stringify({
      name,
      token: `${provider}_tok_${Date.now()}`,
      billing_address: { country, address, city, postal }
    });

    if (isDefault) {
      await Database.query('UPDATE payment_methods SET is_default = FALSE WHERE user_id = ?', [userId]);
    }

    const methodData = {
      id,
      user_id: userId,
      type: type || 'card',
      provider: provider || 'manual',
      last4,
      exp_month: expMonth,
      exp_year: expYear,
      is_default: isDefault || false,
      details,
      created_at: new Date(),
      updated_at: new Date()
    };

    await Database.insert('payment_methods', methodData);
    return methodData;
  }

  static async getPaymentMethods(userId) {
    return Database.select('payment_methods', '*', 'user_id = ?', [userId], 'is_default DESC, created_at DESC');
  }

  static async removePaymentMethod(userId, methodId) {
    const existing = await Database.selectOne('payment_methods', 'id', 'id = ? AND user_id = ?', [methodId, userId]);
    if (!existing) throw new Error('Payment method not found');
    
    await Database.delete('payment_methods', 'id = ?', [methodId]);
    return true;
  }

  static async createTransaction(userId, amount, type, relatedEntityId, entityType) {
    const id = Database.generateUUID();
    const transaction = {
      id,
      user_id: userId,
      amount,
      currency: 'NGN',
      type,
      status: 'pending',
      related_entity_type: entityType,
      related_entity_id: relatedEntityId,
      created_at: new Date(),
      updated_at: new Date()
    };
    await Database.insert('transactions', transaction);
    return transaction;
  }

  // Initialize a Paystack payment for a purchase
  // Returns the authorization URL the buyer must visit to complete payment
  static async initializePaystackPayment({ userId, email, amount, reference, listingId, metadata }) {
    const user = await Database.selectOne('users', 'name', 'id = ?', [userId]);
    const result = await PaystackService.initializeTransaction({
      email,
      amount,
      reference,
      metadata: {
        ...metadata,
        userId,
        listingId,
        customer_name: user?.name || '',
      },
    });

    return {
      authorizationUrl: result.data.authorization_url,
      accessCode: result.data.access_code,
      reference,
    };
  }

  // Verify a Paystack payment after the user completes it
  static async verifyPaystackPayment(reference) {
    const result = await PaystackService.verifyTransaction(reference);
    if (!result.status || result.data.status !== 'success') {
      throw new Error('Payment verification failed');
    }
    return {
      verified: true,
      amount: result.data.amount / 100,
      paidAt: result.data.paid_at,
      channel: result.data.channel,
      cardLast4: result.data.authorization?.last4,
    };
  }

  // Initiate payout to seller's bank account via Paystack transfer
  static async payoutToSeller({ sellerId, amount, reference, reason }) {
    const bankAccount = await Database.selectOne('seller_bank_accounts', '*', 'user_id = ? AND is_verified = 1', [sellerId]);
    if (!bankAccount) throw new Error('Seller has no verified bank account for payout');
    if (!bankAccount.recipient_code) throw new Error('Seller recipient code not found');

    const result = await PaystackService.initiateTransfer({
      amount,
      recipientCode: bankAccount.recipient_code,
      reference,
      reason,
    });

    if (!result.status) throw new Error('Payout failed: ' + (result.message || 'Unknown error'));

    return {
      success: true,
      transferCode: result.data.transfer_code || result.data.code,
      amount: result.data.amount / 100,
      status: result.data.status,
    };
  }

  // Get Paystack balance
  static async getPaystackBalance() {
    const result = await PaystackService.getBalance();
    return result.data.map(b => ({
      currency: b.currency,
      balance: b.balance / 100,
    }));
  }

  static async getWalletBalance(userId) {
    const sql = `
      SELECT 
        SUM(
          CASE 
            WHEN type IN ('marketplace_sale', 'deposit', 'refund') THEN amount 
            WHEN type IN ('payout', 'withdrawal') THEN -amount 
            ELSE 0 
          END
        ) as balance
      FROM transactions
      WHERE user_id = ? AND status = 'completed'
    `;
    const result = await Database.queryOne(sql, [userId]);
    return result ? parseFloat(result.balance || 0) : 0;
  }
}

module.exports = PaymentService;
