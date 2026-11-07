const Database = require('../config');

// Everything Prove Ownership charges for, and the numbers that go with it.
// Every amount is set by an admin on the Prices page and stored in
// system_settings; there are no amounts in the code. If a price has not been
// set, the action that needs it is refused with a clear message (it is never
// charged at a made-up amount).
//   unit: 'naira' (an amount), 'percent' (0-100) or 'count' (a whole number)
const PRICE_LIST = [
  { key: 'report_verification_fee', unit: 'naira', label: 'Report a stolen or lost item',
    help: 'Paid on every report, through Paystack.' },
  { key: 'device_check_fee', unit: 'naira', label: "Check someone else's item",
    help: 'Paid per check once the free checks below are used. Checking your own item is always free.' },
  { key: 'device_check_free_others', unit: 'count', label: "Free checks of other people's items",
    help: "How many checks of items that aren't theirs each person gets before paying." },
  { key: 'device_release_fee', unit: 'naira', label: 'Release fee',
    help: 'Paid by the owner to get a found item back from Prove Ownership, through Paystack.' },
  { key: 'business_verification_fee', unit: 'naira', label: 'Business verification',
    help: 'Paid once by a business to verify with its CAC number or the owner\'s NIN, through Paystack.' },
  { key: 'business_onboarding_fee', unit: 'naira', label: 'Customer onboarding by a business',
    help: 'Paid by a business each time it registers a walk-in customer and their item, through Paystack.' },
  { key: 'business_onboarding_commission_percent', unit: 'percent', label: "Business's share of the onboarding fee",
    help: 'The part of each onboarding fee credited to the business.' },
  { key: 'marketplace_commission_percent', unit: 'percent', label: 'Marketplace commission',
    help: "Taken from the seller's payout on each marketplace sale." },
];
const PRICE_KEYS = PRICE_LIST.map((p) => p.key);

class PriceNotSetError extends Error {
  constructor(item) {
    super(`The price for "${item.label}" hasn't been set yet. Please try again later.`);
    this.status = 503;
    this.priceNotSet = item.key;
  }
}

class RevenueService {
  static get PRICE_LIST() { return PRICE_LIST; }
  static get PriceNotSetError() { return PriceNotSetError; }

  // The admin's value for this price. Throws PriceNotSetError if it is
  // missing or not a valid number.
  static async getFee(key) {
    const item = PRICE_LIST.find((p) => p.key === key);
    if (!item) throw new Error(`Unknown price "${key}"`);
    const row = await Database.selectOne('system_settings', 'setting_value', 'setting_key = ?', [key]);
    const raw = row && row.setting_value != null ? String(row.setting_value).trim() : '';
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value) || value < 0) throw new PriceNotSetError(item);
    return value;
  }

  // Check a value an admin typed for a price; returns the number or throws (400)
  static validatePrice(key, value) {
    const item = PRICE_LIST.find((p) => p.key === key);
    if (!item) throw Object.assign(new Error('Unknown price'), { status: 400 });
    const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
    const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
    if (value === '' || value == null || !Number.isFinite(n) || n < 0) throw bad('Enter a number of 0 or more');
    if (item.unit === 'percent' && n > 100) throw bad('A percentage can be at most 100');
    if (item.unit === 'count' && !Number.isInteger(n)) throw bad('Enter a whole number');
    if (item.unit === 'naira' && Math.round(n * 100) !== n * 100) throw bad('Use at most 2 decimal places');
    return n;
  }

  static async setFee(key, value, adminId) {
    const n = this.validatePrice(key, value);
    const item = PRICE_LIST.find((p) => p.key === key);
    const existing = await Database.selectOne('system_settings', 'id', 'setting_key = ?', [key]);
    if (existing) {
      await Database.update('system_settings',
        { setting_value: String(n), updated_by: adminId, updated_at: new Date() },
        'setting_key = ?', [key]);
    } else {
      await Database.insert('system_settings', {
        id: Database.generateUUID(),
        setting_key: key,
        setting_value: String(n),
        setting_type: 'number',
        description: item.label,
        updated_by: adminId,
        updated_at: new Date()
      });
    }
    return { key, value: n };
  }

  // The full price list for the admin page: each item with its value, or
  // null when it hasn't been set yet
  static async getPriceList() {
    const rows = await Database.query(
      `SELECT setting_key, setting_value, updated_at FROM system_settings WHERE setting_key IN (${PRICE_KEYS.map(() => '?').join(',')})`,
      PRICE_KEYS);
    const byKey = Object.fromEntries(rows.map((r) => [r.setting_key, r]));
    return PRICE_LIST.map((p) => {
      const raw = byKey[p.key]?.setting_value;
      const n = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
      return { ...p, value: Number.isFinite(n) && n >= 0 ? n : null, updated_at: byKey[p.key]?.updated_at || null };
    });
  }

  // { key: value | null } for every price
  static async getAllFees() {
    const out = {};
    for (const p of await this.getPriceList()) out[p.key] = p.value;
    return out;
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
    return ['device_check_fee', 'report_verification_fee', 'business_verification_fee',
      'business_onboarding_fee', 'device_release_fee'];
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

  // Every report is paid: the admin's "report" price. If the admin sets it
  // to 0 the payment step is skipped; if it isn't set, reporting is refused
  // until it is (getFee throws).
  static async shouldChargeForUserReport(userId) {
    const [{ count }] = await Database.query(
      `SELECT COUNT(*) as count FROM reports
       WHERE reporter_id = ? AND status IN ('open', 'under_review', 'resolved')`,
      [userId]
    );
    const fee = await this.getFee('report_verification_fee');
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
    const row = await Database.selectOne('system_settings', 'id', "setting_key = 'active_payment_provider'");
    if (row) await Database.update('system_settings', { setting_value: provider, updated_by: adminId, updated_at: new Date() }, 'id = ?', [row.id]);
    else await Database.insert('system_settings', { id: Database.generateUUID(), setting_key: 'active_payment_provider', setting_value: provider, setting_type: 'string', description: 'Payment provider for fees', updated_by: adminId, updated_at: new Date() });
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
