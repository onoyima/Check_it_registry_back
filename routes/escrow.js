const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const EscrowService = require('../services/EscrowService');

// GET /api/escrow/buyer-orders — buyer's purchase history with escrow status
router.get('/buyer-orders', authenticateToken, async (req, res) => {
  try {
    const orders = await EscrowService.getBuyerOrders(req.user.id);
    res.json({ data: orders });
  } catch (error) {
    console.error('Buyer orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/escrow/seller-orders — seller's sales with escrow status
router.get('/seller-orders', authenticateToken, async (req, res) => {
  try {
    const orders = await EscrowService.getSellerOrders(req.user.id);
    res.json({ data: orders });
  } catch (error) {
    console.error('Seller orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/escrow/status/:listingId — escrow status for a specific listing
router.get('/status/:listingId', authenticateToken, async (req, res) => {
  try {
    const escrow = await EscrowService.getEscrowStatus(req.params.listingId, req.user.id);
    if (!escrow) return res.status(404).json({ error: 'No escrow found for this listing' });
    res.json(escrow);
  } catch (error) {
    console.error('Escrow status error:', error);
    res.status(500).json({ error: 'Failed to fetch escrow status' });
  }
});

// PUT /api/escrow/:escrowId/confirm-delivery — buyer confirms delivery
router.put('/:escrowId/confirm-delivery', authenticateToken, async (req, res) => {
  try {
    const result = await EscrowService.confirmDelivery(req.params.escrowId, req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Confirm delivery error:', error);
    res.status(400).json({ error: error.message });
  }
});

// POST /api/escrow/:escrowId/dispute — buyer disputes delivery
router.post('/:escrowId/dispute', authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Dispute reason is required' });
    const result = await EscrowService.disputeDelivery(req.params.escrowId, req.user.id, reason);
    res.json(result);
  } catch (error) {
    console.error('Dispute error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ADMIN: GET /api/escrow/admin/settings — get platform fee settings
router.get('/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const settings = await EscrowService.getPlatformFeeSettings();
    res.json(settings);
  } catch (error) {
    console.error('Get fee settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ADMIN: PUT /api/escrow/admin/settings — update platform fee percent
router.put('/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { platform_fee_percent } = req.body;
    if (platform_fee_percent === undefined) return res.status(400).json({ error: 'platform_fee_percent is required' });
    const result = await EscrowService.updatePlatformFeePercent(req.user.id, platform_fee_percent);
    res.json(result);
  } catch (error) {
    console.error('Update fee settings error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ADMIN: GET /api/escrow/admin/transactions — list all escrows (filterable)
router.get('/admin/transactions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const escrows = await EscrowService.getAdminEscrows(req.query);
    res.json({ data: escrows });
  } catch (error) {
    console.error('Admin escrows error:', error);
    res.status(500).json({ error: 'Failed to fetch escrow transactions' });
  }
});

// ADMIN: POST /api/escrow/admin/resolve/:escrowId — resolve a dispute
router.post('/admin/resolve/:escrowId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { action, admin_notes } = req.body;
    if (!action || !['release', 'refund'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "release" or "refund"' });
    }
    const result = await EscrowService.adminResolveDispute(req.params.escrowId, req.user.id, action, admin_notes || '');
    res.json(result);
  } catch (error) {
    console.error('Resolve dispute error:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
