// File Upload Service - Handle file uploads with validation
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const Database = require('../config');

class FileUploadService {
  constructor() {
    // Create uploads directory if it doesn't exist
    this.uploadsDir = path.join(__dirname, '../uploads');
    this.ensureUploadsDir();

    // Configure multer to use memory storage so we can store blobs in DB
    this.storage = multer.memoryStorage();

    // File filter for validation
    this.fileFilter = (req, file, cb) => {
      const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,application/pdf').split(',');
      
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type ${file.mimetype} not allowed. Allowed types: ${allowedTypes.join(', ')}`), false);
      }
    };

    // Configure multer
    this.upload = multer({
      storage: this.storage,
      fileFilter: this.fileFilter,
      limits: {
        fileSize: parseInt(process.env.UPLOAD_MAX_SIZE) || 10 * 1024 * 1024, // 10MB default
        files: 5 // Max 5 files per request
      }
    });
  }

  // Ensure uploads directory exists
  async ensureUploadsDir() {
    try {
      await fs.access(this.uploadsDir);
    } catch (error) {
      await fs.mkdir(this.uploadsDir, { recursive: true });
    }
  }

  // Ensure subdirectory exists
  async ensureDir(dirPath) {
    try {
      await fs.access(dirPath);
    } catch (error) {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  // Get upload subdirectory based on file type
  getUploadSubdir(fieldname) {
    const subdirs = {
      'proof_document': 'proofs',
      'device_image': 'devices',
      'evidence': 'evidence',
      'handover_proof': 'transfers',
      'id_document': 'ids',
      'profile_image': 'profiles'
    };
    return subdirs[fieldname] || 'misc';
  }

  // Get multer middleware for specific fields
  getUploadMiddleware(fields) {
    if (Array.isArray(fields)) {
      return this.upload.fields(fields);
    } else if (typeof fields === 'string') {
      return this.upload.single(fields);
    } else {
      return this.upload.any();
    }
  }

  // Process uploaded files and store blobs in database when applicable
  async processUploadedFiles(files, userId, relatedId = null, relatedType = null) {
    const processedFiles = [];

    const fileArray = Array.isArray(files) ? files : [files];

    const baseUrl = process.env.BASE_URL || 'http://localhost:3006';

    for (const file of fileArray) {
      if (!file) continue;

      const validationErrors = this.validateFile(file);
      if (validationErrors.length) {
        throw new Error(validationErrors.join('; '));
      }

      const info = {
        id: Database.generateUUID(),
        original_name: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        fieldname: file.fieldname,
        uploaded_by: userId,
        related_id: relatedId,
        related_type: relatedType,
        created_at: new Date()
      };

      let publicUrl = null;

      // Store into devices table when appropriate
      if (relatedType === 'device_image' && relatedId) {
        await Database.update(
          'devices',
          {
            device_image_blob: file.buffer,
            device_image_mime: file.mimetype,
            device_image_filename: file.originalname,
            device_image_url: `${baseUrl}/api/files/view/device-image/${relatedId}`
          },
          'id = ?',
          [relatedId]
        );
        publicUrl = `${baseUrl}/api/files/view/device-image/${relatedId}`;
      } else if (relatedType === 'device_proof' && relatedId) {
        await Database.update(
          'devices',
          {
            proof_blob: file.buffer,
            proof_mime: file.mimetype,
            proof_filename: file.originalname,
            proof_url: `${baseUrl}/api/files/view/proof/${relatedId}`
          },
          'id = ?',
          [relatedId]
        );
        publicUrl = `${baseUrl}/api/files/view/proof/${relatedId}`;
      }

      processedFiles.push({
        ...info,
        public_url: publicUrl
      });
    }

    return processedFiles;
  }

  // Deprecated URL helpers retained for compatibility (not used with blobs)
  getFileUrl(filename, fieldname) {
    const subdir = this.getUploadSubdir(fieldname);
    return `/uploads/${subdir}/${filename}`;
  }

  getPublicUrl(filename, fieldname) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3006';
    return `${baseUrl}/api/files/view/${this.getUploadSubdir(fieldname)}/${filename}`;
  }

  // Validate file before upload
  validateFile(file) {
    const errors = [];

    // Check file size
    const maxSize = parseInt(process.env.UPLOAD_MAX_SIZE) || 10 * 1024 * 1024;
    if (file.size > maxSize) {
      errors.push(`File size exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB`);
    }

    // Check file type
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,application/pdf').split(',');
    if (!allowedTypes.includes(file.mimetype)) {
      errors.push(`File type ${file.mimetype} not allowed`);
    }

    // Check filename
    if (file.originalname.length > 255) {
      errors.push('Filename too long');
    }

    return errors;
  }

  // Delete uploaded file
  async deleteFile(filename, fieldname) {
    try {
      const subdir = this.getUploadSubdir(fieldname);
      const filePath = path.join(this.uploadsDir, subdir, filename);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  }

  // Clean up old files (background job)
  async cleanupOldFiles(daysOld = 30) {
    try {
      const cutoffDate = new Date(Date.now() - (daysOld * 24 * 60 * 60 * 1000));
      let deletedCount = 0;

      // Get all subdirectories
      const subdirs = ['proofs', 'devices', 'evidence', 'transfers', 'ids', 'misc'];

      for (const subdir of subdirs) {
        const subdirPath = path.join(this.uploadsDir, subdir);
        
        try {
          const files = await fs.readdir(subdirPath);
          
          for (const file of files) {
            const filePath = path.join(subdirPath, file);
            const stats = await fs.stat(filePath);
            
            if (stats.mtime < cutoffDate) {
              await fs.unlink(filePath);
              deletedCount++;
            }
          }
        } catch (error) {
          // Subdirectory might not exist, continue
          continue;
        }
      }

      return { deleted: deletedCount };
    } catch (error) {
      console.error('Error cleaning up files:', error);
      throw error;
    }
  }

  // Get file statistics
  async getFileStats() {
    try {
      const stats = {
        total_files: 0,
        total_size: 0,
        by_type: {}
      };

      const subdirs = ['proofs', 'devices', 'evidence', 'transfers', 'ids', 'misc'];

      for (const subdir of subdirs) {
        const subdirPath = path.join(this.uploadsDir, subdir);
        
        try {
          const files = await fs.readdir(subdirPath);
          stats.by_type[subdir] = { count: 0, size: 0 };
          
          for (const file of files) {
            const filePath = path.join(subdirPath, file);
            const fileStats = await fs.stat(filePath);
            
            stats.total_files++;
            stats.total_size += fileStats.size;
            stats.by_type[subdir].count++;
            stats.by_type[subdir].size += fileStats.size;
          }
        } catch (error) {
          stats.by_type[subdir] = { count: 0, size: 0 };
        }
      }

      return stats;
    } catch (error) {
      console.error('Error getting file stats:', error);
      throw error;
    }
  }
}

module.exports = new FileUploadService();