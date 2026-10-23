// The marketplace switch, and the choice of who holds marketplace money
// (Monnify by default; Flutterwave, Vesicash or Paystack as alternatives).
// Each sale stays with the provider that took its money.
const crypto = require('crypto');
const { api, auth, state, Database, registerItem, confirmItem, expectStatus, makeImei } = require('./helpers');
const Escrow = require('../../services/escrow');

const setProvider = (p) => api().put('/api/modules/admin/escrow/provider').set(auth('admin')).send({ provider: p });
const setMarketplace = (on) => api().put('/api/modules/admin/marketplace').set(auth('admin')).send({ on });

async function listing(price = 500000) {
  const d = await registerItem('business', { category: 'smartphone', brand: 'Apple', model: 'iPhone 13', imei: makeImei() });
  await confirmItem('business', d.id);
  await Database.query("UPDATE devices SET ownership_level = 'verified_owner' WHERE id = ?", [d.id]);
  const l = expectStatus(await api().post('/api/marketplace').set(auth('business')).send({ device_id: d.id, title: 'iPhone 13', price, condition: 'good' }), 201);
  return { id: l.body.id || l.body.listing?.id, device: d };
}

// A stand-in for Monnify's servers: remembers payments, records releases and refunds
function fakeMonnify() {
  const m = Escrow.get('monnify');
  const keys = ['configured', 'initializePayment', 'verifyPayment', 'release', 'refund'];
  const saved = Object.fromEntries(keys.map((k) => [k, m[k]]));
  const log = { payments: new Map(), released: [], refunded: [] };
  Object.assign(m, {
    configured: () => true,
    initializePayment: async ({ reference, amount }) => { log.payments.set(reference, { amount, paid: false }); return { authorizationUrl: `https://sandbox.monnify.test/checkout/${reference}`, providerReference: `MNFY|${reference}` }; },
    verifyPayment: async (reference) => { const p = log.payments.get(reference); return { paid: !!p?.paid, amount: p?.paid ? p.amount : 0, currency: 'NGN', providerReference: `MNFY|${reference}` }; },
    release: async (args) => { log.released.push(args); return { success: true, transferCode: `MFDS-${args.reference}` }; },
    refund: async (args) => { log.refunded.push(args); return { success: true, refundReference: args.reference }; },
  });
  return { log, restore: () => Object.assign(m, saved) };
}

describe('marketplace switch', () => {
  afterAll(async () => { await setMarketplace(true); });

  test('when off, visitors and users are told it is not open; admins can still use it', async () => {
    expectStatus(await setMarketplace(false), 200);
    expect((await api().get('/api/modules')).body.marketplace).toBe(false);
    const visitor = expectStatus(await api().get('/api/marketplace'), 503);
    expect(visitor.body.moduleOff).toBe('marketplace');
    expectStatus(await api().get('/api/marketplace').set(auth('user')), 503);
    expectStatus(await api().get('/api/escrow/buyer-orders').set(auth('user')), 503);
    expectStatus(await api().get('/api/marketplace').set(auth('admin')), 200);
    // only admins can switch it
    expectStatus(await api().put('/api/modules/admin/marketplace').set(auth('user')).send({ on: true }), 403);
    expectStatus(await setMarketplace(true), 200);
    expectStatus(await api().get('/api/marketplace'), 200);
  });
});

