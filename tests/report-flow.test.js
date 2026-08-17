jest.mock('../config', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  selectOne: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  transaction: jest.fn(async (fn) => {
    const mockConn = { execute: jest.fn() };
    return fn(mockConn);
  }),
  generateUUID: jest.fn(() => 'test-uuid-' + Date.now()),
  generateCaseId: jest.fn(() => 'CASE-TEST-001'),
  logAudit: jest.fn(),
  generateJWT: jest.fn(() => 'test-token'),
  hashPassword: jest.fn(() => 'hashed'),
}));

jest.mock('axios');
jest.mock('../services/NotificationService', () => ({
  queueNotification: jest.fn(),
  notifyLEANewCase: jest.fn(),
}));
jest.mock('../services/TermiiService', () => ({
  sendSMS: jest.fn(),
}));
jest.mock('../services/EmailTemplate', () => ({
  wrapContent: jest.fn((subject, msg) => '<html>' + msg + '</html>'),
}));
jest.mock('../services/SecurityService', () => ({
  logCriticalAction: jest.fn(),
}));
jest.mock('../services/FraudDetectionService', () => ({
  checkAndFlag: jest.fn(() => ({ blocked: false })),
}));
jest.mock('../utils/user-helpers', () => ({
  getDisplayName: jest.fn(user => {
    if (!user) return '';
    return ((user.first_name || '') + ' ' + (user.last_name || '')).trim() || user.name || '';
  }),
  nameSelectColumns: jest.fn(() => 'u.first_name, u.last_name'),
}));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { id: 'user-123', role: 'user', email: 'test@example.com' };
    req.clientIp = '127.0.0.1';
    req.userAgent = 'test';
    req.macAddress = '00:00:00:00:00:00';
    next();
  },
  collectAuditContext: (req, res, next) => next(),
}));

const Database = require('../config');
const axios = require('axios');
const RevenueService = require('../services/RevenueService');
const NINVerificationService = require('../services/NINVerificationService');
const IdentityMatchingService = require('../services/IdentityMatchingService');
const request = require('supertest');

describe('RevenueService.shouldChargeForUserReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Report #1: first report requires payment of 300', async () => {
    Database.query.mockResolvedValueOnce([{ count: 0 }]);
    Database.selectOne.mockResolvedValueOnce({ setting_value: '2' });

    const result = await RevenueService.shouldChargeForUserReport('user-123');

    expect(result.requiresPayment).toBe(true);
    expect(result.reportNumber).toBe(1);
    expect(result.amount).toBe(300);
  });

  it('Report #2: within free allowance, no payment required', async () => {
    Database.query.mockResolvedValueOnce([{ count: 1 }]);
    Database.selectOne.mockResolvedValueOnce({ setting_value: '2' });

    const result = await RevenueService.shouldChargeForUserReport('user-123');

    expect(result.requiresPayment).toBe(false);
    expect(result.reportNumber).toBe(2);
  });

  it('Report #3: still within free allowance', async () => {
    Database.query.mockResolvedValueOnce([{ count: 2 }]);
    Database.selectOne.mockResolvedValueOnce({ setting_value: '2' });

    const result = await RevenueService.shouldChargeForUserReport('user-123');

    expect(result.requiresPayment).toBe(false);
    expect(result.reportNumber).toBe(3);
  });

  it('Report #4+: exceeds free allowance, requires payment', async () => {
    Database.query.mockResolvedValueOnce([{ count: 3 }]);
    Database.selectOne.mockResolvedValueOnce({ setting_value: '2' });

    const result = await RevenueService.shouldChargeForUserReport('user-123');

    expect(result.requiresPayment).toBe(true);
    expect(result.reportNumber).toBe(4);
  });

  it('Report #10+: still uses standard report_verification_fee', async () => {
    Database.query.mockResolvedValueOnce([{ count: 9 }]);
    Database.selectOne.mockResolvedValueOnce({ setting_value: '2' });

    const result = await RevenueService.shouldChargeForUserReport('user-123');

    expect(result.requiresPayment).toBe(true);
    expect(result.reportNumber).toBe(10);
    expect(result.amount).toBe(300);
  });

  it('Per-user count: count is per user, not per device', async () => {
    Database.query.mockResolvedValueOnce([{ count: 3 }]);
    Database.selectOne.mockResolvedValueOnce({ setting_value: '2' });

    const result = await RevenueService.shouldChargeForUserReport('user-123');

    expect(result.reportNumber).toBe(4);
  });
});

