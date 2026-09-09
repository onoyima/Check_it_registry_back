const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const Database = require('../config');
const PIIEncryptionService = require('../services/PIIEncryptionService');

// POST /api/admin/pii/encrypt-all - Migrate all user PII to encrypted
router.post('/encrypt-all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await PIIEncryptionService.migrateAllUsers();
    res.json({
      success: true,
      message: `PII encryption complete: ${result.migrated} encrypted, ${result.skipped} skipped`,
      ...result,
    });
  } catch (error) {
    console.error('PII migration error:', error);
    res.status(500).json({ error: 'PII encryption failed' });
  }
});

// POST /api/admin/pii/encrypt/:userId - Encrypt a specific user's PII
router.post('/encrypt/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await PIIEncryptionService.encryptUserPII(req.params.userId);
    if (!result) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('PII encrypt user error:', error);
    res.status(500).json({ error: 'Failed to encrypt user PII' });
  }
});

// GET /api/admin/pii/decrypt/:userId - Decrypt a user's PII (admin only, audit-logged)
router.get('/decrypt/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await PIIEncryptionService.decryptUserPII(req.params.userId);
    if (!result) {
      return res.status(404).json({ error: 'User not found' });
    }

    await Database.logAudit(
      req.user.id, 'PII_DECRYPTED', 'users', req.params.userId,
      null, { fields: Object.keys(result).filter(k => k !== 'id') }, req.ip
    );

    res.json({ data: result });
  } catch (error) {
    console.error('PII decrypt user error:', error);
    res.status(500).json({ error: 'Failed to decrypt user PII' });
  }
});

module.exports = router;