describe('escrow providers', () => {
  let monnify;
  beforeAll(() => {
    process.env.MONNIFY_SECRET_KEY = 'monnify-test-secret';
    monnify = fakeMonnify();
  });
  afterAll(async () => { await setProvider('paystack'); monnify.restore(); });

  test('the admin sees every provider and whether it is ready', async () => {
    const r = expectStatus(await api().get('/api/modules/admin').set(auth('admin')), 200);
    const names = r.body.escrowProviders.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['monnify', 'flutterwave', 'vesicash', 'paystack']));
    expect(r.body.escrowProviders.find((p) => p.name === 'vesicash').ready).toBe(false);
    expectStatus(await setProvider('vesicash'), 400); // not ready yet
    expectStatus(await setProvider('nonsense'), 500, 400);
  });

  test('a provider without keys cannot start a sale (clear message, no broken payment page)', async () => {
    expectStatus(await setProvider('flutterwave'), 200);
    const { id } = await listing();
    const r = expectStatus(await api().post(`/api/marketplace/${id}/initiate-purchase`).set(auth('user2')), 400, 503);
    expect(r.body.error).toMatch(/flutterwave/i);
  });

  test('Monnify: pay → Monnify notification → held → buyer confirms → seller paid through Monnify', async () => {
    expectStatus(await setProvider('monnify'), 200);
    const { id, device } = await listing(700000);
    const start = expectStatus(await api().post(`/api/marketplace/${id}/initiate-purchase`).set(auth('user2')), 200);
    expect(start.body.provider).toBe('monnify');
    expect(start.body.authorizationUrl).toMatch(/monnify/);
    const ref = start.body.reference;

    // Monnify tells us it's paid (signed notification)
    monnify.log.payments.get(ref).paid = true;
    const body = JSON.stringify({ eventType: 'SUCCESSFUL_TRANSACTION', eventData: { paymentReference: ref, amountPaid: 700000, paymentStatus: 'PAID', currency: 'NGN' } });
    const bad = await api().post('/api/payments/webhook/monnify').set('Content-Type', 'application/json').set('monnify-signature', 'forged').send(body);
    expect(bad.status).toBe(400);
    const sig = crypto.createHmac('sha512', 'monnify-test-secret').update(body).digest('hex');
    expectStatus(await api().post('/api/payments/webhook/monnify').set('Content-Type', 'application/json').set('monnify-signature', sig).send(body), 200);
    await new Promise((r) => setTimeout(r, 400));

    const [esc] = await Database.query('SELECT * FROM escrow_transactions WHERE listing_id = ?', [id]);
    expect(esc.status).toBe('held');
    expect(esc.payment_provider).toBe('monnify');

    // Switching provider now must not move this sale away from Monnify
    expectStatus(await setProvider('paystack'), 200);
    await Database.query("INSERT INTO seller_bank_accounts (id, user_id, bank_name, bank_code, account_number, account_name, recipient_code, is_verified) VALUES (UUID(), ?, 'GTBank', '058', '0123456789', 'Chidi Tester', 'RCP_x', 1)", [state().users.business.id]).catch(() => {});
    expectStatus(await api().put(`/api/escrow/${esc.id}/confirm-delivery`).set(auth('user2')), 200);
    expect(monnify.log.released.length).toBe(1);
    expect(Number(monnify.log.released[0].amount)).toBeLessThan(700000); // commission kept
    const [now] = await Database.query('SELECT user_id FROM devices WHERE id = ?', [device.id]);
    expect(now.user_id).toBe(state().users.user2.id);
  });

  test('Monnify: a dispute settled for the buyer refunds through Monnify', async () => {
    expectStatus(await setProvider('monnify'), 200);
    const { id } = await listing(300000);
    const ref = expectStatus(await api().post(`/api/marketplace/${id}/initiate-purchase`).set(auth('user2')), 200).body.reference;
    monnify.log.payments.get(ref).paid = true;
    expectStatus(await api().post('/api/marketplace/complete-purchase').set(auth('user2')).send({ reference: ref }), 200);
    const [esc] = await Database.query('SELECT id FROM escrow_transactions WHERE listing_id = ?', [id]);
    expectStatus(await api().post(`/api/escrow/${esc.id}/dispute`).set(auth('user2')).send({ reason: 'Not as described' }), 200);
    const r = expectStatus(await api().post(`/api/escrow/admin/resolve/${esc.id}`).set(auth('admin')).send({ action: 'refund', notes: 'Seller sent the wrong phone' }), 200);
    expect(monnify.log.refunded.length).toBe(1);
    expect(monnify.log.refunded[0].providerReference).toBe(`MNFY|${ref}`);
    expect(JSON.stringify(r.body)).toMatch(/refund/i);
  });

  test('Flutterwave notifications are checked too', async () => {
    process.env.FLW_SECRET_HASH = 'flw-test-hash';
    const body = JSON.stringify({ event: 'charge.completed', data: { tx_ref: 'nothing-here', amount: 1, status: 'successful', currency: 'NGN' } });
    expect((await api().post('/api/payments/webhook/flutterwave').set('Content-Type', 'application/json').set('verif-hash', 'wrong').send(body)).status).toBe(400);
    expect((await api().post('/api/payments/webhook/flutterwave').set('Content-Type', 'application/json').set('verif-hash', 'flw-test-hash').send(body)).status).toBe(200);
  });
});

