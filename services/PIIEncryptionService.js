// PII Encryption Service - encrypts sensitive user data at rest
// Uses AES-256-CBC with the KYC_ENCRYPTION_KEY

const crypto = require('crypto');

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.KYC_ENCRYPTION_KEY;
const IV_LENGTH = 16;

// Fields that should be encrypted in the users table.
// NOTE: 'name' fields are intentionally left plaintext (phase 1) so admin
// name-search keeps working. Emails/phones are the high-breach-risk contact
// identifiers and are encrypted; lookups use deterministic email_hash/phone_hash.
const PII_FIELDS = ['email', 'phone'];

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

  // Deterministic lookup flavours. Encrypting the real value means plaintext
  // comparisons in SQL no longer work, so identity lookups (login, dedupe,
  // transfers...) resolve through these hashes instead.
  static hashEmail(email) {
    if (!email) return null;
    return crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex');
  }

  static hashPhone(phone) {
    if (!phone) return null;
    return crypto.createHash('sha256').update(String(phone).trim()).digest('hex');
  }

  // Takes a users/account_deletions insert/update payload. Encrypts plaintext
  // contact fields (never double-encrypts) and attaches the matching lookup
  // hashes, so callers can pass normal plaintext values and get a DB-safe object
  // back. `original_email` is the deleted-account email on the users table so
  // admin restore works without leaving plaintext PII at rest.
  // In NODE_ENV=test the values are kept plaintext (the test DB is ephemeral and
  // tests manipulate rows directly) but hashes are still written so the
  // hash-based identity lookups behave the same as in production.
  static encryptContactFields(data) {
    const out = { ...data };
    const shouldEncrypt = process.env.NODE_ENV !== 'test';
    for (const field of ['email', 'phone', 'original_email']) {
      const value = out[field];
      if (typeof value === 'string' && value.length > 0 && !this.isEncrypted(value)) {
        if (field === 'email') out.email_hash = this.hashEmail(value);
        if (field === 'phone') out.phone_hash = this.hashPhone(value);
        if (field === 'original_email') out.original_email_hash = this.hashEmail(value);
        if (shouldEncrypt) out[field] = this.encrypt(value);
      } else if (value == null) {
        if (field === 'email' && 'email_hash' in out === false) out.email_hash = null;
        if (field === 'phone' && 'phone_hash' in out === false) out.phone_hash = null;
        if (field === 'original_email' && 'original_email_hash' in out === false) out.original_email_hash = null;
      }
    }
    return out;
  }

  // Strips sensitive fields from a row before it is persisted inside a JSON
  // snapshot. The users/device snapshots kept for archiving are never read back
  // (restore re-creates rows from dedicated columns), so the email/phone/NIN/etc.
  // they used to mirror must not linger as plaintext inside JSON blobs.
  static redactSnapshot(value) {
    if (Array.isArray(value)) return value.map((v) => this.redactSnapshot(v));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, val] of Object.entries(value)) {
        if (/email|phone|nin|bvn|password|otp|token/i.test(key)) {
          out[key] = null;
          continue;
        }
        out[key] = this.redactSnapshot(val);
      }
      return out;
    }
    return value;
  }

  // Decrypts email/phone fields on a users row returned from a raw query, in place.
  static decryptUserRow(row) {
    if (!row || typeof row !== 'object') return row;
    for (const field of PII_FIELDS) {
      if (typeof row[field] === 'string' && this.isEncrypted(row[field])) {
        row[field] = this.decrypt(row[field]);
      }
    }
    return row;
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
