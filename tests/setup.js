// Test Setup and Configuration
process.env.KYC_ENCRYPTION_KEY = process.env.KYC_ENCRYPTION_KEY || 'test-kyc-encryption-key-0123456789abcdef';
const Database = require('../config');

// Database pool is managed as a module singleton — it stays open for the
// lifetime of the Node.js process across all test files. Jest's --forceExit
// handles the final cleanup.

// Test database configuration
const testDbConfig = {
  host: process.env.TEST_DB_HOST || process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.TEST_DB_PORT || process.env.DB_PORT || 3306, 10),
  user: process.env.TEST_DB_USER || process.env.DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.TEST_DB_NAME || 'check_it_registry_test'
};

// Whether the DB-backed suites can actually run. Checks connectivity once with a
// short timeout; if no test database exists (shared hosting often grants access to
// a single DB only), the DB-backed suites skip cleanly instead of crashing.
let testDbAvailable = null;

async function checkTestDbAvailable() {
  if (testDbAvailable !== null) return testDbAvailable;
  try {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
      host: testDbConfig.host,
      port: testDbConfig.port,
      user: testDbConfig.user,
      password: testDbConfig.password,
      connectTimeout: 5000
    });
    await conn.query(`SELECT 1 FROM DUAL WHERE EXISTS (SELECT 1)`);
    await conn.end();
    testDbAvailable = true;
    console.log(`[tests] DB-backed suites ENABLED → ${testDbConfig.user}@${testDbConfig.host}:${testDbConfig.port}/${testDbConfig.database}`);
  } catch (error) {
    testDbAvailable = false;
    console.warn(
      `[tests] No test database reachable (${error.code || error.message}). ` +
      `DB-backed suites will SKIP. Provision one via ` +
      `\`docker compose up -d mysql\` (local MySQL on port 3307) or a MySQL you can create ` +
      `\`${testDbConfig.database}\` in, then run tests with ` +
      `TEST_DB_HOST/TEST_DB_PORT/TEST_DB_USER/TEST_DB_PASSWORD/TEST_DB_NAME set.`
    );
  }
  return testDbAvailable;
}

// Test utilities
class TestUtils {
  static async setupTestDatabase() {
    // Create test database if it doesn't exist
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection({
      host: testDbConfig.host,
      port: testDbConfig.port,
      user: testDbConfig.user,
      password: testDbConfig.password
    });

    await connection.execute(`CREATE DATABASE IF NOT EXISTS ${testDbConfig.database}`);
    await connection.end();

    // Run schema on test database
    // This would typically load the schema.sql file
    console.log('Test database setup complete');
  }

  static async cleanupTestDatabase() {
    // Clean up test data
    const tables = [
      'email_verification_tokens',
      'api_keys',
      'data_exports',
      'user_sessions',
      'business_onboardings',
      'kyc_verifications',
      'payment_invoices',
      'device_check_logs',
      'imei_checks',
      'notifications',
      'audit_logs',
      'device_transfers',
      'reports',
      'devices',
      'users',
      'law_enforcement_agencies'
    ];

    for (const table of tables) {
      try {
        await Database.query(`DELETE FROM ${table} WHERE 1=1`);
      } catch (error) {
        // Table might not exist, continue
      }
    }
  }

  static async createTestUser(userData = {}) {
    const uniqueSuffix = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const defaultUser = {
      id: Database.generateUUID(),
      name: 'Test User',
      email: `test-${uniqueSuffix}@example.com`,
      password_hash: await Database.hashPassword('password123'),
      role: 'user',
      region: 'test-region',
      created_at: new Date()
    };

    const user = { ...defaultUser, ...userData };
    await Database.insert('users', user);
    return user;
  }

  static async createTestDevice(deviceData = {}, userId = null) {
    if (!userId) {
      const user = await this.createTestUser();
      userId = user.id;
    }

    const defaultDevice = {
      id: Database.generateUUID(),
      user_id: userId,
      imei: '1234567890' + String(Date.now()).slice(-5),
      serial: 'TEST' + String(Date.now()).slice(-6),
      brand: 'TestBrand',
      model: 'TestModel',
      color: 'Black',
      proof_url: 'https://example.com/proof.jpg',
      status: 'verified',
      created_at: new Date()
    };

    const device = { ...defaultDevice, ...deviceData };
    await Database.insert('devices', device);
    return device;
  }

  static async createTestReport(reportData = {}, deviceId = null) {
    if (!deviceId) {
      const device = await this.createTestDevice();
      deviceId = device.id;
    }

    const defaultReport = {
      id: Database.generateUUID(),
      device_id: deviceId,
      report_type: 'stolen',
      description: 'Test theft report',
      occurred_at: new Date(),
      location: 'Test Location',
      status: 'open',
      case_id: Database.generateCaseId(),
      created_at: new Date()
    };

    const report = { ...defaultReport, ...reportData };
    await Database.insert('reports', report);
    return report;
  }

  static generateAuthToken(user) {
    return Database.generateJWT({
      id: user.id,
      email: user.email,
      role: user.role
    });
  }

  static async makeAuthenticatedRequest(app, method, url, data = {}, user = null) {
    if (!user) {
      user = await this.createTestUser();
    }

    const token = this.generateAuthToken(user);
    const request = require('supertest')(app);

    let req;
    switch (method.toLowerCase()) {
      case 'get':
        req = request.get(url);
        break;
      case 'post':
        req = request.post(url).send(data);
        break;
      case 'put':
        req = request.put(url).send(data);
        break;
      case 'delete':
        req = request.delete(url);
        break;
      default:
        throw new Error(`Unsupported method: ${method}`);
    }

    return req.set('Authorization', `Bearer ${token}`);
  }

  static async waitFor(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static generateRandomIMEI() {
    let imei = '';
    for (let i = 0; i < 15; i++) {
      imei += Math.floor(Math.random() * 10);
    }
    return imei;
  }

  static generateRandomSerial() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let serial = '';
    for (let i = 0; i < 10; i++) {
      serial += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return serial;
  }
}

module.exports = {
  TestUtils,
  testDbConfig,
  checkTestDbAvailable,
};