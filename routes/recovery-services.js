// Recovery Services Routes - Payment-based device recovery
const express = require('express');
const Database = require('../config');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/recovery-services/packages - Get available recovery packages
router.get('/packages', async (req, res) => {
  try {
    const PaymentRecoveryService = require('../services/PaymentRecoveryService');
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
    const { deviceId, servicePackage, paymentMethod } = req.body;

    if (!deviceId || !servicePackage) {
      return res.status(400).json({ 
        error: 'Device ID and service package are required' 
      });
    }

    const PaymentRecoveryService = require('../services/PaymentRecoveryService');
    
    const result = await PaymentRecoveryService.createRecoveryService({
      deviceId,
      userId: req.user.id,
      servicePackage,
      paymentMethod
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

    const PaymentRecoveryService = require('../services/PaymentRecoveryService');
    
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
    const PaymentRecoveryService = require('../services/PaymentRecoveryService');
    
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

    const PaymentRecoveryService = require('../services/PaymentRecoveryService');
    
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