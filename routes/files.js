// File serving and upload routes
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { authenticateToken, requireRole } = require('../middleware/auth');
const FileUploadService = require('../services/FileUploadService');

const router = express.Router();

// Serve device image stored as blob
router.get('/view/device-image/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const Database = require('../config');
    const row = await Database.selectOne(
      'devices',
      'device_image_blob, device_image_mime, device_image_filename',
      'id = ?',
      [deviceId]
    );

    if (!row || !row.device_image_blob) {
      return res.status(404).json({ error: 'Device image not found' });
    }

    const mime = row.device_image_mime || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // Inline for images
    if (mime.startsWith('image/')) {
      res.setHeader('Content-Disposition', 'inline');
    } else {
      const fname = row.device_image_filename || 'device-image';
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    }

    res.send(Buffer.from(row.device_image_blob));
  } catch (error) {
    console.error('Blob serve error (device image):', error);
    res.status(500).json({ error: 'Failed to serve device image' });
  }
});

// Serve proof document stored as blob (requires auth)
router.get('/view/proof/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const Database = require('../config');
    const row = await Database.selectOne(
      'devices',
      'proof_blob, proof_mime, proof_filename',
      'id = ?',
      [deviceId]
    );

    if (!row || !row.proof_blob) {
      return res.status(404).json({ error: 'Proof document not found' });
    }

    const mime = row.proof_mime || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (mime.startsWith('image/')) {
      res.setHeader('Content-Disposition', 'inline');
    } else {
      const fname = row.proof_filename || 'proof-document';
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    }

    res.send(Buffer.from(row.proof_blob));
  } catch (error) {
    console.error('Blob serve error (proof):', error);
    res.status(500).json({ error: 'Failed to serve proof document' });
  }
});

// Serve uploaded files (with access control)
router.get('/view/:subdir/:filename', async (req, res) => {
  try {
    const { subdir, filename } = req.params;
    const { token } = req.query; // Optional token for authenticated access

    // Validate subdirectory
    const allowedSubdirs = ['proofs', 'devices', 'evidence', 'transfers', 'ids', 'misc'];
    if (!allowedSubdirs.includes(subdir)) {
      return res.status(400).json({ error: 'Invalid subdirectory' });
    }

    // Build file path
    const uploadsDir = path.join(__dirname, '../uploads');
    const filePath = path.join(uploadsDir, subdir, filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({ error: 'File not found' });
    }

    // For sensitive files, require authentication
    const sensitiveSubdirs = ['proofs', 'evidence', 'ids'];
    if (sensitiveSubdirs.includes(subdir)) {
      // Check for authentication
      let user = null;
      
      if (token) {
        try {
          const Database = require('../config');
          user = Database.verifyJWT(token);
        } catch (error) {
          return res.status(401).json({ error: 'Invalid token' });
        }
      } else if (req.headers.authorization) {
        try {
          const authToken = req.headers.authorization.split(' ')[1];
          const Database = require('../config');
          user = Database.verifyJWT(authToken);
        } catch (error) {
          return res.status(401).json({ error: 'Invalid authorization' });
        }
      }

      if (!user) {
        return res.status(401).json({ error: 'Authentication required for this file' });
      }

      // Additional access control can be added here based on user role and file ownership
    }

    // Get file stats for headers
    const stats = await fs.stat(filePath);
    const ext = path.extname(filename).toLowerCase();

    // Set appropriate content type
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };

    const contentType = contentTypes[ext] || 'application/octet-stream';

    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour

    // For images, allow inline display; for documents, suggest download
    if (contentType.startsWith('image/')) {
      res.setHeader('Content-Disposition', 'inline');
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    // Stream the file
    const fileStream = require('fs').createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('File serve error:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// Upload proof document
router.post('/upload/proof', authenticateToken, (req, res) => {
  const upload = FileUploadService.getUploadMiddleware('proof_document');
  
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const processedFiles = await FileUploadService.processUploadedFiles(
        req.file,
        req.user.id,
        req.body.device_id,
        'device_proof'
      );

      res.json({
        success: true,
        message: 'Proof document uploaded successfully',
        file: processedFiles[0]
      });

    } catch (error) {
      console.error('Proof upload error:', error);
      res.status(500).json({ error: 'Failed to process uploaded file' });
    }
  });
});

// Upload device image
router.post('/upload/device-image', authenticateToken, (req, res) => {
  const upload = FileUploadService.getUploadMiddleware('device_image');
  
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const processedFiles = await FileUploadService.processUploadedFiles(
        req.file,
        req.user.id,
        req.body.device_id,
        'device_image'
      );

      res.json({
        success: true,
        message: 'Device image uploaded successfully',
        file: processedFiles[0]
      });

    } catch (error) {
      console.error('Device image upload error:', error);
      res.status(500).json({ error: 'Failed to process uploaded file' });
    }
  });
});

