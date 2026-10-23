// Transferring an item to a new owner with the seller's and buyer's codes.
const { api, auth, state, Database, registerItem, confirmItem, expectStatus, latestOtp, makeSerial, makeImei } = require('./helpers');

describe('ownership transfer', () => {
  test('seller starts, both confirm with codes, the item moves to the buyer', async () => {
    const seller = state().users.user; const buyer = state().users.user2;
    const d = await registerItem('user', { category: 'laptop', brand: 'Apple', model: 'MacBook Pro', serial: makeSerial() });
    // an unconfirmed item cannot be transferred
    expectStatus(await api().post('/api/device-transfer/initiate').set(auth('user')).send({ deviceId: d.id, buyerEmail: buyer.email }), 400);
    await confirmItem('user', d.id);
    // only the owner can start it
    expectStatus(await api().post('/api/device-transfer/initiate').set(auth('user2')).send({ deviceId: d.id, buyerEmail: buyer.email }), 400);

    const start = expectStatus(await api().post('/api/device-transfer/initiate').set(auth('user')).send({ deviceId: d.id, buyerEmail: buyer.email, salePrice: 900000, transferReason: 'sale' }), 201);
    const { transferId, transferCode } = start.body;
    expect(transferCode).toBeTruthy();
    // a second transfer for the same item is refused
    expectStatus(await api().post('/api/device-transfer/initiate').set(auth('user')).send({ deviceId: d.id, buyerEmail: buyer.email }), 400);

    expectStatus(await api().post('/api/device-transfer/verify-otp').set(auth('user')).send({ transferId, otpCode: '000000' }), 400);
    const [{ otp_code: sellerCode }] = await Database.query('SELECT otp_code FROM ownership_transfers WHERE id = ?', [transferId]);
    expectStatus(await api().post('/api/device-transfer/verify-otp').set(auth('user')).send({ transferId, otpCode: sellerCode }), 200);

    // the seller cannot accept their own transfer
    expectStatus(await api().post('/api/device-transfer/complete').set(auth('user')).send({ transferCode }), 400);
    const step1 = expectStatus(await api().post('/api/device-transfer/complete').set(auth('user2')).send({ transferCode }), 200);
    expect(JSON.stringify(step1.body)).toMatch(/code|otp/i);
    const [{ buyer_otp_code: buyerCode }] = await Database.query('SELECT buyer_otp_code FROM ownership_transfers WHERE id = ?', [transferId]);
    expectStatus(await api().post('/api/device-transfer/complete').set(auth('user2')).send({ transferCode, otpCode: buyerCode }), 200);

    const [row] = await Database.query('SELECT user_id, status FROM devices WHERE id = ?', [d.id]);
    expect(row.user_id).toBe(buyer.id);
    const mine = expectStatus(await api().get('/api/device-transfer/my-transfers').set(auth('user2')), 200);
    expect(JSON.stringify(mine.body)).toContain(transferCode);
  });

  test('a verified owner passes "verified owner" on; an unverified one does not', async () => {
    const OwnershipProofService = require('../../services/OwnershipProofService');
    const d = await registerItem('user', { category: 'smartphone', brand: 'Google', model: 'Pixel 9', imei: makeImei() });
    await OwnershipProofService.carryOverLevel(d.id, 'proof_submitted');
    const [a] = await Database.query('SELECT ownership_level FROM devices WHERE id = ?', [d.id]);
    expect(a.ownership_level).toBe('registered');
    await OwnershipProofService.carryOverLevel(d.id, 'verified_owner');
    const [b] = await Database.query('SELECT ownership_level FROM devices WHERE id = ?', [d.id]);
    expect(b.ownership_level).toBe('verified_owner');
  });

  test('the seller can cancel a pending transfer', async () => {
    const d = await registerItem('user', { category: 'laptop', brand: 'HP', model: 'ProBook', serial: makeSerial() });
    await confirmItem('user', d.id);
    const start = expectStatus(await api().post('/api/device-transfer/initiate').set(auth('user')).send({ deviceId: d.id, buyerEmail: state().users.user2.email }), 201);
    expectStatus(await api().post('/api/device-transfer/cancel').set(auth('user')).send({ transferId: start.body.transferId }), 200);
    const [row] = await Database.query('SELECT status FROM devices WHERE id = ?', [d.id]);
    expect(row.status).toBe('verified');
  });
});
