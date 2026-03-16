const Database = require('../config.js');

class PaymentService {
  static async addPaymentMethod(userId, data) {
    const { type, provider, name, number, exp, cvc, country, address, city, postal, isDefault } = data;
    
    // Validate card (basic)
    if (!number || number.length < 13) throw new Error('Invalid card number');

    const id = Database.generateUUID();
    const last4 = number.slice(-4);
    const [expMonth, expYear] = exp.split('/').map(n => parseInt(n.trim()));

    // Encrypt details (Simulated encryption)
    const details = JSON.stringify({
      name,
      // In real app, never store full number/cvc. Here we simulate a token.
      token: `${provider}_tok_${Date.now()}`,
      billing_address: { country, address, city, postal }
    });

    // If simulating Stripe/Paystack, we would call their API here to get a token.

    if (isDefault) {
      // Unset previous default
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
      type, // 'marketplace_purchase', 'subscription'
      status: 'pending',
      related_entity_type: entityType,
      related_entity_id: relatedEntityId,
      created_at: new Date(),
      updated_at: new Date()
    };

    await Database.insert('transactions', transaction);
    return transaction;
  }

  static async processPayment(userId, amount, methodId) {
    // 1. Get payment method
    const method = await Database.selectOne('payment_methods', '*', 'id = ? AND user_id = ?', [methodId, userId]);
    if (!method) throw new Error('Invalid payment method');

    // 2. Simulate processor call
    // await stripe.charges.create(...)
    
    // Simulate Success
    const success = true; 
    
    if (!success) {
      throw new Error('Payment declined');
    }

    return {
      success: true,
      transaction_id: `txn_${Date.now()}`,
      status: 'completed'
    };
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
