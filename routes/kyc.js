const express = require('express');
const router = express.Router();
const KYCService = require('../services/KYCService');
const Database = require('../config');
const FileUploadService = require('../services/FileUploadService');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

// Middleware to authenticate JWT tokens
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });
    const decoded = Database.verifyJWT(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// POST /api/kyc/lookup - Step 1: Lookup NIN
router.post('/lookup', authenticateToken, async (req, res) => {
  try {
    const { nin } = req.body;
    if (!nin) return res.status(400).json({ error: 'NIN is required' });

    const details = await KYCService.lookupNIN(nin);
    res.json({ success: true, details });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/kyc/verify - Submit KYC
router.post('/verify', authenticateToken, async (req, res) => {
  try {
    // Handle file upload
    const upload = FileUploadService.getUploadMiddleware('selfie_image');
    
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      
      const { nin } = req.body;
      if (!nin) return res.status(400).json({ error: 'NIN is required' });
      if (!req.file) return res.status(400).json({ error: 'Live selfie is required' });

      try {
        // Process and save selfie to disk with image optimization
        const FileUploadService = require('../services/FileUploadService');
        const result = await FileUploadService.processSingleFile(
          req.file.buffer, req.file.originalname, req.file.mimetype, 'selfie_image', req.user.id
        );

        const selfieUrl = result.url;
        const filePath = path.join(__dirname, '..', result.url);

        // Pass the absolute path to service for processing
        const serviceResult = await KYCService.initiateVerification(req.user.id, nin, filePath);
        res.json(serviceResult);
      } catch (serviceError) {
        console.error(serviceError);
        res.status(400).json({ error: serviceError.message });
      }
    });

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