describe('NINVerificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('encrypt/decrypt roundtrip', () => {
    const plain = '12345678901';
    const encrypted = NINVerificationService.encrypt(plain);
    const decrypted = NINVerificationService.decrypt(encrypted);
    expect(decrypted).toBe(plain);
  });

  it('encrypt null returns null', () => {
    expect(NINVerificationService.encrypt(null)).toBeNull();
  });

  it('verifyNIN rejects invalid format: short number', async () => {
    await expect(NINVerificationService.verifyNIN('123')).rejects.toThrow('Invalid NIN format');
  });

  it('verifyNIN rejects null', async () => {
    await expect(NINVerificationService.verifyNIN(null)).rejects.toThrow('Invalid NIN format');
  });

  it('verifyNIN rejects alphanumeric', async () => {
    await expect(NINVerificationService.verifyNIN('1234567890a')).rejects.toThrow('Invalid NIN format');
  });

  it('verifyNIN requires PREMBLY_API_KEY env var', async () => {
    const original = process.env.PREMBLY_API_KEY;
    delete process.env.PREMBLY_API_KEY;
    await expect(NINVerificationService.verifyNIN('12345678901')).rejects.toThrow('PREMBLY_API_KEY');
    process.env.PREMBLY_API_KEY = original;
  });

  it('verifyNIN calls axios.post to prembly API and returns parsed data', async () => {
    process.env.PREMBLY_API_KEY = 'test-key';
    axios.post.mockResolvedValueOnce({
      data: {
        status: true,
        status_code: '00',
        data: { first_name: 'JOHN', last_name: 'DOE' }
      },
    });

    const result = await NINVerificationService.verifyNIN('12345678901');

    expect(axios.post).toHaveBeenCalled();
    expect(result.verified).toBe(true);
    expect(result.first_name).toBe('JOHN');
    expect(result.last_name).toBe('DOE');
  });

  it('verifyNIN throws on Prembly failure response', async () => {
    process.env.PREMBLY_API_KEY = 'test-key';
    axios.post.mockResolvedValueOnce({
      data: { status: false, message: 'Verification failed' },
    });

    await expect(NINVerificationService.verifyNIN('12345678901')).rejects.toThrow('Prembly NIN verification failed');
  });

  it('matchIdentity: surname + first_name match → matched=true, high confidence', async () => {
    Database.selectOne.mockResolvedValueOnce({
      name: 'John Doe', first_name: 'John', middle_name: 'M', last_name: 'Doe', email: 'test@test.com'
    });

    const result = await NINVerificationService.matchIdentity('user-123', {
      last_name: 'Doe', first_name: 'John', middle_name: 'M'
    });

    expect(result.matched).toBe(true);
    expect(result.confidence).toBe('high');
  });

  it('matchIdentity: no fields match → matched=false', async () => {
    Database.selectOne.mockResolvedValueOnce({
      name: 'Jane Smith', first_name: 'Jane', middle_name: 'X', last_name: 'Smith', email: 'test@test.com'
    });

    const result = await NINVerificationService.matchIdentity('user-123', {
      last_name: 'Doe', first_name: 'John', middle_name: 'M'
    });

    expect(result.matched).toBe(false);
  });

  it('matchIdentity: surname + middle_name only → matched=true', async () => {
    Database.selectOne.mockResolvedValueOnce({
      name: 'Jane Doe', first_name: 'Jane', middle_name: 'M', last_name: 'Doe', email: 'test@test.com'
    });

    const result = await NINVerificationService.matchIdentity('user-123', {
      last_name: 'Doe', first_name: 'John', middle_name: 'M'
    });

    expect(result.matched).toBe(true);
  });

  it('matchIdentity: skips middle_name when either user or NIN has empty middle_name', async () => {
    Database.selectOne.mockResolvedValueOnce({
      name: 'John Doe', first_name: 'John', middle_name: '', last_name: 'Doe', email: 'test@test.com'
    });

    const result = await NINVerificationService.matchIdentity('user-123', {
      last_name: 'Doe', first_name: 'John', middle_name: 'M'
    });

    expect(result.matched).toBe(true);
  });

  it('matchIdentity: throws if user not found', async () => {
    Database.selectOne.mockResolvedValueOnce(null);

    await expect(
      NINVerificationService.matchIdentity('nonexistent', { last_name: 'Doe' })
    ).rejects.toThrow('User not found');
  });
});

