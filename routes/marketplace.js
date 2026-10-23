const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const MarketplaceService = require('../services/MarketplaceService');
const Database = require('../config');
const { getDisplayName, nameSelectColumns } = require('../utils/user-helpers');

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

// GET /api/marketplace/inbox - aggregate all messages for the current user across their listings
router.get('/inbox', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all threads/messages where user is sender or receiver
    const messages = await Database.query(`
      SELECT
        mm.id,
        mm.listing_id AS deviceId,
        ml.title AS deviceTitle,
        CASE
          WHEN mm.sender_id = ? THEN mm.receiver_id
          ELSE mm.sender_id
        END AS otherUserId,
        CASE
          WHEN mm.sender_id = ? THEN ru.name
          ELSE su.name
        END AS fromName,
        CASE
          WHEN mm.sender_id = ? THEN ru.first_name
          ELSE su.first_name
        END AS fromFirstName,
        CASE
          WHEN mm.sender_id = ? THEN ru.last_name
          ELSE su.last_name
        END AS fromLastName,
        CASE
          WHEN mm.sender_id = ? THEN ru.phone
          ELSE su.phone
        END AS fromContact,
        ml.title AS subject,
        mm.content AS message,
        CASE
          WHEN mm.sender_id = ? THEN 0
          WHEN mm.read_at IS NOT NULL THEN 0
          ELSE 1
        END AS isUnread,
        mm.created_at,
        CASE
          WHEN mm.sender_id = ? THEN 1
          ELSE 0
        END AS isFromMe
      FROM marketplace_messages mm
      LEFT JOIN marketplace_listings ml ON ml.id = mm.listing_id
      LEFT JOIN users su ON su.id = mm.sender_id
      LEFT JOIN users ru ON ru.id = mm.receiver_id
      WHERE mm.sender_id = ? OR mm.receiver_id = ?
      ORDER BY mm.created_at DESC
    `, [userId, userId, userId, userId, userId, userId, userId, userId, userId]);

    // Group by listing + other user to create conversation threads
    const threadMap = new Map();
    for (const msg of messages) {
      const key = `${msg.deviceId || 'none'}_${msg.otherUserId}`;
      if (!threadMap.has(key)) {
        threadMap.set(key, {
          id: msg.id,
          deviceId: msg.deviceId || null,
          deviceTitle: msg.deviceTitle || null,
          fromName: msg.fromFirstName || msg.fromLastName
            ? `${msg.fromFirstName || ''} ${msg.fromLastName || ''}`.trim()
            : (msg.fromName || 'Unknown'),
          fromContact: msg.fromContact || '',
          subject: msg.subject || msg.deviceTitle || 'No subject',
          message: msg.message,
          status: msg.isFromMe ? 'read' : (msg.isUnread ? 'unread' : 'read'),
          createdAt: msg.created_at,
          online: false,
          isFromMe: !!msg.isFromMe,
        });
      }
    }

    res.json({ data: Array.from(threadMap.values()) });
  } catch (error) {
    console.error('Get inbox error:', error);
    res.status(500).json({ error: 'Failed to load inbox' });
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

// Send message
// A shopper flags a listing (fraud, wrong details, already sold). It is
// recorded in the audit log, where the admin marketplace page can see it.
const FLAG_REASONS = ['fraud', 'wrong', 'sold', 'other'];
router.post('/:id/flag', authenticateToken, async (req, res) => {
  try {
    const reason = String(req.body?.reason || '');
    if (!FLAG_REASONS.includes(reason)) return res.status(400).json({ error: 'Choose a reason' });
    const listing = await Database.selectOne('marketplace_listings', 'id, seller_id', 'id = ?', [req.params.id]);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.seller_id === req.user.id) return res.status(400).json({ error: 'You cannot flag your own listing' });
    await Database.logAudit(req.user.id, 'LISTING_FLAGGED', 'marketplace_listings', listing.id, null,
      { reason, note: String(req.body?.note || '').slice(0, 500) }, req.ip);
    res.json({ success: true, message: 'Thanks — we will review this listing.' });
  } catch (error) {
    console.error('Flag listing error:', error);
    res.status(500).json({ error: 'Could not send the report' });
  }
});

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