// Upload evidence file
router.post('/upload/evidence', authenticateToken, (req, res) => {
  const upload = FileUploadService.getUploadMiddleware('evidence');
  
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const processedFiles = await FileUploadService.processUploadedFiles(
        req.file,
        req.user.id,
        req.body.report_id,
        'report_evidence'
      );

      res.json({
        success: true,
        message: 'Evidence file uploaded successfully',
        file: processedFiles[0]
      });

    } catch (error) {
      console.error('Evidence upload error:', error);
      res.status(500).json({ error: 'Failed to process uploaded file' });
    }
  });
});

// Upload handover proof for transfers
router.post('/upload/handover-proof', authenticateToken, (req, res) => {
  const upload = FileUploadService.getUploadMiddleware('handover_proof');
  
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const processedFiles = await FileUploadService.processUploadedFiles(
        req.file,
        req.user.id,
        req.body.transfer_id,
        'transfer_proof'
      );

      res.json({
        success: true,
        message: 'Handover proof uploaded successfully',
        file: processedFiles[0]
      });

    } catch (error) {
      console.error('Handover proof upload error:', error);
      res.status(500).json({ error: 'Failed to process uploaded file' });
    }
  });
});

// Multiple file upload
router.post('/upload/multiple', authenticateToken, (req, res) => {
  const upload = FileUploadService.getUploadMiddleware([
    { name: 'proof_document', maxCount: 1 },
    { name: 'device_image', maxCount: 3 },
    { name: 'evidence', maxCount: 5 }
  ]);
  
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    try {
      const allProcessedFiles = {};

      for (const [fieldname, files] of Object.entries(req.files)) {
        const processedFiles = await FileUploadService.processUploadedFiles(
          files,
          req.user.id,
          req.body.related_id,
          req.body.related_type
        );
        allProcessedFiles[fieldname] = processedFiles;
      }

      res.json({
        success: true,
        message: 'Files uploaded successfully',
        files: allProcessedFiles
      });

    } catch (error) {
      console.error('Multiple upload error:', error);
      res.status(500).json({ error: 'Failed to process uploaded files' });
    }
  });
});

// Delete uploaded file
router.delete('/:subdir/:filename', authenticateToken, async (req, res) => {
  try {
    const { subdir, filename } = req.params;

    // Validate subdirectory
    const allowedSubdirs = ['proofs', 'devices', 'evidence', 'transfers', 'ids', 'misc'];
    if (!allowedSubdirs.includes(subdir)) {
      return res.status(400).json({ error: 'Invalid subdirectory' });
    }

    // Additional authorization checks can be added here
    // For now, users can only delete their own files (implement based on your needs)

    const success = await FileUploadService.deleteFile(filename, subdir);

    if (success) {
      res.json({
        success: true,
        message: 'File deleted successfully'
      });
    } else {
      res.status(404).json({ error: 'File not found or could not be deleted' });
    }

  } catch (error) {
    console.error('File delete error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Get file upload statistics (admin only)
router.get('/stats', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const stats = await FileUploadService.getFileStats();
    res.json(stats);
  } catch (error) {
    console.error('File stats error:', error);
    res.status(500).json({ error: 'Failed to get file statistics' });
  }
});

// Cleanup old files (admin only)
router.post('/cleanup', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { days_old = 30 } = req.body;
    const result = await FileUploadService.cleanupOldFiles(days_old);
    
    res.json({
      success: true,
      message: `Cleaned up ${result.deleted} old files`,
      deleted_count: result.deleted
    });
  } catch (error) {
    console.error('File cleanup error:', error);
    res.status(500).json({ error: 'Failed to cleanup old files' });
  }
});

module.exports = router;