describe('IdentityMatchingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('isUserKycVerified: returns true when kyc_status=verified and is_verified=true', async () => {
    Database.selectOne.mockResolvedValueOnce({ kyc_status: 'verified', is_verified: true });

    const result = await IdentityMatchingService.isUserKycVerified('user-123');
    expect(result).toBe(true);
  });

  it('isUserKycVerified: returns false when kyc_status=pending', async () => {
    Database.selectOne.mockResolvedValueOnce({ kyc_status: 'pending', is_verified: false });

    const result = await IdentityMatchingService.isUserKycVerified('user-123');
    expect(result).toBeFalsy();
  });

  it('getUserNinMasked: returns masked NIN', async () => {
    Database.selectOne.mockResolvedValueOnce({ nin_last_digits: '1234' });

    const result = await IdentityMatchingService.getUserNinMasked('user-123');
    expect(result).toBe('****-****-****-1234');
  });

  it('getUserNinMasked: returns null when nin_last_digits is null', async () => {
    Database.selectOne.mockResolvedValueOnce({ nin_last_digits: null });

    const result = await IdentityMatchingService.getUserNinMasked('user-123');
    expect(result).toBeNull();
  });

  it('performKycVerification: skips if already verified', async () => {
    Database.selectOne.mockResolvedValueOnce({ kyc_status: 'verified', is_verified: true });

    const result = await IdentityMatchingService.performKycVerification('user-123', '12345678901');

    expect(result.success).toBe(true);
    expect(result.alreadyVerified).toBe(true);
  });

  it('performKycVerification: rejects invalid NIN', async () => {
    Database.selectOne.mockResolvedValueOnce({ kyc_status: 'pending', is_verified: false });

    const result = await IdentityMatchingService.performKycVerification('user-123', '123');

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Invalid NIN/i);
  });

  it('performKycVerification: calls NINVerificationService and saves on success', async () => {
    Database.selectOne.mockResolvedValueOnce({ kyc_status: 'pending', is_verified: false });
    NINVerificationService.verifyNIN = jest.fn().mockResolvedValue({
      status: true,
      data: { first_name: 'JOHN', surname: 'DOE', middle_name: 'M' },
    });
    NINVerificationService.matchIdentity = jest.fn().mockReturnValue({
      matched: true,
      confidence: 'high',
    });

    const result = await IdentityMatchingService.performKycVerification('user-123', '12345678901');

    expect(result.success).toBe(true);
    expect(NINVerificationService.verifyNIN).toHaveBeenCalledWith('12345678901');
    expect(Database.update).toHaveBeenCalled();
  });

  it('performKycVerification: creates admin alert on failure', async () => {
    Database.selectOne.mockResolvedValueOnce({ kyc_status: 'pending', is_verified: false });
    NINVerificationService.verifyNIN = jest.fn().mockResolvedValue({
      status: true,
      data: { first_name: 'JANE', surname: 'SMITH', middle_name: '' },
    });
    NINVerificationService.matchIdentity = jest.fn().mockReturnValue({
      matched: false,
      confidence: 'none',
    });

    const result = await IdentityMatchingService.performKycVerification('user-123', '12345678901');

    expect(result.success).toBe(false);
    expect(Database.insert).toHaveBeenCalled();
  });

  it('performKycVerification: handles Prembly API error gracefully', async () => {
    Database.selectOne.mockResolvedValueOnce({ kyc_status: 'pending', is_verified: false });
    NINVerificationService.verifyNIN = jest.fn().mockRejectedValue(new Error('API timeout'));

    const result = await IdentityMatchingService.performKycVerification('user-123', '12345678901');

    expect(result.success).toBe(false);
  });
});

