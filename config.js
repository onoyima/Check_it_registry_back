// MySQL Database Configuration

require('dotenv').config();
const mysql = require('mysql2/promise');
const PIIEncryptionService = require('./services/PIIEncryptionService');

const isTest = process.env.NODE_ENV === 'test';

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: isTest
    ? (process.env.TEST_DB_NAME || 'check_it_registry_test')
    : (process.env.DB_NAME || 'check_it_registry'),
  charset: 'utf8mb4',
  timezone: '+00:00',
  connectionLimit: parseInt(process.env.DB_POOL_SIZE) || 20,
  queueLimit: 0,
  waitForConnections: true,
  connectTimeout: 10000,
  idleTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

// Create connection pool
let pool;
try {
  if (!isTest) {
    console.log('Database pool created for:', dbConfig.database);
  }
  pool = mysql.createPool(dbConfig);
} catch (error) {
  console.error('Database connection failed:', error.message);
}

// Column/table names can't be sent as SQL parameters, so every identifier
// that reaches insert()/update() is checked and quoted. This stops a request
// body key such as "status = 'verified', brand" from being written into SQL.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
function safeIdentifier(name) {
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
    const err = new Error(`Invalid field name: ${String(name).slice(0, 40)}`);
    err.status = 400;
    throw err;
  }
  return mysql.escapeId(name);
}

// Database helper functions
class Database {
  static async query(sql, params = []) {
    if (!pool) {
      throw new Error('Database connection not available. Please check your MySQL server and credentials.');
    }
    try {
      const [rows] = await pool.query(sql, params);
      this.decryptPII(rows);
      return rows;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    }
  }

