// Recovery Services Routes - Payment-based device recovery
const express = require('express');
const Database = require('../config');
const { authenticateToken } = require('../middleware/auth');
const PaymentRecoveryService = require('../services/PaymentRecoveryService');
const RevenueService = require('../services/RevenueService');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/recovery-services/packages - Get available recovery packages
router.get('/packages', async (req, res) => {
  try {
    const packages = PaymentRecoveryService.getRecoveryPackages();
    
    res.json({ packages });
  } catch (error) {
    console.error('Get packages error:', error);
    res.status(500).json({ error: 'Failed to fetch recovery packages' });
  }
});

// POST /api/recovery-services/create - Create recovery service
router.post('/create', async (req, res) => {
  try {
    const { deviceId, servicePackage, paymentMethod, bypass_payment, mfaToken } = req.body;

    if (!deviceId || !servicePackage) {
      return res.status(400).json({ 
        error: 'Device ID and service package are required' 
      });
    }

    // Best-effort MFA token validation (present = recently MFA-verified)
    if (mfaToken) {
      try {
        const payload = JSON.parse(Buffer.from(mfaToken.split('.')[1], 'base64').toString());
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          return res.status(403).json({ error: 'MFA token expired. Please re-verify.', requiresMfa: true });
        }
        if (payload.userId && payload.userId !== req.user.id) {
          return res.status(403).json({ error: 'Invalid MFA token', requiresMfa: true });
        }
      } catch (e) {
        return res.status(403).json({ error: 'Invalid MFA token', requiresMfa: true });
      }
    }

    // === FEE DETERMINATION ===
    const fee = await RevenueService.getFee('device_recovery_fee');
    let paid = false;

    if (fee > 0 && !bypass_payment) {
      // Return payment-required response so the frontend opens PaymentGate
      const reference = `RECOVERY-${req.user.id.slice(0, 8)}-${Date.now()}`;
      const invoiceId = await RevenueService.createPaymentInvoice(
        req.user.id, fee, 'device_recovery_fee', reference, { deviceId, servicePackage }
      );
      return res.status(402).json({
        requiresPayment: true,
        invoiceId,
        reference,
        amount: fee,
        currency: 'NGN',
        feeType: 'device_recovery_fee',
        purpose: 'Device Recovery Service',
        message: 'Payment is required to activate recovery service'
      });
    }

    if (fee > 0 && bypass_payment) {
      // Validate the invoice belongs to this user and is still pending
      const invoice = await Database.selectOne(
        'payment_invoices', 'id, reference, status', 'user_id = ? AND (id = ? OR reference = ?)',
        [req.user.id, bypass_payment, bypass_payment]
      );
      if (!invoice || invoice.status === 'completed') {
        return res.status(400).json({ error: 'Invalid or already-used payment reference' });
      }
      await Database.update('payment_invoices',
        { status: 'completed', paid_at: new Date() }, 'id = ?', [invoice.id]);

      // Record revenue transaction so the revenue dashboard reflects the fee
      const txnId = Database.generateUUID();
      await Database.insert('transactions', {
        id: txnId,
        user_id: req.user.id,
        type: 'device_recovery_fee',
        amount: fee,
        status: 'completed',
        reference: bypass_payment,
        description: 'Device recovery service fee',
        created_at: new Date()
      });

      paid = true;
    }

    const result = await PaymentRecoveryService.createRecoveryService({
      deviceId,
      userId: req.user.id,
      servicePackage,
      paymentMethod: paid ? 'invoice' : (paymentMethod || 'stripe'),
      paid,
      paymentReference: bypass_payment || null
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json(result);

  } catch (error) {
    console.error('Create recovery service error:', error);
    res.status(500).json({ error: 'Failed to create recovery service' });
  }
});

// POST /api/recovery-services/payment-webhook - Payment completion webhook
router.post('/payment-webhook', async (req, res) => {
  try {
    const { paymentIntentId, status } = req.body;

    if (!paymentIntentId || !status) {
      return res.status(400).json({ error: 'Payment intent ID and status are required' });
    }

    const result = await PaymentRecoveryService.processPaymentCompletion(paymentIntentId, status);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);

  } catch (error) {
    console.error('Payment webhook error:', error);
    res.status(500).json({ error: 'Failed to process payment webhook' });
  }
});

// GET /api/recovery-services/my-services - Get user's recovery services
router.get('/my-services', async (req, res) => {
  try {
    const services = await PaymentRecoveryService.getUserRecoveryServices(req.user.id);

    res.json({ services });

  } catch (error) {
    console.error('Get recovery services error:', error);
    res.status(500).json({ error: 'Failed to fetch recovery services' });
  }
});

// PUT /api/recovery-services/:id/status - Update recovery status (for agents)
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Check if user is an agent or admin
    if (req.user.role !== 'admin') {
      // Check if user is assigned agent
      const service = await Database.selectOne(
        'recovery_services',
        'assigned_agent_id',
        'id = ?',
        [id]
      );

      if (!service) {
        return res.status(404).json({ error: 'Recovery service not found' });
      }

      // For now, allow any authenticated user to update (in production, implement proper agent authentication)
    }

    const result = await PaymentRecoveryService.updateRecoveryStatus(
      id, 
      status, 
      notes, 
      req.user.id
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);

  } catch (error) {
    console.error('Update recovery status error:', error);
    res.status(500).json({ error: 'Failed to update recovery status' });
  }
});

