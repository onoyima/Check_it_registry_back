const express = require('express');
const router = express.Router();
const Database = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.get('/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { query, role, region, verified, active, sort_by = 'created_at', sort_order = 'DESC', limit = 20, page = 1 } = req.query;
    let sql = 'SELECT u.*, COUNT(DISTINCT d.id) as device_count, COUNT(DISTINCT r.id) as report_count FROM users u LEFT JOIN devices d ON d.user_id = u.id LEFT JOIN reports r ON r.device_id IN (SELECT id FROM devices WHERE user_id = u.id) WHERE 1=1';
    const params = [];
    const joins = [];

    if (query) {
      sql += ' AND (u.name LIKE ? OR u.email LIKE ?)';
      params.push(`%${query}%`, `%${query}%`);
    }
    if (role) {
      const roles = Array.isArray(role) ? role : [role];
      sql += ` AND u.role IN (${roles.map(() => '?').join(',')})`;
      params.push(...roles);
    }
    if (region) {
      sql += ' AND u.region = ?';
      params.push(region);
    }
    if (verified === 'true') {
      sql += ' AND u.verified_at IS NOT NULL';
    } else if (verified === 'false') {
      sql += ' AND u.verified_at IS NULL';
    }

    sql += ' GROUP BY u.id';
    const validSortFields = ['created_at', 'name', 'email', 'role', 'region'];
    const sortField = validSortFields.includes(sort_by) ? `u.${sort_by}` : 'u.created_at';
    const sortDir = ['ASC', 'DESC'].includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'DESC';
    sql += ` ORDER BY ${sortField} ${sortDir}`;

    const countSql = `SELECT COUNT(*) as total FROM (${sql}) c`;
    const countResult = await Database.query(countSql, params);
    const total = countResult[0]?.total || 0;
    const offset = (page - 1) * limit;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const users = await Database.query(sql, params);
    res.json({ success: true, users, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Advanced search error:', error);
    res.status(500).json({ error: 'Advanced search failed' });
  }
});

router.get('/reports', authenticateToken, requireRole(['admin', 'lea']), async (req, res) => {
  try {
    const { query, status, report_type, region, case_id, sort_by = 'created_at', sort_order = 'DESC', limit = 20, page = 1 } = req.query;
    let sql = 'SELECT r.*, u.name as reporter_name, u.email as reporter_email, d.brand, d.model, d.imei, lea.agency_name FROM reports r LEFT JOIN users u ON u.id = r.reporter_id LEFT JOIN devices d ON d.id = r.device_id LEFT JOIN law_enforcement_agencies lea ON lea.id = r.assigned_lea_id WHERE 1=1';
    const params = [];

    if (query) {
      sql += ' AND (r.case_id LIKE ? OR d.brand LIKE ? OR d.model LIKE ? OR d.imei LIKE ?)';
      params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      sql += ` AND r.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
    if (report_type) {
      sql += ' AND r.report_type = ?';
      params.push(report_type);
    }

    const countResult = await Database.query(`SELECT COUNT(*) as total FROM (${sql}) c`, params);
    const total = countResult[0]?.total || 0;
    const offset = (page - 1) * limit;
    sql += ` ORDER BY r.${sort_by} ${sort_order === 'DESC' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const reports = await Database.query(sql, params);
    res.json({ success: true, reports, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Report search error:', error);
    res.status(500).json({ error: 'Report search failed' });
  }
});

router.get('/devices', authenticateToken, requireRole(['admin', 'lea']), async (req, res) => {
  try {
    const { query, status, brand, model, region, has_reports, sort_by = 'created_at', sort_order = 'DESC', limit = 20, page = 1 } = req.query;
    let sql = 'SELECT d.*, u.name as owner_name, u.email as owner_email, u.region as owner_region FROM devices d LEFT JOIN users u ON u.id = d.user_id WHERE 1=1';
    const params = [];

    if (query) {
      sql += ' AND (d.imei LIKE ? OR d.serial LIKE ? OR d.brand LIKE ? OR d.model LIKE ?)';
      params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (status) {
      sql += ' AND d.status = ?';
      params.push(status);
    }
    if (brand) {
      sql += ' AND d.brand = ?';
      params.push(brand);
    }

    const countResult = await Database.query(`SELECT COUNT(*) as total FROM (${sql}) c`, params);
    const total = countResult[0]?.total || 0;
    const offset = (page - 1) * limit;
    sql += ` ORDER BY d.${sort_by} ${sort_order === 'DESC' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const devices = await Database.query(sql, params);
    res.json({ success: true, devices, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Device search error:', error);
    res.status(500).json({ error: 'Device search failed' });
  }
});

module.exports = router;