  // Central PII decryption-at-the-read-boundary. Any result row whose field name
  // looks like an email/phone/mail column and whose value is an encrypted blob is
  // decrypted in place, so admin joins (u.email as owner_email, etc.) and profile
  // reads transparently get readable values. Values that are not encrypted
  // (plaintext names, hashes, NIN blobs) are left untouched.
  static decryptPII(rows) {
    if (!rows || !Array.isArray(rows) || rows.length === 0) return;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || 'fieldCount' in row) continue;
      for (const key of Object.keys(row)) {
        if (!/email|phone|mail/i.test(key)) continue;
        const value = row[key];
        if (typeof value === 'string' && PIIEncryptionService.isEncrypted(value)) {
          row[key] = PIIEncryptionService.decrypt(value);
        }
      }
    }
  }

  static async queryOne(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0] || null;
  }

  static async insert(table, data) {
    // PII write boundary (users/account_deletions/business_profiles): contact
    // fields are always stored encrypted (see update()). account_deletions keeps
    // the deleted owner's original_email for restore; business_profiles keeps the
    // business contact email/phone — all encrypted so contact PII is never
    // plaintext at rest.
    const safe = (table === 'users' || table === 'account_deletions' || table === 'business_profiles')
      ? PIIEncryptionService.encryptContactFields(data)
      : data;
    const keys = Object.keys(safe).filter((k) => safe[k] !== undefined);
    const values = keys.map((k) => safe[k]);
    const placeholders = keys.map(() => '?').join(', ');
    
    const sql = `INSERT INTO ${safeIdentifier(table)} (${keys.map(safeIdentifier).join(', ')}) VALUES (${placeholders})`;
    const result = await this.query(sql, values);
    
    return {
      insertId: result.insertId,
      affectedRows: result.affectedRows
    };
  }

  static async update(table, data, where, whereParams = []) {
    // PII write boundary (users/account_deletions/business_profiles only):
    // plaintext contact fields are encrypted before reaching SQL, with lookup
    // hashes attached where the table uses them. Already-encrypted values are
    // never double-encrypted. Other tables are written verbatim.
    const safe = (table === 'users' || table === 'account_deletions' || table === 'business_profiles')
      ? PIIEncryptionService.encryptContactFields(data)
      : data;
    const keys = Object.keys(safe).filter((k) => safe[k] !== undefined);
    const values = keys.map((k) => safe[k]);
    if (keys.length === 0) {
      return { affectedRows: 0, changedRows: 0 };
    }
    const setClause = keys.map(key => `${safeIdentifier(key)} = ?`).join(', ');
    
    const sql = `UPDATE ${safeIdentifier(table)} SET ${setClause} WHERE ${where}`;
    const result = await this.query(sql, [...values, ...whereParams]);
    
    return {
      affectedRows: result.affectedRows,
      changedRows: result.changedRows
    };
  }

  static async delete(table, where, whereParams = []) {
    const sql = `DELETE FROM ${safeIdentifier(table)} WHERE ${where}`;
    const result = await this.query(sql, whereParams);
    
    return {
      affectedRows: result.affectedRows
    };
  }

  static async select(table, columns = '*', where = '', whereParams = [], orderBy = '', limit = '') {
    let sql = `SELECT ${columns} FROM ${table}`;
    
    if (where) {
      sql += ` WHERE ${where}`;
    }
    
    if (orderBy) {
      sql += ` ORDER BY ${orderBy}`;
    }
    
    if (limit) {
      sql += ` LIMIT ${limit}`;
    }
    
    return await this.query(sql, whereParams);
  }

  static async selectOne(table, columns = '*', where = '', whereParams = []) {
    // Some callers already put "ORDER BY ... LIMIT 1" in the where text; adding a
    // second LIMIT is a SQL error, so only add it when it is missing.
    const hasLimit = /\blimit\s+\d+\s*$/i.test(String(where || ''));
    const rows = await this.select(table, columns, where, whereParams, '', hasLimit ? '' : '1');
    return rows[0] || null;
  }

  // Transaction support
  static async transaction(callback) {
    if (!pool) {
      throw new Error('Database connection not available. Please check your MySQL server and credentials.');
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try { await connection.rollback(); } catch (_) {}
      throw error;
    } finally {
      try { connection.release(); } catch (_) {}
    }
  }

  // Audit logging helper
  static async logAudit(userId, action, tableName, recordId, oldValues = null, newValues = null, ipAddress = null) {
    const auditData = {
      id: this.generateUUID(),
      user_id: userId,
      action: action,
      table_name: tableName,
      record_id: recordId,
      old_values: oldValues ? JSON.stringify(oldValues) : null,
      new_values: newValues ? JSON.stringify(newValues) : null,
      ip_address: ipAddress,
      created_at: new Date()
    };

    await this.insert('audit_logs', auditData);
  }

  // UUID generator (MySQL compatible, cryptographically random)
  static generateUUID() {
    const crypto = require('crypto');
    const bytes = crypto.randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytes.toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  }

  // Generate case ID
  static generateCaseId() {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 999999).toString().padStart(6, '0');
    return `CASE-${year}-${random}`;
  }

  // Password hashing utilities
  static async hashPassword(password) {
    const bcrypt = require('bcrypt');
    return await bcrypt.hash(password, 10);
  }

  static async verifyPassword(password, hash) {
    const bcrypt = require('bcrypt');
    return await bcrypt.compare(password, hash);
  }

  // JWT utilities — supports secret rotation via JWT_SECRET_PREVIOUS
  static generateJWT(payload, expiresIn = '24h') {
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return jwt.sign(payload, secret, { expiresIn, algorithm: 'HS256' });
  }

  // Short-lived, single-purpose token (MFA confirmation etc.). Always carries
  // a `type`, so it can never be used as a login token.
  static generatePurposeJWT(type, payload, expiresIn = '10m') {
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return jwt.sign({ ...payload, type }, secret, { expiresIn, algorithm: 'HS256' });
  }

  static verifyJWT(token) {
    const jwt = require('jsonwebtoken');
    const currentSecret = process.env.JWT_SECRET;
    if (!currentSecret) throw new Error('JWT_SECRET is not configured');

    try {
      return jwt.verify(token, currentSecret, { algorithms: ['HS256'] });
    } catch (err) {
      // If verification with current secret fails, try previous secret (rotation window)
      const previousSecret = process.env.JWT_SECRET_PREVIOUS;
      if (previousSecret) {
        try {
          return jwt.verify(token, previousSecret, { algorithms: ['HS256'] });
        } catch (prevErr) {
          // Neither secret worked
        }
      }
      throw err;
    }
  }

  // Close pool (for graceful shutdown)
  static async close() {
    if (pool) {
      await pool.end();
    }
  }
}

// Copy only the listed fields from a request body (undefined ones are skipped).
Database.pick = function pick(source, allowed) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      const v = source[key];
      // Objects/arrays would be expanded by the driver; only plain values pass
      if (v !== null && typeof v === 'object' && !(v instanceof Date)) continue;
      out[key] = v;
    }
  }
  return out;
};

module.exports = Database;