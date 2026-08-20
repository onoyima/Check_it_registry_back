const express = require('express');
const router = express.Router();
const Database = require('../config');
const RevenueService = require('../services/RevenueService');
const SecurityService = require('../services/SecurityService');
const { authenticateToken } = require('../middleware/auth');

const requireAdmin = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Access token required' });
  try {
    const token = authHeader.split(' ')[1];
    const decoded = Database.verifyJWT(token);
    const user = await Database.selectOne('users', 'id, role', 'id = ?', [decoded.id]);
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

router.get('/fees', requireAdmin, async (req, res) => {
  try {
    const fees = await RevenueService.getAllFees();
    res.json({ fees });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch fee settings' });
  }
});

router.get('/fees/:key', authenticateToken, async (req, res) => {
  try {
    const { key } = req.params;
    const validKeys = ['nin_verification_fee', 'report_verification_fee', 'device_check_free_tier',
      'device_check_fee', 'business_verification_fee', 'marketplace_commission_percent', 'device_recovery_fee',
      'business_onboarding_fee', 'business_onboarding_commission_percent', 'free_reports_per_device',
      'nin_verification_per_device_fee'];
    if (!validKeys.includes(key)) {
      return res.status(400).json({ error: 'Invalid fee key' });
    }
    const fee = await RevenueService.getFee(key);
    res.json({ key, amount: fee, currency: 'NGN' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch fee' });
  }
});

router.put('/fees/:key', requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const validKeys = ['nin_verification_fee', 'report_verification_fee', 'device_check_free_tier',
      'device_check_fee', 'business_verification_fee', 'marketplace_commission_percent', 'device_recovery_fee',
      'business_onboarding_fee', 'business_onboarding_commission_percent', 'free_reports_per_device',
      'nin_verification_per_device_fee'];

    if (!validKeys.includes(key)) {
      return res.status(400).json({ error: 'Invalid fee key' });
    }

    const numericValue = parseFloat(value);
    if (isNaN(numericValue) || numericValue < 0) {
      return res.status(400).json({ error: 'Value must be a positive number' });
    }

    const result = await RevenueService.setFee(key, numericValue, req.user.id);
    await Database.logAudit(req.user.id, 'FEE_UPDATED', 'system_settings', key,
      null, { key, value: numericValue }, req.ip);

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update fee' });
  }
});

router.get('/provider-settings', requireAdmin, async (req, res) => {
  try {
    const ninProvider = await Database.selectOne('system_settings', 'setting_value',
      "setting_key = 'nin_verification_provider'");
    const cacProvider = await Database.selectOne('system_settings', 'setting_value',
      "setting_key = 'cac_verification_provider'");

    res.json({
      nin_verification_provider: ninProvider?.setting_value || 'prembly',
      cac_verification_provider: cacProvider?.setting_value || 'cac_ng',
      available_providers: {
        nin: ['prembly', 'dojah', 'verifyng', 'smileid'],
        cac: ['cac_ng']
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch provider settings' });
  }
});

router.put('/provider-settings/:type', requireAdmin, async (req, res) => {
  try {
    const { type } = req.params;
    const { provider } = req.body;

    if (type === 'nin' && !['prembly', 'dojah', 'verifyng', 'smileid'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid NIN provider' });
    }
    if (type === 'cac' && provider !== 'cac_ng') {
      return res.status(400).json({ error: 'Invalid CAC provider' });
    }

    const key = `${type}_verification_provider`;
    const existing = await Database.selectOne('system_settings', 'id', 'setting_key = ?', [key]);
    if (existing) {
      await Database.update('system_settings',
        { setting_value: provider, updated_by: req.user.id, updated_at: new Date() },
        'setting_key = ?', [key]);
    } else {
      await Database.insert('system_settings', {
        id: Database.generateUUID(), setting_key: key,
        setting_value: provider, setting_type: 'string',
        description: `${type.toUpperCase()} verification provider`,
        updated_by: req.user.id
      });
    }

    await Database.logAudit(req.user.id, 'PROVIDER_UPDATED', 'system_settings', key,
      null, { type, provider }, req.ip);

    res.json({ success: true, type, provider });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update provider' });
  }
});

router.get('/transactions', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const transactions = await Database.query(`
      SELECT t.*, u.name as user_name, u.email as user_email
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.type IN ('device_check_fee', 'report_verification_fee', 'marketplace_commission', 'nin_verification_fee', 'device_recovery_fee')
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    const [{ total }] = await Database.query(
      `SELECT COUNT(*) as total FROM transactions
       WHERE type IN ('device_check_fee','report_verification_fee','marketplace_commission','nin_verification_fee','device_recovery_fee')`
    );

    res.json({
      data: transactions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch revenue transactions' });
  }
});

router.get('/provider', authenticateToken, async (req, res) => {
  try {
    const ninProvider = await Database.selectOne('system_settings', 'setting_value',
      "setting_key = 'nin_verification_provider'");
    const cacProvider = await Database.selectOne('system_settings', 'setting_value',
      "setting_key = 'cac_verification_provider'");
    res.json({
      provider: ninProvider?.setting_value || 'prembly',
      nin_verification_provider: ninProvider?.setting_value || 'prembly',
      cac_verification_provider: cacProvider?.setting_value || 'cac_ng',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch provider' });
  }
});

router.put('/provider', requireAdmin, async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) return res.status(400).json({ error: 'Provider is required' });
    const type = provider === 'cac_ng' ? 'cac' : 'nin';
    const key = `${type}_verification_provider`;
    const existing = await Database.selectOne('system_settings', 'id', 'setting_key = ?', [key]);
    if (existing) {
      await Database.update('system_settings',
        { setting_value: provider, updated_by: req.user.id, updated_at: new Date() },
        'setting_key = ?', [key]);
    } else {
      await Database.insert('system_settings', {
        id: Database.generateUUID(), setting_key: key,
        setting_value: provider, setting_type: 'string',
        description: `${type.toUpperCase()} verification provider`,
        updated_by: req.user.id
      });
    }
    await Database.logAudit(req.user.id, 'PROVIDER_UPDATED', 'system_settings', key,
      null, { type, provider }, req.ip);
    res.json({ success: true, provider });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update provider' });
  }
});

router.post('/create-invoice', authenticateToken, async (req, res) => {
  try {
    const { fee_type, amount, currency, description } = req.body;
    if (!fee_type || amount === undefined) {
      return res.status(400).json({ error: 'fee_type and amount are required' });
    }
    const reference = `INV-${req.user.id}-${Date.now()}`;
    const invoiceId = await RevenueService.createPaymentInvoice(
      req.user.id, amount, fee_type, reference, { description }
    );
    res.json({ invoice_id: invoiceId, reference, amount, currency: currency || 'NGN' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

router.get('/summary', requireAdmin, async (req, res) => {
  try {
    const summary = await Database.query(`
      SELECT
        type,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM transactions
      WHERE type IN ('device_check_fee','report_verification_fee','marketplace_commission','nin_verification_fee','device_recovery_fee')
      AND status = 'completed'
      GROUP BY type
    `);

    const totalRevenue = summary.reduce((sum, r) => sum + parseFloat(r.total_amount || 0), 0);

    const pendingInvoices = await Database.query(
      `SELECT COUNT(*) as count, SUM(amount) as total FROM payment_invoices WHERE status = 'pending'`
    );

    res.json({
      revenue_by_type: summary,
      total_revenue: totalRevenue,
      pending_invoices: { count: pendingInvoices[0]?.count || 0, total: pendingInvoices[0]?.total || 0 }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch revenue summary' });
  }
});

router.get('/invoices/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Database.selectOne('payment_invoices', '*', 'id = ?', [id]);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && invoice.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({
      data: {
        ...invoice,
        amount: parseFloat(invoice.amount),
        metadata: invoice.metadata ? JSON.parse(invoice.metadata) : null,
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

router.get('/payment-provider', requireAdmin, async (req, res) => {
  try {
    const provider = await RevenueService.getActivePaymentProvider();
    res.json({ provider, available: ['paystack', 'monify'] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch payment provider' });
  }
});

router.put('/payment-provider', requireAdmin, async (req, res) => {
  try {
    const { provider } = req.body;
    const result = await RevenueService.setActivePaymentProvider(provider, req.user.id);
    await Database.logAudit(req.user.id, 'PAYMENT_PROVIDER_UPDATED', 'system_settings', 'active_payment_provider',
      null, { provider: result }, req.ip);
    res.json({ success: true, provider: result });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to update payment provider' });
  }
});

// Fraud Detection Alerts
router.get('/fraud-alerts/stats', requireAdmin, async (req, res) => {
  try {
    const [totalRow] = await Database.query(`SELECT COUNT(*) as total FROM suspicious_activity_alerts`);
    const [newRow] = await Database.query(
      `SELECT COUNT(*) as pending_count FROM suspicious_activity_alerts WHERE status = 'pending'`
    );
    const [critRow] = await Database.query(
      `SELECT COUNT(*) as critical FROM suspicious_activity_alerts WHERE severity IN ('high','critical')`
    );
    const [resRow] = await Database.query(
      `SELECT COUNT(*) as resolved FROM suspicious_activity_alerts WHERE status IN ('resolved','false_positive')`
    );
    res.json({
      total: totalRow?.total || 0,
      new: newRow?.pending_count || 0,
      critical: critRow?.critical || 0,
      resolved: resRow?.resolved || 0
    });
  } catch (error) {
    console.error('Fraud alerts stats error:', error);
    res.status(500).json({ error: 'Failed to fetch fraud alert stats' });
  }
});

router.get('/fraud-alerts', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const alerts = await Database.query(`
      SELECT
        a.id,
        a.alert_type as monitor_name,
        a.severity,
        a.description,
        a.status,
        a.created_at as flagged_at,
        a.reviewed_at,
        a.reviewed_by,
        a.resolution_notes as notes,
        a.auto_generated,
        dc.query,
        dc.ip_address,
        dc.user_agent,
        dc.check_result,
        d.imei, d.serial, d.brand, d.model,
        u.name as user_name,
        u.email as user_email,
        u.id as user_id
      FROM suspicious_activity_alerts a
      LEFT JOIN device_checks dc ON a.device_check_id = dc.id
      LEFT JOIN devices d ON a.device_id = d.id
      LEFT JOIN users u ON d.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    const mapped = alerts.map(a => ({
      ...a,
      risk_score: a.severity === 'critical' ? 90 : a.severity === 'high' ? 70 : a.severity === 'medium' ? 45 : 20,
      details: {
        query: a.query,
        ip_address: a.ip_address,
        user_agent: a.user_agent,
        result: a.check_result,
        imei: a.imei,
        serial: a.serial,
        brand: a.brand,
        model: a.model
      },
      status: a.status === 'pending' ? 'new' : a.status === 'investigating' ? 'reviewing' : a.status === 'resolved' ? 'resolved' : 'dismissed'
    }));

    res.json({ alerts: mapped });
  } catch (error) {
    console.error('Fraud alerts list error:', error);
    res.status(500).json({ error: 'Failed to fetch fraud alerts' });
  }
});

router.put('/fraud-alerts/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const statusMap = { new: 'pending', reviewing: 'investigating', resolved: 'resolved', dismissed: 'false_positive' };
    const dbStatus = statusMap[status] || 'pending';

    await Database.update('suspicious_activity_alerts',
      { status: dbStatus, reviewed_by: req.user.id, reviewed_at: new Date() },
      'id = ?', [id]
    );

    await Database.logAudit(req.user.id, 'FRAUD_ALERT_UPDATED', 'suspicious_activity_alerts', id,
      null, { status }, req.ip);

    res.json({ success: true, id, status });
  } catch (error) {
    console.error('Fraud alert update error:', error);
    res.status(500).json({ error: 'Failed to update fraud alert' });
  }
});

module.exports = router;
