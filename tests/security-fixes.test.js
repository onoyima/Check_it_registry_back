// Regression tests for the October 2026 security fixes (no database needed).
// Run: npx jest --config '{}' tests/security-fixes.test.js
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.KYC_ENCRYPTION_KEY = 'y'.repeat(48);
process.env.PAYSTACK_SECRET_KEY = 'sk_test_demo';
const crypto = require('crypto');
const request = require('supertest');
const { app } = require('../app');
const Database = require('../config');
const FUS = require('../services/FileUploadService');
const KYC = require('../services/KYCService');

describe('security fixes', () => {
  test('C1: path traversal is refused', async () => {
    for (const p of ['/api/files/view/misc/..%2F..%2F.env', '/api/files/view/misc/..%2F..%2Fpackage.json', '/api/files/view/misc/%2Eenv']) {
      const r = await request(app).get(p);
      expect(r.status).toBe(400);
      expect(r.text).not.toMatch(/SECRET|"dependencies"/);
    }
    expect(FUS.safeResolve('misc', '../../.env')).toBeNull();
    expect(FUS.safeResolve('etc', 'a.jpg')).toBeNull();
    expect(FUS.safeResolve('devices', '1730-abc.jpg')).toMatch(/uploads[\\/]devices[\\/]1730-abc\.jpg$/);
  });

  test('C1: KYC files need login', async () => {
    require('fs').mkdirSync(require('path').join(__dirname, '../uploads/kyc'), { recursive: true });
    require('fs').writeFileSync(require('path').join(__dirname, '../uploads/kyc/selfie-1.jpg'), 'x');
    const r = await request(app).get('/api/files/view/kyc/selfie-1.jpg');
    expect(r.status).toBe(401);
  });

  test('checks and check history need login', async () => {
    expect((await request(app).get('/api/public-check?imei=123456789012345')).status).toBe(401);
    expect((await request(app).post('/api/public-check/enhanced').send({})).status).toBe(401);
    expect((await request(app).get('/api/public-check/history?identifier=1')).status).toBe(401);
    expect((await request(app).get('/api/public-check/report/1')).status).toBe(401);
  });

  test('C3/C4: fake purchase and payment endpoints are gone', async () => {
    expect((await request(app).post('/api/payments/callback').send({ reference: 'x', status: 'success' })).status).toBe(404);
    expect((await request(app).post('/api/payments/confirm').send({ reference: 'x' })).status).toBe(404);
    expect((await request(app).post('/api/marketplace/abc/purchase').send({})).status).toBe(404);
  });

  test('C5: SQL identifiers from request bodies are rejected', async () => {
    const orig = Database.query;
    let sql = null;
    Database.query = async (q) => { sql = q; return { affectedRows: 1 }; };
    await expect(Database.update('devices', { "status = 'verified', brand": 'x' }, 'id = ?', ['1'])).rejects.toThrow(/Invalid field name/);
    await Database.update('devices', { brand: 'x', model: undefined }, 'id = ?', ['1']);
    expect(sql).toBe('UPDATE `devices` SET `brand` = ? WHERE id = ?');
    Database.query = orig;
    expect(Database.pick({ status: 'verified', color: 'red', o: { a: 1 } }, ['color', 'o'])).toEqual({ color: 'red' });
  });

  test('H4: webhook checks the raw-body signature', async () => {
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'nope', amount: 100 } });
    const bad = await request(app).post('/api/payments/webhook/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', 'bad').send(body);
    expect(bad.status).toBe(400);
    const sig = crypto.createHmac('sha512', 'sk_test_demo').update(body).digest('hex');
    const ok = await request(app).post('/api/payments/webhook/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', sig).send(body);
    expect(ok.status).toBe(200);
  });

  test('H8: no public error page or debug route', async () => {
    const r = await request(app).get('/');
    expect(r.headers['content-type']).toMatch(/json/);
    expect(r.text).not.toMatch(/stack|Blocked IPs/i);
  });

  test('C2-related: purpose tokens can not be used to log in', async () => {
    const mfa = Database.generatePurposeJWT('mfa_token', { userId: 'u1' });
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${mfa}`);
    expect(r.status).toBe(401);
  });

  test('H6: revoked, suspended and deleted accounts are refused', async () => {
    const { loadUserForToken } = require('../middleware/auth');
    const orig = Database.selectOne;
    const base = { id: 'u1', role: 'user', token_version: 2, suspended_at: null, deleted_at: null };
    Database.selectOne = async () => ({ ...base });
    expect((await loadUserForToken({ id: 'u1', tv: 1 })).status).toBe(401);
    expect((await loadUserForToken({ id: 'u1', tv: 2 })).user.id).toBe('u1');
    Database.selectOne = async () => ({ ...base, suspended_at: new Date() });
    expect((await loadUserForToken({ id: 'u1', tv: 2 })).status).toBe(403);
    Database.selectOne = async () => ({ ...base, deleted_at: new Date() });
    expect((await loadUserForToken({ id: 'u1', tv: 2 })).status).toBe(401);
    expect((await loadUserForToken({ id: 'u1', type: 'device_verify' })).status).toBe(401);
    Database.selectOne = orig;
  });

  afterAll(() => {
    try { require('fs').unlinkSync(require('path').join(__dirname, '../uploads/kyc/selfie-1.jpg')); } catch (_) {}
  });

  test('C8: NIN name matching', () => {
    expect(KYC.namesMatch({ first_name: 'Adaeze', last_name: 'Okafor' }, { first_name: 'Adaeze', last_name: 'Okafor', middle_name: 'N' })).toBe(true);
    expect(KYC.namesMatch({ first_name: 'OKAFOR', last_name: 'adaeze' }, { name: 'Adaeze Okafor' })).toBe(true);
    expect(KYC.namesMatch({ first_name: 'Musa', last_name: 'Bello' }, { name: 'Adaeze Okafor' })).toBe(false);
  });
});