describe('Monnify connection (requests it sends)', () => {
  const axios = require('axios');
  let calls; let saved;
  beforeAll(() => {
    process.env.MONNIFY_API_KEY = 'MK_TEST_KEY'; process.env.MONNIFY_SECRET_KEY = 'monnify-test-secret';
    process.env.MONNIFY_CONTRACT_CODE = '1234567890'; process.env.MONNIFY_WALLET_ACCOUNT = '8000000001';
    process.env.MONNIFY_BASE_URL = 'https://sandbox.monnify.com';
    saved = { post: axios.post, get: axios.get }; calls = [];
    axios.post = async (url, body, cfg) => {
      calls.push({ m: 'POST', url, body, headers: cfg?.headers });
      if (url.endsWith('/api/v1/auth/login')) return { data: { requestSuccessful: true, responseBody: { accessToken: 'tok123', expiresIn: 3600 } } };
      if (url.endsWith('/init-transaction')) return { data: { requestSuccessful: true, responseBody: { checkoutUrl: 'https://sandbox.monnify.com/checkout/x', transactionReference: 'MNFY|1' } } };
      if (url.endsWith('/api/v2/disbursements/single')) return { data: { requestSuccessful: true, responseBody: { reference: body.reference, status: 'SUCCESS' } } };
      if (url.endsWith('/api/v1/refunds/initiate-refund')) return { data: { requestSuccessful: true, responseBody: { refundStatus: 'IN_PROGRESS' } } };
      throw new Error('unexpected ' + url);
    };
    axios.get = async (url, cfg) => { calls.push({ m: 'GET', url, params: cfg?.params }); return { data: { requestSuccessful: true, responseBody: { paymentStatus: 'PAID', amountPaid: '5000.00', currencyCode: 'NGN', transactionReference: 'MNFY|1' } } }; };
  });
  afterAll(() => { axios.post = saved.post; axios.get = saved.get; });

  test('signs in with the API key, starts, checks, pays out and refunds', async () => {
    const m = require('../../services/escrow').get('monnify');
    const init = await m.initializePayment({ reference: 'PUR-1', amount: 5000, email: 'a@b.ng', name: 'Ada', callbackUrl: 'https://app/cb' });
    expect(init.authorizationUrl).toMatch(/checkout/);
    const login = calls.find((c) => c.url.endsWith('/auth/login'));
    expect(login.headers.Authorization).toBe('Basic ' + Buffer.from('MK_TEST_KEY:monnify-test-secret').toString('base64'));
    const start = calls.find((c) => c.url.endsWith('/init-transaction'));
    expect(start.body).toMatchObject({ amount: 5000, paymentReference: 'PUR-1', contractCode: '1234567890', currencyCode: 'NGN', redirectUrl: 'https://app/cb' });
    expect(start.headers.Authorization).toBe('Bearer tok123');

    const v = await m.verifyPayment('PUR-1');
    expect(v).toMatchObject({ paid: true, amount: 5000 });
    expect(calls.find((c) => c.m === 'GET').params).toEqual({ paymentReference: 'PUR-1' });

    await Database.query("INSERT INTO seller_bank_accounts (id, user_id, bank_name, bank_code, account_number, account_name, is_verified) VALUES (UUID(), ?, 'GTBank', '058', '0123456789', 'Seller', 1)", [state().users.user.id]);
    const out = await m.release({ sellerId: state().users.user.id, amount: 4750, reference: 'PAYOUT-1' });
    expect(out.success).toBe(true);
    expect(calls.find((c) => c.url.endsWith('/disbursements/single')).body).toMatchObject({ amount: 4750, destinationBankCode: '058', destinationAccountNumber: '0123456789', sourceAccountNumber: '8000000001' });

    const ref = await m.refund({ providerReference: 'MNFY|1', amount: 5000, reference: 'REFUND-1' });
    expect(ref.success).toBe(true);
    expect(calls.find((c) => c.url.endsWith('/initiate-refund')).body).toMatchObject({ transactionReference: 'MNFY|1', refundAmount: 5000 });
  });
});
