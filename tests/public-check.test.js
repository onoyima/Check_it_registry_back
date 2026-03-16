// Public Check Tests
const request = require('supertest');
const app = require('../app');
const { TestUtils } = require('./setup');

describe('Public Check API', () => {
  beforeEach(async () => {
    await TestUtils.cleanupTestDatabase();
  });

  describe('GET /api/public-check', () => {
    test('should return not_found for unregistered device', async () => {
      const response = await request(app)
        .get('/api/public-check')
        .query({ imei: '123456789012345' })
        .expect(200);

      expect(response.body.status).toBe('not_found');
      expect(response.body.message).toContain('not found in registry');
    });

    test('should return clean status for verified device', async () => {
      const device = await TestUtils.createTestDevice({
        imei: '123456789012345',
        status: 'verified'
      });

      const response = await request(app)
        .get('/api/public-check')
        .query({ imei: device.imei })
        .expect(200);

      expect(response.body.status).toBe('clean');
      expect(response.body.message).toContain('no active reports');
    });

    test('should return stolen status for stolen device', async () => {
      const device = await TestUtils.createTestDevice({
        imei: '123456789012345',
        status: 'stolen'
      });

      await TestUtils.createTestReport({
        device_id: device.id,
        report_type: 'stolen',
        status: 'open'
      });

      const response = await request(app)
        .get('/api/public-check')
        .query({ imei: device.imei })
        .expect(200);

      expect(response.body.status).toBe('stolen');
      expect(response.body.message).toContain('reported as stolen');
      expect(response.body).toHaveProperty('case_id');
      expect(response.body).toHaveProperty('recovery_instructions');
    });

    test('should return unverified status for unverified device', async () => {
      const device = await TestUtils.createTestDevice({
        imei: '123456789012345',
        status: 'unverified'
      });

      const response = await request(app)
        .get('/api/public-check')
        .query({ imei: device.imei })
        .expect(200);

      expect(response.body.status).toBe('unverified');
      expect(response.body.message).toContain('pending verification');
    });

    test('should work with serial number instead of IMEI', async () => {
      const device = await TestUtils.createTestDevice({
        serial: 'TEST123456',
        status: 'verified'
      });

      const response = await request(app)
        .get('/api/public-check')
        .query({ serial: device.serial })
        .expect(200);

      expect(response.body.status).toBe('clean');
    });

    test('should require IMEI or serial number', async () => {
      const response = await request(app)
        .get('/api/public-check')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('IMEI or serial number required');
    });

    test('should log the check in database', async () => {
      const device = await TestUtils.createTestDevice({
        imei: '123456789012345',
        status: 'verified'
      });

      await request(app)
        .get('/api/public-check')
        .query({ imei: device.imei })
        .expect(200);

      // Check if log was created
      const Database = require('../config');
      const logs = await Database.query(
        'SELECT * FROM imei_checks WHERE query = ?',
        [device.imei]
      );

      expect(logs.length).toBe(1);
      expect(logs[0].query).toBe(device.imei);
    });

    test('should handle rate limiting after multiple requests', async () => {
      const device = await TestUtils.createTestDevice({
        imei: '123456789012345',
        status: 'verified'
      });

      // Make multiple requests to trigger rate limiting
      for (let i = 0; i < 4; i++) {
        await request(app)
          .get('/api/public-check')
          .query({ imei: device.imei })
          .expect(200);
      }

      // 5th request should require CAPTCHA
      const response = await request(app)
        .get('/api/public-check')
        .query({ imei: device.imei })
        .expect(400);

      expect(response.body).toHaveProperty('captcha_required');
      expect(response.body.captcha_required).toBe(true);
    });
  });
});

module.exports = {};