describe('Report Management Routes', () => {
  let app;

  beforeAll(() => {
    const express = require('express');
    app = express();
    app.use(express.json());
    const reportRoutes = require('../routes/report-management');
    app.use('/api/reports', reportRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /my-devices: returns verified devices', async () => {
    Database.query.mockResolvedValueOnce([
      { id: 'dev-1', brand: 'iPhone', model: '14', imei: '123' },
    ]);

    const res = await request(app).get('/api/reports/my-devices');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].brand).toBe('iPhone');
  });

  it('GET /my-devices: returns empty array when no devices', async () => {
    Database.query.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/reports/my-devices');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('POST /: rejects missing required fields (400)', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({});

    expect(res.status).toBe(400);
  });

  it('POST /: rejects invalid report_type (400)', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ device_id: 'dev-1', report_type: 'invalid_type', description: 'test', occurred_at: '2026-01-01' });

    expect(res.status).toBe(400);
  });

  it('POST /: rejects device not owned by user (403)', async () => {
    Database.selectOne.mockImplementation((table) => {
      if (table === 'devices') return Promise.resolve({ id: 'dev-1', user_id: 'other-user', status: 'verified', brand: 'X', model: 'Y', imei: '123', serial: '456', color: 'black' });
      return Promise.resolve(null);
    });

    const res = await request(app)
      .post('/api/reports')
      .send({ device_id: 'dev-1', report_type: 'stolen', description: 'test', occurred_at: '2026-01-01' });

    expect(res.status).toBe(403);
  });

  it('POST /: rejects unverified device (400)', async () => {
    Database.selectOne.mockImplementation((table) => {
      if (table === 'devices') return Promise.resolve({ id: 'dev-1', user_id: 'user-123', status: 'unverified', brand: 'X', model: 'Y', imei: '123', serial: '456', color: 'black' });
      return Promise.resolve(null);
    });

    const res = await request(app)
      .post('/api/reports')
      .send({ device_id: 'dev-1', report_type: 'stolen', description: 'test', occurred_at: '2026-01-01' });

    expect(res.status).toBe(400);
  });

  it('POST /: returns payment required for first report', async () => {
    Database.selectOne.mockImplementation((table, cols, where) => {
      if (table === 'devices') return Promise.resolve({ id: 'dev-1', user_id: 'user-123', status: 'verified', brand: 'X', model: 'Y', imei: '123', serial: '456', color: 'black' });
      if (table === 'reports') return Promise.resolve(null);
      if (table === 'system_settings') return Promise.resolve({ setting_value: '2' });
      if (table === 'users') return Promise.resolve({ kyc_status: 'unverified', is_verified: false, region: 'default' });
      if (table === 'law_enforcement_agencies') return Promise.resolve({ id: 'lea-1' });
      return Promise.resolve(null);
    });
    Database.query.mockResolvedValueOnce([{ count: 0 }]);

    const res = await request(app)
      .post('/api/reports')
      .send({ device_id: 'dev-1', report_type: 'stolen', description: 'test', occurred_at: '2026-01-01' });

    expect(res.status).toBe(200);
    expect(res.body.requiresPayment).toBe(true);
  });

  it('POST /: returns requiresNin when no NIN and not KYC verified', async () => {
    Database.selectOne.mockImplementation((table, cols, where) => {
      if (table === 'devices') return Promise.resolve({ id: 'dev-1', user_id: 'user-123', status: 'verified', brand: 'X', model: 'Y', imei: '123', serial: '456', color: 'black' });
      if (table === 'reports') return Promise.resolve(null);
      if (table === 'system_settings') return Promise.resolve({ setting_value: '2' });
      if (table === 'users') return Promise.resolve({ kyc_status: 'unverified', is_verified: false, region: 'default', name: 'Test User', first_name: 'Test', middle_name: null, last_name: 'User', email: 'test@example.com', phone: null });
      if (table === 'law_enforcement_agencies') return Promise.resolve(null);
      return Promise.resolve(null);
    });
    Database.query.mockResolvedValueOnce([{ count: 1 }]);

    const res = await request(app)
      .post('/api/reports')
      .send({ device_id: 'dev-1', report_type: 'stolen', description: 'test', occurred_at: '2026-01-01' });

    expect(res.status).toBe(400);
    expect(res.body.requiresNin).toBe(true);
  });

  it('POST /: creates report successfully for free report (201)', async () => {
    Database.selectOne.mockImplementation((table, cols, where) => {
      if (table === 'devices') return Promise.resolve({ id: 'dev-1', user_id: 'user-123', status: 'verified', brand: 'iPhone', model: '14', imei: '123', serial: '456', color: 'black' });
      if (table === 'reports') return Promise.resolve(null);
      if (table === 'system_settings') return Promise.resolve({ setting_value: '2' });
      if (table === 'users') return Promise.resolve({ kyc_status: 'verified', is_verified: true, region: 'default', name: 'Test User', first_name: 'Test', middle_name: null, last_name: 'User', email: 'test@example.com', phone: '123456' });
      if (table === 'law_enforcement_agencies') return Promise.resolve({ id: 'lea-1', agency_name: 'Police', contact_email: 'lea@test.com' });
      return Promise.resolve(null);
    });
    Database.query.mockResolvedValueOnce([{ count: 1 }]);

    const res = await request(app)
      .post('/api/reports')
      .send({ device_id: 'dev-1', report_type: 'stolen', description: 'test', occurred_at: '2026-01-01' });

    expect(res.status).toBe(201);
    expect(Database.transaction).toHaveBeenCalled();
  });

  it('POST /: returns fraud blocked (403)', async () => {
    Database.selectOne.mockImplementation((table, cols, where) => {
      if (table === 'devices') return Promise.resolve({ id: 'dev-1', user_id: 'user-123', status: 'verified', brand: 'X', model: 'Y', imei: '123', serial: '456', color: 'black' });
      if (table === 'reports') return Promise.resolve(null);
      return Promise.resolve(null);
    });
    Database.query.mockResolvedValueOnce([{ count: 1 }]);
    const { checkAndFlag } = require('../services/FraudDetectionService');
    checkAndFlag.mockReturnValueOnce({ blocked: true });

    const res = await request(app)
      .post('/api/reports')
      .send({ device_id: 'dev-1', report_type: 'stolen', description: 'test', occurred_at: '2026-01-01' });

    expect(res.status).toBe(403);
  });

  it('POST /: rejects duplicate active report (409)', async () => {
    Database.selectOne.mockImplementation((table, cols, where) => {
      if (table === 'devices') return Promise.resolve({ id: 'dev-1', user_id: 'user-123', status: 'verified', brand: 'X', model: 'Y', imei: '123', serial: '456', color: 'black' });
      if (table === 'reports') return Promise.resolve({ id: 'existing-report', case_id: 'CASE-EXISTING' });
      return Promise.resolve(null);
    });

    const res = await request(app)
      .post('/api/reports')
      .send({ device_id: 'dev-1', report_type: 'stolen', description: 'test', occurred_at: '2026-01-01' });

    expect(res.status).toBe(409);
  });
});
