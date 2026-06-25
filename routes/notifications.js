const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const Database = require('../config');

const TYPE_MAP = {
  transfer_request_sent: 'transfer',
  transfer_received: 'transfer',
  transfer_completed: 'transfer',
  transfer_cancelled: 'transfer',
  device_verified: 'verification',
  device_reported: 'alert',
  report_resolved: 'report',
  report_update: 'report',
  suspicious_activity: 'alert',
  system_alert: 'system',
};

router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const sql = `
      SELECT id, user_id, subject, message, payload, is_read, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await Database.query(sql, [userId, parseInt(limit), parseInt(offset)]);

    const map = rows.map(r => {
      let payload = {};
      try { payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload || {}); } catch {}
      const rawType = payload.type || 'system';
      return {
        id: r.id,
        type: TYPE_MAP[rawType] || 'system',
        title: r.subject || 'Notification',
        message: r.message || '',
        read: r.is_read === 1 || r.is_read === true,
        link: payload.action_url || payload.link || null,
        created_at: r.created_at,
      };
    });

    res.json({ data: map, total: map.length });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    await Database.query(
      'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND (is_read = 0 OR is_read IS NULL)',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    const result = await Database.query(
      'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await Database.query(
      'DELETE FROM notifications WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

module.exports = router;
