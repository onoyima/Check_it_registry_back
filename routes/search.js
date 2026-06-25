const express = require('express');
const router = express.Router();
const Database = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.get('/users', authenticateToken, async (req, res) => {
  try {
    const { query, role, region, limit = 20, page = 1 } = req.query;
    let sql = 'SELECT id, name, email, role, region, created_at FROM users WHERE 1=1';
    const params = [];

    if (query) {
      sql += ' AND (name LIKE ? OR email LIKE ?)';
      params.push(`%${query}%`, `%${query}%`);
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
    params.push(parseInt(limit), offset);

    const users = await Database.query(sql, params);
    res.json({ success: true, users, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
