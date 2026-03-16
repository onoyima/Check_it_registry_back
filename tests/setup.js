// Test Setup and Configuration
const Database = require('../config');

// Test database configuration
const testDbConfig = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: process.env.TEST_DB_PORT || 3306,
  user: process.env.TEST_DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || '',
  database: process.env.TEST_DB_NAME || 'check_it_registry_test'
};

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
    const defaultUser = {
      id: Database.generateUUID(),
      name: 'Test User',
      email: 'test@example.com',
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
      imei: '123456789012345',
      serial: 'TEST123456',
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
  testDbConfig
};