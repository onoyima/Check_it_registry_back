// PII Encryption Service - encrypts sensitive user data at rest
// Uses AES-256-CBC with the KYC_ENCRYPTION_KEY

const crypto = require('crypto');

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.KYC_ENCRYPTION_KEY;
const IV_LENGTH = 16;

// Fields that should be encrypted in the users table
const PII_FIELDS = ['email', 'phone', 'name'];

class PIIEncryptionService {
  static _key = null;

  static getKey() {
    if (!this._key) {
      if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
        throw new Error('KYC_ENCRYPTION_KEY is required for PII encryption (min 32 chars)');
      }
      this._key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
    }
    return this._key;
  }

  static encrypt(plaintext) {
    if (!plaintext) return plaintext;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.getKey(), iv);
    let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  }

  static decrypt(ciphertext) {
    if (!ciphertext) return ciphertext;
    const parts = ciphertext.split(':');
    if (parts.length !== 2) return null; // Not encrypted or wrong format
    try {
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.getKey(), iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('PII decryption failed:', error.message);
      return null;
    }
  }

  static isEncrypted(value) {
    if (!value || typeof value !== 'string') return false;
    const parts = value.split(':');
    return parts.length === 2 && /^[0-9a-f]{32}$/.test(parts[0]) && /^[0-9a-f]+$/.test(parts[1]);
  }

  static async encryptUserPII(userId) {
    const Database = require('../config');
    const user = await Database.selectOne('users', 'id, email, phone, name', 'id = ?', [userId]);
    if (!user) return null;

    const updates = {};
    for (const field of PII_FIELDS) {
      if (user[field] && !this.isEncrypted(user[field])) {
        updates[field] = this.encrypt(user[field]);
      }
    }

    if (Object.keys(updates).length > 0) {
      await Database.update('users', { ...updates, updated_at: new Date() }, 'id = ?', [userId]);
    }

    return { encrypted: Object.keys(updates), userId };
  }

  static async decryptUserPII(userId) {
    const Database = require('../config');
    const user = await Database.selectOne('users', 'id, email, phone, name', 'id = ?', [userId]);
    if (!user) return null;

    const decrypted = { id: userId };
    for (const field of PII_FIELDS) {
      if (user[field]) {
        decrypted[field] = this.isEncrypted(user[field]) ? this.decrypt(user[field]) : user[field];
      }
    }

    return decrypted;
  }

  static async migrateAllUsers() {
    const Database = require('../config');
    const users = await Database.query('SELECT id FROM users');
    let migrated = 0;
    let skipped = 0;

    for (const user of users) {
      try {
        const result = await this.encryptUserPII(user.id);
        if (result && result.encrypted.length > 0) {
          migrated++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`Failed to encrypt PII for user ${user.id}:`, error.message);
        skipped++;
      }
    }

    return { migrated, skipped, total: users.length };
  }
}

module.exports = PIIEncryptionService;
