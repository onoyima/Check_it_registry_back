const Database = require('../config');

const DEFAULT_FEES = {
  nin_verification_fee: 500,
  report_verification_fee: 300,
  device_check_free_tier: 3,
  device_check_fee: 100,
  business_verification_fee: 2500,
  marketplace_commission_percent: 5.00,
  device_recovery_fee: 2000,
  business_onboarding_fee: 5000,
  business_onboarding_commission_percent: 30,
  free_reports_per_device: 3,
  nin_verification_per_device_fee: 500,
};

class RevenueService {
  static async getFee(key) {
    const row = await Database.selectOne('system_settings', 'setting_value',
      'setting_key = ?', [key]);
    if (row) return parseFloat(row.setting_value);
    if (DEFAULT_FEES[key] !== undefined) {
      console.warn(`[RevenueService] Fee '${key}' not found in system_settings, using hardcoded fallback: ${DEFAULT_FEES[key]}`);
      return DEFAULT_FEES[key];
    }
    console.error(`[RevenueService] Fee '${key}' not found in system_settings and no fallback defined.`);
    return 0;
  }

  static async setFee(key, value, adminId) {
    const existing = await Database.selectOne('system_settings', 'id',
      'setting_key = ?', [key]);
    if (existing) {
      await Database.update('system_settings',
        { setting_value: String(value), updated_by: adminId, updated_at: new Date() },
        'setting_key = ?', [key]);
    } else {
      await Database.insert('system_settings', {
        id: Database.generateUUID(),
        setting_key: key,
        setting_value: String(value),
        setting_type: 'number',
        description: key,
        updated_by: adminId,
        updated_at: new Date()
      });
    }
    return { key, value };
  }

  static async getAllFees() {
    const fees = {};
    for (const key of Object.keys(DEFAULT_FEES)) {
      fees[key] = await this.getFee(key);
    }
    return fees;
  }

  static async getUserFreeCheckCount(userId) {
    const [{ count }] = await Database.query(
      `SELECT COUNT(*) as count FROM device_check_logs WHERE checker_user_id = ? AND is_paid = 0`,
      [userId]
    );
    return count;
  }

  static async deductFreeCheckCredit(userId) {
    const freeTier = await this.getFee('device_check_free_tier');
    const used = await this.getUserFreeCheckCount(userId);
    return used < freeTier;
  }

  static async chargeForCheck(userId, amount, reference) {
    const transactionId = Database.generateUUID();
    await Database.insert('transactions', {
      id: transactionId,
      user_id: userId,
      type: 'device_check_fee',
      amount: amount,
      status: 'completed',
      reference: reference,
      description: `Device check fee`,
      created_at: new Date()
    });
    return transactionId;
  }

  static async chargeForReport(userId, amount, reportId, reference) {
    const transactionId = Database.generateUUID();
    await Database.insert('transactions', {
      id: transactionId,
      user_id: userId,
      type: 'report_verification_fee',
      amount: amount,
      status: 'completed',
      reference: reference,
      related_entity_id: reportId,
      description: `Report verification fee`,
      created_at: new Date()
    });
    return transactionId;
  }

  static async deductMarketplaceCommission(listingId, saleAmount, sellerId) {
    const commissionPercent = await this.getFee('marketplace_commission_percent');
    const commissionAmount = parseFloat((saleAmount * commissionPercent / 100).toFixed(2));
    const sellerAmount = parseFloat((saleAmount - commissionAmount).toFixed(2));

    const feeTxnId = Database.generateUUID();
    await Database.insert('transactions', {
      id: feeTxnId,
      user_id: sellerId,
      type: 'marketplace_commission',
      amount: commissionAmount,
      status: 'completed',
      related_entity_id: listingId,
      description: `Marketplace commission (${commissionPercent}%)`,
      created_at: new Date()
    });

    return { commissionAmount, sellerAmount, feeTxnId };
  }

  static async createPaymentInvoice(userId, amount, purpose, reference, metadata = {}) {
    const invoiceId = Database.generateUUID();
    await Database.insert('payment_invoices', {
      id: invoiceId,
      user_id: userId,
      amount: amount,
      purpose: purpose,
      reference: reference,
      status: 'pending',
      metadata: JSON.stringify(metadata),
      created_at: new Date()
    });
    return invoiceId;
  }

