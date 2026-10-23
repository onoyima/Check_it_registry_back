const express = require('express');
const router = express.Router();
const Database = require('../config');
const PIIEncryptionService = require('../services/PIIEncryptionService');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Admin-only: lists accounts with contact details
router.get('/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { query, role, region } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    let sql = 'SELECT id, name, email, role, region, created_at FROM users WHERE 1=1';
    const params = [];

    if (query) {
      sql += ' AND (name LIKE ? OR email_hash = ?)';
      params.push(`%${query}%`, PIIEncryptionService.hashEmail(query));
    }
    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }
    if (region) {
      sql += ' AND region = ?';
      params.push(region);
    }

    const countResult = await Database.query(`SELECT COUNT(*) as total FROM (${sql}) c`, params);
    const total = countResult[0]?.total || 0;
    const offset = (page - 1) * limit;
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const users = await Database.query(sql, params);
    res.json({ success: true, users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
