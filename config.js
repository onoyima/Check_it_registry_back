// MySQL Database Configuration

const mysql = require('mysql2/promise');

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

// Database helper functions
class Database {
  static async query(sql, params = []) {
    if (!pool) {
      throw new Error('Database connection not available. Please check your MySQL server and credentials.');
    }
    try {
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    }
  }

  static async queryOne(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0] || null;
  }

  static async insert(table, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => '?').join(', ');
    
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await this.query(sql, values);
    
    return {
      insertId: result.insertId,
      affectedRows: result.affectedRows
    };
  }

  static async update(table, data, where, whereParams = []) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClause = keys.map(key => `${key} = ?`).join(', ');
    
    const sql = `UPDATE ${table} SET ${setClause} WHERE ${where}`;
    const result = await this.query(sql, [...values, ...whereParams]);
    
    return {
      affectedRows: result.affectedRows,
      changedRows: result.changedRows
    };
  }

  static async delete(table, where, whereParams = []) {
    const sql = `DELETE FROM ${table} WHERE ${where}`;
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
    const rows = await this.select(table, columns, where, whereParams, '', '1');
    return rows[0] || null;
  }

  // Transaction support
  static async transaction(callback) {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
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

  // JWT utilities
  static generateJWT(payload) {
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return jwt.sign(payload, secret, { expiresIn: '24h', algorithm: 'HS256' });
  }

  static verifyJWT(token) {
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  }

  // Close pool (for graceful shutdown)
  static async close() {
    if (pool) {
      await pool.end();
    }
  }
}

module.exports = Database;