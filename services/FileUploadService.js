// File Upload Service - Disk storage with image processing
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const crypto = require('crypto');
const Database = require('../config');

// Image size presets (max width in pixels)
const IMAGE_SIZES = {
  profile: { width: 400, height: 400, fit: 'cover' },
  device_image: { width: 1200, height: 900, fit: 'inside' },
  proof_document: { width: 1600, height: 1200, fit: 'inside' },
  evidence: { width: 1600, height: 1200, fit: 'inside' },
  handover_proof: { width: 1600, height: 1200, fit: 'inside' },
  selfie_image: { width: 600, height: 600, fit: 'cover' }
};

// JPEG quality levels
const JPEG_QUALITY = 82;
const PNG_COMPRESSION = 8;

class FileUploadService {
  constructor() {
    this.uploadsDir = path.join(__dirname, '../uploads');
    this.ensureUploadsDir();

    // Use memory storage so we can process images before writing to disk
    this.storage = multer.memoryStorage();

    this.fileFilter = (req, file, cb) => {
      const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,application/pdf').split(',');
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type ${file.mimetype} not allowed. Allowed types: ${allowedTypes.join(', ')}`), false);
      }
    };

    this.upload = multer({
      storage: this.storage,
      fileFilter: this.fileFilter,
      limits: {
        fileSize: parseInt(process.env.UPLOAD_MAX_SIZE) || 10 * 1024 * 1024,
        files: 5
      }
    });
  }

  async ensureUploadsDir() {
    try {
      await fs.access(this.uploadsDir);
    } catch (error) {
      await fs.mkdir(this.uploadsDir, { recursive: true });
    }
  }

  async ensureDir(dirPath) {
    try {
      await fs.access(dirPath);
    } catch (error) {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  getUploadSubdir(fieldname) {
    const subdirs = {
      'proof_document': 'proofs',
      // Private documents: these used to fall through to the PUBLIC "misc"
      // folder, where anyone with the link could open them.
      'device_proof': 'proofs',
      'report_evidence': 'evidence',
      'transfer_proof': 'transfers',
      'device_image': 'devices',
      'evidence': 'evidence',
      'handover_proof': 'transfers',
      'id_document': 'ids',
      'profile_image': 'profiles',
      'selfie_image': 'kyc'
    };
    return subdirs[fieldname] || 'misc';
  }

  getUploadMiddleware(fields) {
    if (Array.isArray(fields)) {
      return this.upload.fields(fields);
    } else if (typeof fields === 'string') {
      return this.upload.single(fields);
    } else {
      return this.upload.any();
    }
  }

  // Process image buffer with sharp - resize and compress
  async processImage(buffer, mimetype, fieldname) {
    const isImage = mimetype.startsWith('image/');
    if (!isImage) return { buffer, mimetype, format: null };

    const sizePreset = IMAGE_SIZES[fieldname] || IMAGE_SIZES.device_image;
    let pipeline = sharp(buffer).resize({
      width: sizePreset.width,
      height: sizePreset.height,
      fit: sizePreset.fit,
      withoutEnlargement: true
    });

    // Convert to optimized format
    if (mimetype === 'image/png') {
      pipeline = pipeline.png({ compressionLevel: PNG_COMPRESSION });
    } else if (mimetype === 'image/gif') {
      // Keep GIF as-is for animation support
      return { buffer, mimetype, format: 'gif' };
    } else {
      // JPEG for everything else (jpg, webp, etc.)
      pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
      mimetype = 'image/jpeg';
    }

    const processed = await pipeline.toBuffer();
    return { buffer: processed, mimetype, format: mimetype.split('/')[1] };
  }

  // Generate unique filename
  generateFilename(originalname, ext) {
    const uniqueId = crypto.randomBytes(12).toString('hex');
    const timestamp = Date.now();
    return `${timestamp}-${uniqueId}${ext}`;
  }

  // Save buffer to disk and return the URL path
  async saveToDisk(buffer, subdir, filename, ownerId = null) {
    const dirPath = path.join(this.uploadsDir, subdir);
    await this.ensureDir(dirPath);
    const filePath = this.safeResolve(subdir, filename);
    if (!filePath) throw new Error('Invalid file name');
    await fs.writeFile(filePath, buffer);
    if (ownerId) await this.recordOwner(subdir, filename, ownerId);
    return `/uploads/${subdir}/${filename}`;
  }

  // Known upload folders. Anything else is rejected.
  static get SUBDIRS() {
    return ['proofs', 'devices', 'evidence', 'transfers', 'ids', 'misc', 'profiles', 'kyc'];
  }

  // Folders whose files are private to the uploader (plus admins / police).
  static get PRIVATE_SUBDIRS() {
    return ['proofs', 'evidence', 'ids', 'kyc', 'transfers'];
  }

  // Resolve a file inside an upload folder, refusing path traversal
  // ("../", encoded slashes, absolute paths, hidden files). Returns null if unsafe.
  safeResolve(subdir, filename) {
    if (!FileUploadService.SUBDIRS.includes(subdir)) return null;
    if (typeof filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(filename)) return null;
    const base = path.resolve(this.uploadsDir, subdir);
    const full = path.resolve(base, filename);
    if (!full.startsWith(base + path.sep)) return null;
    return full;
  }

  // Remember who uploaded a file so private files can be served only to them.
  async recordOwner(subdir, filename, ownerId) {
    try {
      await Database.query(
        'INSERT IGNORE INTO file_owners (file_key, user_id, created_at) VALUES (?, ?, NOW())',
        [`${subdir}/${filename}`, ownerId]
      );
    } catch (e) {
      console.warn('Could not record file owner:', e.message);
    }
  }

  // Can this user read this file? Admins and police can read private files;
  // everyone else only files they uploaded or that belong to their own
  // device / report.
  async canAccess(user, subdir, filename) {
    if (!FileUploadService.PRIVATE_SUBDIRS.includes(subdir)) return true;
    if (!user) return false;
    if (['admin', 'super_admin', 'lea'].includes(user.role)) return true;
    const key = `${subdir}/${filename}`;
    const url = `/uploads/${key}`;
    try {
      const owner = await Database.queryOne('SELECT user_id FROM file_owners WHERE file_key = ?', [key]);
      if (owner) return owner.user_id === user.id;
      const dev = await Database.queryOne(
        'SELECT id FROM devices WHERE user_id = ? AND (proof_url = ? OR device_image_url = ?) LIMIT 1',
        [user.id, url, url]
      );
      if (dev) return true;
      const rep = await Database.queryOne(
        'SELECT id FROM reports WHERE reporter_id = ? AND evidence_url LIKE ? LIMIT 1',
        [user.id, `%${key}%`]
      );
      return !!rep;
    } catch (e) {
      console.warn('File access check failed:', e.message);
      return false;
    }
  }

  // Process uploaded files - save to disk with image optimization
  async processUploadedFiles(files, userId, relatedId = null, relatedType = null) {
    const processedFiles = [];
    const fileArray = Array.isArray(files) ? files : [files];
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

    for (const file of fileArray) {
      if (!file) continue;

      const validationErrors = this.validateFile(file);
      if (validationErrors.length) {
        throw new Error(validationErrors.join('; '));
      }

      // Determine the upload category from relatedType or fieldname
      const uploadCategory = relatedType || file.fieldname;
      const subdir = this.getUploadSubdir(uploadCategory);
      const ext = path.extname(file.originalname).toLowerCase();

      // Process image (resize + compress) or keep as-is for PDFs
      const { buffer: finalBuffer, mimetype: finalMime } = await this.processImage(
        file.buffer, file.mimetype, uploadCategory
      );

      // Generate filename and save to disk
      const savedExt = finalMime === 'image/jpeg' ? '.jpg' :
                       finalMime === 'image/png' ? '.png' :
                       finalMime === 'image/gif' ? '.gif' : ext;
      const filename = this.generateFilename(file.originalname, savedExt);
      const imageUrl = await this.saveToDisk(finalBuffer, subdir, filename, userId);

      const publicUrl = `${baseUrl}${imageUrl}`;

      // Store path reference in database (not BLOB)
      if (relatedType === 'device_image' && relatedId) {
        await Database.update(
          'devices',
          {
            device_image_blob: null,
            device_image_mime: finalMime,
            device_image_filename: filename,
            device_image_url: imageUrl
          },
          'id = ?',
          [relatedId]
        );
      } else if (relatedType === 'device_proof' && relatedId) {
        await Database.update(
          'devices',
          {
            proof_blob: null,
            proof_mime: finalMime,
            proof_filename: filename,
            proof_url: imageUrl
          },
          'id = ?',
          [relatedId]
        );
      }

      processedFiles.push({
        id: Database.generateUUID(),
        original_name: file.originalname,
        saved_name: filename,
        size: finalBuffer.length,
        original_size: file.size,
        mimetype: finalMime,
        fieldname: file.fieldname,
        uploaded_by: userId,
        related_id: relatedId,
        related_type: relatedType,
        url: imageUrl,
        public_url: publicUrl,
        created_at: new Date()
      });
    }

    return processedFiles;
  }

  // Process and save a single file (used by profile upload, KYC, etc.)
  async processSingleFile(fileBuffer, originalname, mimetype, fieldname, userId) {
    // Validate file type and size
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,application/pdf').split(',');
    if (!allowedTypes.includes(mimetype)) {
      throw new Error(`File type ${mimetype} not allowed`);
    }
    const maxSize = parseInt(process.env.UPLOAD_MAX_SIZE) || 10 * 1024 * 1024;
    if (fileBuffer.length > maxSize) {
      throw new Error(`File size exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB`);
    }

    const subdir = this.getUploadSubdir(fieldname);
    const ext = path.extname(originalname).toLowerCase();

    const { buffer: finalBuffer, mimetype: finalMime } = await this.processImage(
      fileBuffer, mimetype, fieldname
    );

    const savedExt = finalMime === 'image/jpeg' ? '.jpg' :
                     finalMime === 'image/png' ? '.png' :
                     finalMime === 'image/gif' ? '.gif' : ext;
    const filename = this.generateFilename(originalname, savedExt);
    const imageUrl = await this.saveToDisk(finalBuffer, subdir, filename, userId);

    return {
      filename,
      url: imageUrl,
      mimetype: finalMime,
      size: finalBuffer.length
    };
  }

  getFileUrl(filename, fieldname) {
    const subdir = this.getUploadSubdir(fieldname);
    return `/uploads/${subdir}/${filename}`;
  }

  getPublicUrl(filename, fieldname) {
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    return `${baseUrl}/uploads/${this.getUploadSubdir(fieldname)}/${filename}`;
  }

  validateFile(file) {
    const errors = [];
    const maxSize = parseInt(process.env.UPLOAD_MAX_SIZE) || 10 * 1024 * 1024;
    if (file.size > maxSize) {
      errors.push(`File size exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB`);
    }
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,application/pdf').split(',');
    if (!allowedTypes.includes(file.mimetype)) {
      errors.push(`File type ${file.mimetype} not allowed`);
    }
    if (file.originalname.length > 255) {
      errors.push('Filename too long');
    }
    return errors;
  }

  async deleteFile(filename, subdirOrFieldname) {
    try {
      const subdir = FileUploadService.SUBDIRS.includes(subdirOrFieldname)
        ? subdirOrFieldname
        : this.getUploadSubdir(subdirOrFieldname);
      const filePath = this.safeResolve(subdir, filename);
      if (!filePath) return false;
      await fs.unlink(filePath);
      await Database.query('DELETE FROM file_owners WHERE file_key = ?', [`${subdir}/${filename}`]).catch(() => {});
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  }

  async deleteByUrl(url) {
    try {
      if (!url || !url.startsWith('/uploads/')) return false;
      const parts = url.replace('/uploads/', '').split('/');
      if (parts.length !== 2) return false;
      const filePath = this.safeResolve(parts[0], parts[1]);
      if (!filePath) return false;
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  async cleanupOldFiles(daysOld = 30) {
    try {
      const cutoffDate = new Date(Date.now() - (daysOld * 24 * 60 * 60 * 1000));
      let deletedCount = 0;
      const subdirs = ['proofs', 'devices', 'evidence', 'transfers', 'ids', 'misc', 'profiles', 'kyc'];

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
          continue;
        }
      }
      return { deleted: deletedCount };
    } catch (error) {
      console.error('Error cleaning up files:', error);
      throw error;
    }
  }

  async getFileStats() {
    try {
      const stats = { total_files: 0, total_size: 0, by_type: {} };
      const subdirs = ['proofs', 'devices', 'evidence', 'transfers', 'ids', 'misc', 'profiles', 'kyc'];

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

  // Get disk usage in bytes
  async getDiskUsage() {
    const stats = await this.getFileStats();
    return {
      total_bytes: stats.total_size,
      total_mb: Math.round(stats.total_size / 1024 / 1024 * 100) / 100,
      total_files: stats.total_files,
      by_type: stats.by_type
    };
  }
}

module.exports = new FileUploadService();
