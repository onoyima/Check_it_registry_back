const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const MarketplaceService = require('../services/MarketplaceService');
const Database = require('../config');

// Create a new listing
router.post('/', authenticateToken, async (req, res) => {
  try {
    const listing = await MarketplaceService.createListing(req.user.id, req.body);
    res.status(201).json(listing);
  } catch (error) {
    console.error('Create listing error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get all listings (public)
router.get('/', async (req, res) => {
  try {
    const listings = await MarketplaceService.getListings(req.query);
    res.json(listings);
  } catch (error) {
    console.error('Get listings error:', error);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

// Get seller stats
router.get('/seller/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await MarketplaceService.getSellerStats(req.user.id);
        res.json(stats);
    } catch (err) {
        console.error('Seller stats error:', err);
        res.status(500).json({ error: 'Failed to fetch seller stats' });
    }
});

// Get seller orders
router.get('/seller/orders', authenticateToken, async (req, res) => {
    try {
        const orders = await MarketplaceService.getSellerOrders(req.user.id);
        res.json(orders);
    } catch (err) {
        console.error('Seller orders error:', err);
        res.status(500).json({ error: 'Failed to fetch seller orders' });
    }
});

// Get a single listing (public)
router.get('/:id', async (req, res) => {
  try {
    const listing = await MarketplaceService.getListingById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    res.json(listing);
  } catch (error) {
    console.error('Get listing error:', error);
    res.status(500).json({ error: 'Failed to fetch listing' });
  }
});

// Update a listing (seller only)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const listing = await MarketplaceService.updateListing(req.user.id, req.params.id, req.body);
    res.json(listing);
  } catch (error) {
    console.error('Update listing error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete a listing (seller only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await MarketplaceService.deleteListing(req.user.id, req.params.id);
    res.json({ message: 'Listing deleted' });
  } catch (error) {
    console.error('Delete listing error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Purchase a listing
router.post('/:id/purchase', authenticateToken, async (req, res) => {
  try {
    const { paymentMethodId } = req.body;
    if (!paymentMethodId) return res.status(400).json({ error: 'Payment method is required' });
    
    const result = await MarketplaceService.purchaseListing(req.user.id, req.params.id, paymentMethodId);
    res.json(result);
  } catch (error) {
    console.error('Purchase listing error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Send message
router.post('/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });
    
    // For now, only Buyer -> Seller is supported by simple sendMessage
    // If we wanted to support reply, we'd need receiverId
    const message = await MarketplaceService.sendMessage(req.user.id, req.params.id, content);
    res.json(message);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get messages for a listing (thread)
router.get('/:id/messages', authenticateToken, async (req, res) => {
  try {
    // Returns messages between current user and the other party on this listing
    const messages = await MarketplaceService.getMessages(req.user.id, req.params.id);
    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ADMIN ROUTES
router.get('/admin/all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, search, limit, offset } = req.query;
    const listings = await MarketplaceService.adminGetAllListings({ status, search, limit, offset });
    res.json(listings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        await MarketplaceService.adminUpdateStatus(req.params.id, status);
        res.json({ success: true, status });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.put('/admin/:id/featured', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { featured } = req.body;
        await MarketplaceService.adminToggleFeatured(req.params.id, featured);
        res.json({ success: true, featured });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
