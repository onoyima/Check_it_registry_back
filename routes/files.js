// File serving and upload routes
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { authenticateToken, requireRole, loadUserForToken } = require('../middleware/auth');
const FileUploadService = require('../services/FileUploadService');
const Database = require('../config');
const fsStream = require('fs');

const router = express.Router();

// Serve device image - tries disk first, falls back to legacy BLOB
router.get('/view/device-image/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const row = await Database.selectOne(
      'devices',
      'device_image_blob, device_image_mime, device_image_filename, device_image_url',
      'id = ?',
      [deviceId]
    );

    if (!row) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // If stored on disk (new method), redirect to static URL
    if (row.device_image_url && row.device_image_url.startsWith('/uploads/')) {
      return res.redirect(row.device_image_url);
    }

    // Legacy: serve from BLOB
    if (!row.device_image_blob) {
      return res.status(404).json({ error: 'Device image not found' });
    }

    const mime = row.device_image_mime || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=604800');
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

// Serve proof document - serves from disk directly (requires auth, no redirect to bypass)
router.get('/view/proof/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const row = await Database.selectOne(
      'devices',
      'user_id, proof_blob, proof_mime, proof_filename, proof_url',
      'id = ?',
      [deviceId]
    );

    if (!row) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Only the device owner, admins and police may see an ownership proof
    if (row.user_id !== req.user.id && !['admin', 'super_admin', 'lea'].includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this document' });
    }

    // If stored on disk (new method), serve the file directly (no redirect — preserves auth)
    if (row.proof_url && row.proof_url.startsWith('/uploads/')) {
      const parts = row.proof_url.replace('/uploads/', '').split('/');
      const filePath = parts.length === 2 ? FileUploadService.safeResolve(parts[0], parts[1]) : null;
      if (!filePath) {
        return res.status(404).json({ error: 'Proof document not found' });
      }
      try {
        await fs.access(filePath);
        const stats = await fs.stat(filePath);
        const ext = path.extname(row.proof_filename || row.proof_url).toLowerCase();
        const mime = row.proof_mime || (ext === '.pdf' ? 'application/pdf' : 'application/octet-stream');
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        if (mime.startsWith('image/')) {
          res.setHeader('Content-Disposition', 'inline');
        } else {
          res.setHeader('Content-Disposition', `attachment; filename="${row.proof_filename || 'proof-document'}"`);
        }
        fsStream.createReadStream(filePath).pipe(res);
        return;
      } catch (err) {
        return res.status(404).json({ error: 'Proof document not found on disk' });
      }
    }

    // Legacy: serve from BLOB
    if (!row.proof_blob) {
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
// Private folders (proofs, evidence, ids, kyc, transfers) are served only to
// the uploader, the owner of the related device/report, admins and police.
router.get('/view/:subdir/:filename', async (req, res) => {
  try {
    const { subdir, filename } = req.params;

    // Resolve safely: rejects unknown folders and any path traversal
    const filePath = FileUploadService.safeResolve(subdir, filename);
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({ error: 'File not found' });
    }

    const isPrivate = FileUploadService.constructor.PRIVATE_SUBDIRS.includes(subdir);
    if (isPrivate) {
      // Token from the Authorization header (preferred) or ?token= for <img> tags
      const raw = (req.headers.authorization && req.headers.authorization.split(' ')[1]) || req.query.token;
      if (!raw) {
        return res.status(401).json({ error: 'Authentication required for this file' });
      }
      let decoded;
      try {
        decoded = Database.verifyJWT(raw);
      } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      const { user, error: authError, status: authStatus } = await loadUserForToken(decoded);
      if (authError) {
        return res.status(authStatus).json({ error: authError });
      }
      if (!(await FileUploadService.canAccess(user, subdir, filename))) {
        return res.status(403).json({ error: 'You do not have access to this file' });
      }
    }

    const stats = await fs.stat(filePath);
    const ext = path.extname(filename).toLowerCase();
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

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', isPrivate ? 'private, max-age=600' : 'public, max-age=604800');
    if (contentType.startsWith('image/')) {
      res.setHeader('Content-Disposition', 'inline');
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    fsStream.createReadStream(filePath).pipe(res);
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
      // Only attach the proof to an item the uploader owns
      let deviceId = null;
      if (req.body.device_id) {
        const owned = await Database.selectOne('devices', 'id', 'id = ? AND user_id = ?', [req.body.device_id, req.user.id]);
        if (!owned) return res.status(404).json({ error: 'Device not found' });
        deviceId = owned.id;
      }
      const processedFiles = await FileUploadService.processUploadedFiles(
        req.file,
        req.user.id,
        deviceId,
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
      let deviceId = null;
      if (req.body.device_id) {
        const owned = await Database.selectOne('devices', 'id', 'id = ? AND user_id = ?', [req.body.device_id, req.user.id]);
        if (!owned) return res.status(404).json({ error: 'Device not found' });
        deviceId = owned.id;
      }
      const processedFiles = await FileUploadService.processUploadedFiles(
        req.file,
        req.user.id,
        deviceId,
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

    if (!FileUploadService.safeResolve(subdir, filename)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Only the uploader (or an admin) may delete a file
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    if (!isAdmin) {
      const owner = await Database.queryOne('SELECT user_id FROM file_owners WHERE file_key = ?', [`${subdir}/${filename}`]);
      if (!owner || owner.user_id !== req.user.id) {
        return res.status(403).json({ error: 'You can only delete files you uploaded' });
      }
    }

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

// Get disk usage for uploads (admin only)
router.get('/disk-usage', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const usage = await FileUploadService.getDiskUsage();
    res.json(usage);
  } catch (error) {
    console.error('Disk usage error:', error);
    res.status(500).json({ error: 'Failed to get disk usage' });
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