// GET /api/recovery-services/admin/all - List recovery services (admin)
router.get('/admin/all', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { status, packageType, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;

    const conditions = [];
    const params = [];
    if (status) { conditions.push('rs.status = ?'); params.push(status); }
    if (packageType) { conditions.push('rs.service_package = ?'); params.push(packageType); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [{ total }] = await Database.query(
      `SELECT COUNT(*) as total FROM recovery_services rs ${where}`, params
    );

    const services = await Database.query(`
      SELECT
        rs.*,
        d.brand,
        d.model,
        u.name as user_name,
        u.email as user_email
      FROM recovery_services rs
      JOIN devices d ON rs.device_id = d.id
      JOIN users u ON rs.user_id = u.id
      ${where}
      ORDER BY rs.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limitNum, (pageNum - 1) * limitNum]);

    res.json({
      services,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: total || 0,
        pages: Math.max(1, Math.ceil((total || 0) / limitNum))
      }
    });
  } catch (error) {
    console.error('Get recovery services (admin) error:', error);
    res.status(500).json({ error: 'Failed to fetch recovery services' });
  }
});

// GET /api/recovery-services/admin/stats - Recovery stats (admin)
router.get('/admin/stats', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const [{ total_services }] = await Database.query(
      `SELECT COUNT(*) as total_services FROM recovery_services`
    );

    const services_by_package = await Database.query(
      `SELECT service_package, COUNT(*) as count
       FROM recovery_services
       GROUP BY service_package`
    );

    const revenue_by_package = await Database.query(
      `SELECT service_package, SUM(amount_paid) as total_revenue, COUNT(*) as service_count
       FROM recovery_services
       WHERE payment_status = 'paid'
       GROUP BY service_package`
    );

    const [{ recovered_ct }] = await Database.query(
      `SELECT COUNT(*) as recovered_ct FROM recovery_services WHERE status = 'completed'`
    );
    const [{ paid_ct }] = await Database.query(
      `SELECT COUNT(*) as paid_ct FROM recovery_services WHERE payment_status = 'paid'`
    );

    const monthly_revenue = await Database.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') as month,
              SUM(amount_paid) as revenue, COUNT(*) as services
       FROM recovery_services
       WHERE payment_status = 'paid'
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month ASC`
    );

    res.json({
      total_services: total_services || 0,
      services_by_package,
      revenue_by_package: revenue_by_package.map(r => ({
        service_package: r.service_package,
        total_revenue: parseFloat(r.total_revenue || 0),
        service_count: r.service_count
      })),
      success_rate: {
        recovered: recovered_ct || 0,
        completed: paid_ct || 0,
        success_rate: paid_ct ? parseFloat(((recovered_ct || 0) / paid_ct).toFixed(4)) : 0
      },
      monthly_revenue
    });
  } catch (error) {
    console.error('Get recovery stats (admin) error:', error);
    res.status(500).json({ error: 'Failed to fetch recovery stats' });
  }
});

// POST /api/recovery-services/:id/refund - Refund a recovery service (admin)
router.post('/:id/refund', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;
    const { reason = 'Admin refund', partialAmount } = req.body;

    const service = await Database.selectOne('recovery_services', '*', 'id = ?', [id]);
    if (!service) {
      return res.status(404).json({ error: 'Recovery service not found' });
    }

    const refundAmount = partialAmount != null ? parseFloat(partialAmount) : parseFloat(service.amount_paid || 0);

    await Database.update('recovery_services', {
      status: 'refunded',
      payment_status: 'refunded',
      updated_at: new Date()
    }, 'id = ?', [id]);

    await Database.logAudit(
      req.user.id,
      'RECOVERY_SERVICE_REFUNDED',
      'recovery_services',
      id,
      { status: service.status, payment_status: service.payment_status },
      { reason, refundAmount },
      req.ip
    );

    res.json({ success: true, refundAmount, serviceId: id });
  } catch (error) {
    console.error('Refund recovery service error:', error);
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

// GET /api/recovery-services/agent/cases - Get agent's assigned cases (for agents)
router.get('/agent/cases', async (req, res) => {
  try {
    // In production, implement proper agent authentication
    const agentId = req.user.id; // Temporary - should be actual agent ID

    const cases = await Database.query(`
      SELECT 
        rs.*,
        d.brand,
        d.model,
        d.category,
        d.imei,
        d.serial,
        u.name as client_name,
        u.email as client_email,
        u.phone as client_phone
      FROM recovery_services rs
      JOIN devices d ON rs.device_id = d.id
      JOIN users u ON rs.user_id = u.id
      WHERE rs.assigned_agent_id = ?
      AND rs.status IN ('active', 'investigating', 'leads_found')
      ORDER BY rs.created_at DESC
    `, [agentId]);

    res.json({ cases });

  } catch (error) {
    console.error('Get agent cases error:', error);
    res.status(500).json({ error: 'Failed to fetch agent cases' });
  }
});

module.exports = router;