// Ownership proof review (no database needed).
// Run: npx jest --config '{}' tests/ownership-proof.test.js
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.KYC_ENCRYPTION_KEY = 'y'.repeat(48);
const request = require('supertest');
const { app } = require('../app');
const Database = require('../config');
const ProofTypes = require('../utils/proof-types');
const Ownership = require('../services/OwnershipProofService');
const Marketplace = require('../services/MarketplaceService');

const orig = { selectOne: Database.selectOne, queryOne: Database.queryOne, query: Database.query, insert: Database.insert, update: Database.update, logAudit: Database.logAudit };
afterEach(() => Object.assign(Database, orig));

const keys = (cat) => ProofTypes.typesFor(cat).map((t) => t.key);

describe('ownership proof review', () => {
  test('all ownership endpoints need login', async () => {
    expect((await request(app).get('/api/ownership/proof-types?category=laptop')).status).toBe(401);
    expect((await request(app).get('/api/ownership/device/1')).status).toBe(401);
    expect((await request(app).post('/api/ownership/claims')).status).toBe(401);
    expect((await request(app).get('/api/ownership/admin/proofs')).status).toBe(401);
  });

  test('proof types fit each kind of item', () => {
    expect(keys('smartphone')).toEqual(expect.arrayContaining(['receipt', 'imei_screen', 'box_label']));
    expect(keys('laptop')).toEqual(expect.arrayContaining(['serial_label', 'system_screen']));
    expect(keys('laptop')).not.toContain('imei_screen');
    expect(keys('vehicle')).toEqual(expect.arrayContaining(['vehicle_licence', 'customs_papers', 'vin_photo']));
    expect(keys('motorcycle')).toContain('vehicle_licence');
    expect(keys('jewelry')).toEqual(expect.arrayContaining(['appraisal_certificate', 'photo_with_item']));
    expect(keys('smartwatch')).toContain('serial_label');
    expect(keys('camera')).toContain('serial_label');
    expect(keys('something-new')).toEqual(expect.arrayContaining(['receipt', 'other']));
    expect(ProofTypes.isAllowed('vehicle', 'imei_screen')).toBe(false);
  });

  test('submitProof checks the proof type for the category and needs a note for "other"', async () => {
    Database.selectOne = async () => ({ id: 'd1', user_id: 'u1', category: 'vehicle', status: 'verified', ownership_level: 'registered' });
    const user = { id: 'u1', role: 'user' };
    await expect(Ownership.submitProof({ deviceId: 'd1', user, proofType: 'imei_screen', fileUrl: '/uploads/proofs/a.jpg' })).rejects.toThrow(/isn't used/);
    await expect(Ownership.submitProof({ deviceId: 'd1', user, proofType: 'other', fileUrl: '/uploads/proofs/a.jpg' })).rejects.toThrow(/note/);
    await expect(Ownership.submitProof({ deviceId: 'd1', user: { id: 'u2', role: 'user' }, proofType: 'receipt', fileUrl: 'x' })).rejects.toThrow(/not found/);

    const writes = [];
    Database.queryOne = async () => ({ n: 0 });
    Database.insert = async (t, row) => { writes.push([t, row]); };
    Database.update = async (t, row) => { writes.push([t, row]); };
    Database.logAudit = async () => {};
    const r = await Ownership.submitProof({ deviceId: 'd1', user, proofType: 'vehicle_licence', fileUrl: '/uploads/proofs/a.jpg' });
    expect(r.level).toBe('proof_submitted');
    expect(writes[0][0]).toBe('ownership_proofs');
    expect(writes[1][1].ownership_level).toBe('proof_submitted');
  });

  test('claims: not for your own item, and a real statement is needed', async () => {
    Database.selectOne = async () => ({ id: 'd1', user_id: 'u1', category: 'laptop', status: 'verified' });
    await expect(Ownership.fileClaim({ identifier: 'SN1', user: { id: 'u1' }, statement: 'x'.repeat(30), proofType: 'receipt', fileUrl: 'f' })).rejects.toThrow(/already registered to you/);
    await expect(Ownership.fileClaim({ identifier: 'SN1', user: { id: 'u2' }, statement: 'mine', proofType: 'receipt', fileUrl: 'f' })).rejects.toThrow(/20 characters/);
    await expect(Ownership.fileClaim({ identifier: 'SN1', user: { id: 'u2' }, statement: 'x'.repeat(30), proofType: 'vehicle_licence', fileUrl: 'f' })).rejects.toThrow(/Choose one of/);
    const found = await Ownership.findClaimable('SN1', { id: 'u2' });
    expect(found).not.toHaveProperty('user_id');
    expect(found.proofTypes.map((t) => t.key)).toContain('serial_label');
  });

  test('rejecting a proof needs a reason', async () => {
    await expect(Ownership.reviewProof({ proofId: 'p1', admin: { id: 'a1' }, decision: 'reject' })).rejects.toThrow(/why/);
    await expect(Ownership.reviewProof({ proofId: 'p1', admin: { id: 'a1' }, decision: 'maybe' })).rejects.toThrow(/approve or reject/);
  });

  test('a transfer keeps "verified owner" only from a verified seller', async () => {
    const calls = [];
    Database.query = async (sql, params) => { calls.push(params); return { affectedRows: 1 }; };
    await Ownership.carryOverLevel('d1', 'verified_owner');
    await Ownership.carryOverLevel('d1', 'proof_submitted');
    expect(calls[0][0]).toBe('verified_owner');
    expect(calls[1][0]).toBe('registered');
  });

  test('registration maps every app category to the right stored category and identifier', () => {
    const Cat = require('../services/DeviceCategoryService');
    expect(Cat.normalizeCategory('smartphone')).toBe('mobile_phone');
    expect(Cat.normalizeCategory('laptop')).toBe('computer');
    expect(Cat.normalizeCategory('motorcycle')).toBe('vehicle');
    expect(Cat.normalizeCategory('headphones')).toBe('electronics');
    expect(Cat.normalizeCategory('smartwatch')).toBe('smart_watch');
    expect(Cat.validateDeviceData('mobile_phone', { brand: 'a', model: 'b' }).errors[0]).toMatch(/IMEI/);
    expect(Cat.validateDeviceData('computer', { serialNumber: 'C02XL0GT-JGH5', brand: 'a', model: 'b' }).valid).toBe(true);
    expect(Cat.validateDeviceData('jewelry', { description: 'Gold ring with a blue stone', brand: 'a', model: 'b' }).valid).toBe(true);
  });

  test('only verified owners can list items for sale', async () => {
    Database.selectOne = async () => ({ id: 'd1', user_id: 'u1', status: 'verified', ownership_level: 'registered' });
    await expect(Marketplace.createListing('u1', { device_id: 'd1', title: 't', price: 1000 })).rejects.toThrow(/verified owners/);
    Database.selectOne = async () => ({ id: 'd1', user_id: 'u1', status: 'verified', ownership_level: 'disputed' });
    await expect(Marketplace.createListing('u1', { device_id: 'd1', title: 't', price: 1000 })).rejects.toThrow(/ownership claim/);
  });
});
