const Database = require('../config');

const DEFAULT_FEES = {
  nin_verification_fee: 500,
  report_verification_fee: 300,
  device_check_free_tier: 3,
  device_check_fee: 100,
  business_verification_fee: 2500,
  marketplace_commission_percent: 5.00,
  device_recovery_fee: 2000,
  device_release_fee: 2000,
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
    // No longer charged: NIN checks are part of each report now, and there
    // are no free reports
    const retired = ['nin_verification_fee', 'free_reports_per_device', 'nin_verification_per_device_fee'];
    for (const key of Object.keys(DEFAULT_FEES).filter((k) => !retired.includes(k))) {
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

  // 'nin_verification', 'nin_verification_fee' -> 'nin_verification'
  static feeBase(key) {
    return String(key || '').replace(/_fee$/, '');
  }

  // Fee keys a user can be invoiced for (amounts always come from settings)
  static get PAYABLE_FEES() {
    return ['device_check_fee', 'report_verification_fee', 'nin_verification_fee',
      'business_verification_fee', 'device_recovery_fee', 'business_onboarding_fee',
      'nin_verification_per_device_fee', 'device_release_fee'];
  }

  // Confirm with Paystack that an invoice was paid in full; marks it completed.
  static async confirmInvoicePayment(invoice) {
    if (!invoice) return false;
    if (invoice.status === 'completed') return true;
    try {
      const PaystackService = require('./PaystackService');
      const result = await PaystackService.verifyTransaction(invoice.reference);
      const data = result && result.data;
      const paidNaira = data ? Number(data.amount) / 100 : 0;
      if (result && result.status && data && data.status === 'success'
          && (data.currency || 'NGN') === 'NGN' && paidNaira + 0.001 >= Number(invoice.amount)) {
        await Database.query(
          "UPDATE payment_invoices SET status = 'completed', paid_at = NOW() WHERE id = ? AND status <> 'completed'",
          [invoice.id]
        );
        return true;
      }
    } catch (err) {
      console.warn('[RevenueService] Paystack verify failed for', invoice.reference, err.message);
    }
    return false;
  }

  // Use a paid invoice to unlock ONE paid action. The invoice must belong to
  // the user, be for this kind of fee, be paid (checked with Paystack), and
  // not have been used before. Returns the invoice, or null.
  static async redeemPaidInvoice(userId, referenceOrId, feeKeys) {
    if (!referenceOrId || typeof referenceOrId !== 'string') return null;
    const invoice = await Database.selectOne(
      'payment_invoices', '*', '(reference = ? OR id = ?) AND user_id = ?',
      [referenceOrId, referenceOrId, userId]
    );
    if (!invoice) return null;
    const wanted = (feeKeys || []).map((k) => this.feeBase(k));
    if (!wanted.includes(this.feeBase(invoice.purpose))) return null;
    if (!(await this.confirmInvoicePayment(invoice))) return null;
    const result = await Database.query(
      'UPDATE payment_invoices SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL',
      [invoice.id]
    );
    if (!result || result.affectedRows !== 1) return null;
    return invoice;
  }

  // A paid invoice that hasn't been used yet, WITHOUT using it. Lets a report
  // check the payment first and only use it once the report is filed, so a
  // failed identity check never wastes a payment.
  static async findPaidInvoice(userId, referenceOrId, feeKeys) {
    if (!referenceOrId || typeof referenceOrId !== 'string') return null;
    const invoice = await Database.selectOne(
      'payment_invoices', '*', '(reference = ? OR id = ?) AND user_id = ? AND consumed_at IS NULL',
      [referenceOrId, referenceOrId, userId]
    );
    if (!invoice) return null;
    const wanted = (feeKeys || []).map((k) => this.feeBase(k));
    if (!wanted.includes(this.feeBase(invoice.purpose))) return null;
    return (await this.confirmInvoicePayment(invoice)) ? invoice : null;
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
  // Every report is paid: the admin's "report verification fee". (There used
  // to be free reports after the first; there are none now.) A fee of 0
  // switches the payment step off.
  static async shouldChargeForUserReport(userId) {
    const [{ count }] = await Database.query(
      `SELECT COUNT(*) as count FROM reports
       WHERE reporter_id = ? AND status IN ('open', 'under_review', 'resolved')`,
      [userId]
    );
    const fee = Number(await this.getFee('report_verification_fee')) || 0;
    return {
      requiresPayment: fee > 0,
      reportNumber: Number(count) + 1,
      amount: fee,
      currency: 'NGN',
      reason: 'Each report has a verification fee'
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
