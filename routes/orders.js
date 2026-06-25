const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const Database = require('../config');

router.get('/buyer', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const sql = `
      SELECT t.id, l.title as listing_title, l.price as listing_price,
             t.status, t.created_at, u.name as seller_name,
             d.brand as device_brand, d.model as device_model
      FROM transactions t
      JOIN marketplace_listings l ON t.related_entity_id = l.id
      JOIN devices d ON l.device_id = d.id
      JOIN users u ON l.seller_id = u.id
      WHERE t.user_id = ? AND t.type = 'marketplace_purchase'
      ORDER BY t.created_at DESC
    `;
    const rows = await Database.query(sql, [userId]);
    res.json({ data: rows });
  } catch (error) {
    console.error('Get buyer orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

module.exports = router;
