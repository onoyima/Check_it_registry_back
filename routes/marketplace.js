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

// Debug: direct SQL count
router.get('/debug-listing-count', async (req, res) => {
  try {
    const allActive = await Database.query("SELECT COUNT(*) as cnt FROM marketplace_listings WHERE status = 'active'");
    const joined = await Database.query(`SELECT l.*, d.brand, d.model, d.category, u.name as seller_name, u.kyc_status as seller_verified FROM marketplace_listings l JOIN devices d ON l.device_id = d.id JOIN users u ON l.seller_id = u.id WHERE 1=1 AND l.status = 'active' ORDER BY l.created_at DESC LIMIT 20 OFFSET 0`);
    const countOnly = await Database.query(`SELECT COUNT(*) as cnt FROM marketplace_listings l JOIN devices d ON l.device_id = d.id JOIN users u ON l.seller_id = u.id WHERE l.status = 'active'`);
    res.json({
      rawCount: allActive[0]?.cnt || 0,
      joinedCount: countOnly[0]?.cnt || 0,
      returnedCount: joined.length,
      sampleTitle: joined[0]?.title || 'none',
      dbName: process.env.DB_NAME
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// Get all listings (public)
router.get('/', async (req, res) => {
    console.log('GET /marketplace - query:', JSON.stringify(req.query));
    console.log('GET /marketplace - url:', req.originalUrl);
    try {
      const listings = await MarketplaceService.getListings(req.query);
      console.log('GET /marketplace - result count:', listings.length);
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

// Bulk initiate purchase (cart checkout - Step 1)
router.post('/bulk-initiate-purchase', authenticateToken, async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items provided' });
    const result = await MarketplaceService.bulkInitiatePurchase(req.user.id, items);
    res.json(result);
  } catch (error) {
    console.error('Bulk initiate purchase error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Bulk complete purchase (cart checkout - Step 2)
router.post('/bulk-complete-purchase', authenticateToken, async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'Payment reference is required' });
    const result = await MarketplaceService.bulkCompletePurchase(reference);
    res.json(result);
  } catch (error) {
    console.error('Bulk complete purchase error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Initiate purchase (Step 1): create pending tx + get Paystack auth URL
router.post('/:id/initiate-purchase', authenticateToken, async (req, res) => {
  try {
    const result = await MarketplaceService.initiatePurchase(req.user.id, req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Initiate purchase error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Complete purchase (Step 2): verify Paystack payment + hold escrow
router.post('/complete-purchase', authenticateToken, async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'Payment reference is required' });
    const result = await MarketplaceService.completePurchase(reference);
    res.json(result);
  } catch (error) {
    console.error('Complete purchase error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Purchase a listing (legacy — simulated payment, no Paystack required)
router.post('/:id/purchase', authenticateToken, async (req, res) => {
  try {
    const { paymentMethodId } = req.body;
    const result = await MarketplaceService.purchaseListing(req.user.id, req.params.id, paymentMethodId || 'manual');
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

