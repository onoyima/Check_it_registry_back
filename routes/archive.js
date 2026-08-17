const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const Database = require('../config');
const ArchiveService = require('../services/ArchiveService');

const adminAuth = [authenticateToken, requireRole(['admin', 'super_admin'])];

// ═══════════════════════════════════════════════════════════════
// DELETED USERS
// ═══════════════════════════════════════════════════════════════

router.get('/deleted-users', ...adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const result = await ArchiveService.getDeletedUsers(parseInt(page), parseInt(limit), search);
    res.json(result);
  } catch (error) {
    console.error('Get deleted users error:', error);
    res.status(500).json({ error: 'Failed to fetch deleted users' });
  }
});

router.get('/deleted-users/:id', ...adminAuth, async (req, res) => {
  try {
    const detail = await ArchiveService.getDeletedAccountDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Archive record not found' });
    res.json(detail);
  } catch (error) {
    console.error('Get deleted user detail error:', error);
    res.status(500).json({ error: 'Failed to fetch deleted user detail' });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETED DEVICES
// ═══════════════════════════════════════════════════════════════

router.get('/deleted-devices', ...adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const result = await ArchiveService.getDeletedDevices(parseInt(page), parseInt(limit), search);
    res.json(result);
  } catch (error) {
    console.error('Get deleted devices error:', error);
    res.status(500).json({ error: 'Failed to fetch deleted devices' });
  }
});

router.get('/deleted-devices/:id', ...adminAuth, async (req, res) => {
  try {
    const detail = await ArchiveService.getDeletedDeviceDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Archive record not found' });
    res.json(detail);
  } catch (error) {
    console.error('Get deleted device detail error:', error);
    res.status(500).json({ error: 'Failed to fetch deleted device detail' });
  }
});

// ═══════════════════════════════════════════════════════════════
// RESTORE
// ═══════════════════════════════════════════════════════════════

router.post('/restore-user/:archiveId', ...adminAuth, async (req, res) => {
  try {
    const result = await ArchiveService.restoreUser(req.params.archiveId, req.user.id);
    res.json({ success: true, message: 'User restored successfully', ...result });
  } catch (error) {
    console.error('Restore user error:', error);
    res.status(400).json({ error: error.message || 'Failed to restore user' });
  }
});

router.post('/restore-device/:archiveId', ...adminAuth, async (req, res) => {
  try {
    const result = await ArchiveService.restoreDevice(req.params.archiveId, req.user.id);
    res.json({ success: true, message: 'Device restored successfully', ...result });
  } catch (error) {
    console.error('Restore device error:', error);
    res.status(400).json({ error: error.message || 'Failed to restore device' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN USER/BUSINESS/LEA DASHBOARD VIEWS
// ═══════════════════════════════════════════════════════════════

router.get('/user-view/:userId', ...adminAuth, async (req, res) => {
  try {
    const view = await ArchiveService.getUserAdminView(req.params.userId);
    if (!view) return res.status(404).json({ error: 'User not found' });
    res.json(view);
  } catch (error) {
    console.error('Admin user view error:', error);
    res.status(500).json({ error: 'Failed to load user view' });
  }
});

router.get('/business-view/:userId', ...adminAuth, async (req, res) => {
  try {
    const view = await ArchiveService.getBusinessAdminView(req.params.userId);
    if (!view) return res.status(404).json({ error: 'Business not found' });
    res.json(view);
  } catch (error) {
    console.error('Admin business view error:', error);
    res.status(500).json({ error: 'Failed to load business view' });
  }
});

router.get('/lea-view/:userId', ...adminAuth, async (req, res) => {
  try {
    const view = await ArchiveService.getLEAAdminView(req.params.userId);
    if (!view) return res.status(404).json({ error: 'LEA not found' });
    res.json(view);
  } catch (error) {
    console.error('Admin LEA view error:', error);
    res.status(500).json({ error: 'Failed to load LEA view' });
  }
});

// ═══════════════════════════════════════════════════════════════
// DEVICE LIFECYCLE
// ═══════════════════════════════════════════════════════════════

router.get('/device-lifecycle/:deviceId', ...adminAuth, async (req, res) => {
  try {
    const lifecycle = await ArchiveService.getDeviceLifecycle(req.params.deviceId);
    res.json(lifecycle);
  } catch (error) {
    console.error('Device lifecycle error:', error);
    res.status(500).json({ error: 'Failed to load device lifecycle' });
  }
});

// ═══════════════════════════════════════════════════════════════
// DATA EXPORT AUDIT
// ═══════════════════════════════════════════════════════════════

router.get('/export-audit', ...adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await ArchiveService.getExportAuditLogs(parseInt(page), parseInt(limit));
    res.json(result);
  } catch (error) {
    console.error('Export audit error:', error);
    res.status(500).json({ error: 'Failed to fetch export audit logs' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ARCHIVE SUMMARY STATS
// ═══════════════════════════════════════════════════════════════

router.get('/stats', ...adminAuth, async (req, res) => {
  try {
    const [{ deletedUsers }] = await Database.query('SELECT COUNT(*) as deletedUsers FROM users WHERE deleted_at IS NOT NULL');
    const [{ activeUsers }] = await Database.query('SELECT COUNT(*) as activeUsers FROM users WHERE deleted_at IS NULL');
    const [{ deletedDevices }] = await Database.query('SELECT COUNT(*) as deletedDevices FROM devices WHERE deleted_at IS NOT NULL');
    const [{ activeDevices }] = await Database.query('SELECT COUNT(*) as activeDevices FROM devices WHERE deleted_at IS NULL');
    const [{ recentExports }] = await Database.query('SELECT COUNT(*) as recentExports FROM data_export_audit WHERE requested_at > DATE_SUB(NOW(), INTERVAL 30 DAY)');
    const [{ totalExports }] = await Database.query('SELECT COUNT(*) as totalExports FROM data_export_audit');
    const [{ restoredUsers }] = await Database.query('SELECT COUNT(*) as restoredUsers FROM account_deletions WHERE status = \'restored\'');
    const [{ restoredDevices }] = await Database.query('SELECT COUNT(*) as restoredDevices FROM device_deletions WHERE status = \'restored\'');

    res.json({
      deletedUsers: deletedUsers, activeUsers: activeUsers,
      deletedDevices: deletedDevices, activeDevices: activeDevices,
      recentExports: recentExports, totalExports: totalExports,
      restoredUsers: restoredUsers, restoredDevices: restoredDevices,
    });
  } catch (error) {
    console.error('Archive stats error:', error);
    res.status(500).json({ error: 'Failed to fetch archive stats' });
  }
});

module.exports = router;
