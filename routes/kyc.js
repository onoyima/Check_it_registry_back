const express = require('express');
const router = express.Router();
const KYCService = require('../services/KYCService');
const Database = require('../config');
const FileUploadService = require('../services/FileUploadService');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const { authenticateToken } = require('../middleware/auth');
const { userRateLimit } = require('../middleware/userRateLimit');

// NIN lookups cost money and return personal data: 5 per account per day.
const ninLookupLimit = userRateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 5, message: 'Too many NIN lookups today. Please try again tomorrow.' });

// POST /api/kyc/lookup - Step 1: Lookup NIN
// Only returns the record when it belongs to the person asking (the NIN's
// names must match this account's name), so it can't be used to look up
// strangers' personal data.
router.post('/lookup', authenticateToken, ninLookupLimit, async (req, res) => {
  try {
    const { nin } = req.body;
    if (!nin) return res.status(400).json({ error: 'NIN is required' });

    const details = await KYCService.lookupNIN(nin);
    const me = await Database.selectOne('users', 'name, first_name, middle_name, last_name', 'id = ?', [req.user.id]);
    if (!me || !KYCService.namesMatch(details, me)) {
      await Database.logAudit(req.user.id, 'NIN_LOOKUP_NAME_MISMATCH', 'users', req.user.id, null, null, req.ip).catch(() => {});
      return res.status(400).json({ error: 'This NIN does not match the name on your account. Update your profile name to match your NIN, or contact support.' });
    }
    res.json({ success: true, details });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/kyc/verify - Submit KYC
router.post('/verify', authenticateToken, async (req, res) => {
  try {
    const contentType = req.headers['content-type'] || '';

    if (contentType.startsWith('multipart/')) {
      // File upload path (web frontend with selfie)
      const upload = FileUploadService.getUploadMiddleware('selfie_image');

      upload(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });

        const { nin } = req.body;
        if (!nin) return res.status(400).json({ error: 'NIN is required' });
        if (!req.file) return res.status(400).json({ error: 'Live selfie is required' });

        try {
          const result = await FileUploadService.processSingleFile(
            req.file.buffer, req.file.originalname, req.file.mimetype, 'selfie_image', req.user.id
          );

          const filePath = path.join(__dirname, '..', result.url);
          const serviceResult = await KYCService.initiateVerification(req.user.id, nin, filePath);
          res.json(serviceResult);
        } catch (serviceError) {
          console.error(serviceError);
          res.status(400).json({ error: serviceError.message });
        }
      });
    } else {
      // JSON path (mobile without file)
      const { nin } = req.body;
      if (!nin) return res.status(400).json({ error: 'NIN is required' });

      const serviceResult = await KYCService.initiateVerification(req.user.id, nin, null);
      res.json(serviceResult);
    }
  } catch (error) {
    console.error('KYC Route Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/kyc/status - Get Status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const status = await KYCService.getVerificationStatus(req.user.id);
    const user = await Database.selectOne('users', 'kyc_status, is_verified, caution_flag', 'id = ?', [req.user.id]);
    
    res.json({
      kyc_status: user.kyc_status,
      is_verified: user.is_verified,
      caution_flag: user.caution_flag,
      last_verification: status
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

module.exports = router;