  static async markInvoicePaid(reference) {
    await Database.update('payment_invoices',
      { status: 'completed', paid_at: new Date() },
      'reference = ?', [reference]);
  }

  static async getUserReportCount(userId) {
    const [{ count }] = await Database.query(
      `SELECT COUNT(*) as count FROM reports WHERE reporter_id = ?`,
      [userId]
    );
    return count;
  }

  static async getUserDeviceReportCount(userId, deviceId) {
    const [{ count }] = await Database.query(
      `SELECT COUNT(*) as count FROM reports WHERE reporter_id = ? AND device_id = ?`,
      [userId, deviceId]
    );
    return count;
  }

  static async shouldChargeForReport(userId, deviceId) {
    const freeReportsPerDevice = await this.getFee('free_reports_per_device');
    const deviceReportCount = await this.getUserDeviceReportCount(userId, deviceId);
    return deviceReportCount >= freeReportsPerDevice;
  }

  /**
   * Determine if a user's next report requires payment.
   * Logic: Report #1 = paid, #2 = free, #3 = free, #4+ = paid.
   * Count is per USER (across all devices), not per device.
   * @returns {{ requiresPayment: boolean, reportNumber: number, amount?: number, currency?: string, reason?: string }}
   */
  static async shouldChargeForUserReport(userId) {
    const [{ count: completedCount }] = await Database.query(
      `SELECT COUNT(*) as count FROM reports 
       WHERE reporter_id = ? AND status IN ('open', 'under_review', 'resolved')`,
      [userId]
    );

    const reportNumber = completedCount + 1;
    const freeAfterFirst = parseInt(await this.getFee('free_reports_after_first')) || 2;

    // Report #1: always paid
    if (completedCount === 0) {
      const fee = await this.getFee('report_verification_fee');
      return {
        requiresPayment: true,
        reportNumber: 1,
        amount: fee,
        currency: 'NGN',
        reason: 'First report requires payment and identity verification'
      };
    }

    // Reports #2 through #(1 + freeAfterFirst): free
    if (completedCount <= freeAfterFirst) {
      return {
        requiresPayment: false,
        reportNumber,
        reason: 'Free report (included in your plan)'
      };
    }

    // Report #(2 + freeAfterFirst)+: paid
    const fee = await this.getFee('report_verification_fee');
    return {
      requiresPayment: true,
      reportNumber,
      amount: fee,
      currency: 'NGN',
      reason: 'Free reports exhausted. Payment required for this report.'
    };
  }

  static async getActivePaymentProvider() {
    const row = await Database.selectOne('system_settings', 'setting_value',
      "setting_key = 'active_payment_provider'");
    return row?.setting_value || 'paystack';
  }

  static async setActivePaymentProvider(provider, adminId) {
    if (!['paystack', 'monify'].includes(provider)) {
      throw new Error('Invalid payment provider. Must be paystack or monify.');
    }
    await this.setFee('active_payment_provider', provider, adminId);
    return provider;
  }

  static async createBusinessOnboarding(data) {
    const id = Database.generateUUID();
    await Database.insert('business_onboardings', {
      id,
      business_id: data.business_id,
      customer_name: data.customer_name,
      customer_email: data.customer_email || null,
      customer_phone: data.customer_phone || null,
      device_brand: data.device_brand || null,
      device_model: data.device_model || null,
      device_imei: data.device_imei || null,
      fee_amount: data.fee_amount,
      commission_amount: data.commission_amount,
      commission_percent: data.commission_percent,
      status: 'completed',
      fee_transaction_id: data.fee_transaction_id || null,
      commission_transaction_id: data.commission_transaction_id || null,
      created_at: new Date()
    });
    return id;
  }

  static async recordOnboardingCommission(businessId, onboardingId, commissionAmount) {
    const txnId = Database.generateUUID();
    await Database.insert('transactions', {
      id: txnId,
      user_id: businessId,
      type: 'business_onboarding_commission',
      amount: commissionAmount,
      status: 'completed',
      related_entity_id: onboardingId,
      description: `Commission from customer onboarding`,
      created_at: new Date()
    });
    return txnId;
  }
}

module.exports = RevenueService;
