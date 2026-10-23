// Checking items before buying, the free-check allowance and paid checks,
// reporting an item stolen, and what everyone sees afterwards.
const { api, auth, state, Database, registerItem, confirmItem, expectStatus, makeImei, payInvoice, outbox } = require('./helpers');
const PaystackService = require('../../services/PaystackService');
const prembly = require('./prembly-fake');
prembly.install();

// Stand-in for Paystack's API: hand back a checkout link (no network)
beforeAll(() => {
  PaystackService.initializeTransaction = async ({ reference }) => ({ status: true, data: { authorization_url: `https://checkout.paystack.test/${reference}`, reference } });
});

const checkBody = (identifier, extra = {}) => ({
  deviceIdentifier: identifier,
  checkerLocation: { latitude: 6.5244, longitude: 3.3792, accuracy: 20 },
  deviceFingerprint: { visitorId: 'system-tests', userAgent: 'system-tests' },
  networkInfo: { ip: '102.89.1.10', mac: '00:11:22:33:44:55' },
  checkReason: 'purchase_check',
  ...extra,
});
const check = (who, id, extra) => api().post('/api/public-check/enhanced').set(auth(who)).send(checkBody(id, extra));

describe('checking items', () => {
  let phone;
  beforeAll(async () => {
    phone = await registerItem('user', { category: 'smartphone', brand: 'Infinix', model: 'Note 40', imei: makeImei() });
    await confirmItem('user', phone.id);
  });

  test('a check needs a location, fingerprint and network info', async () => {
    expectStatus(await api().post('/api/public-check/enhanced').set(auth('user2')).send({ deviceIdentifier: phone.imei }), 400);
    expectStatus(await check('user2', phone.imei, { checkerLocation: {} }), 400);
  });

  test('a registered item shows no reports and its ownership level', async () => {
    const r = expectStatus(await check('user2', phone.imei), 200);
    expect(r.body.deviceStatus).toBe('legitimate');
    expect(r.body.ownershipLevel).toBe('registered');
  });

  test('an unknown number shows "not registered"', async () => {
    const r = expectStatus(await check('user2', makeImei()), 200);
    expect(r.body.deviceStatus === 'not_found' || r.body.success === false).toBe(true);
  });

  test('the owner can see who checked the item', async () => {
    const r = expectStatus(await api().get(`/api/public-check/history?device_id=${phone.id}`).set(auth('user')), 200);
    expect(JSON.stringify(r.body)).toMatch(/check/i);
  });

  test('nobody else can see who checked the item, or open someone else\'s check', async () => {
    // user2 checked user's phone above; user2 is not the owner
    expectStatus(await api().get(`/api/public-check/history?device_id=${phone.id}`).set(auth('user2')), 403);
    expectStatus(await api().get(`/api/public-check/history?identifier=${phone.imei}`).set(auth('user2')), 403);
    expectStatus(await api().get(`/api/public-check/history?device_id=${phone.id}`).set(auth('lea')), 200);
    const mine = expectStatus(await api().get('/api/public-check/mine').set(auth('user2')), 200);
    const one = mine.body.data.checks.find((c) => c.device_id === phone.id);
    expect(one).toBeTruthy();
    expectStatus(await api().get(`/api/public-check/report/${one.id}`).set(auth('user2')), 200);   // the checker
    expectStatus(await api().get(`/api/public-check/report/${one.id}`).set(auth('user')), 200);    // the owner
    expectStatus(await api().get(`/api/public-check/report/${one.id}`).set(auth('business')), 404); // a stranger
  });

  test('after the free checks, a paid check works once the payment is confirmed', async () => {
    await Database.query("INSERT INTO system_settings (id, setting_key, setting_value, setting_type) VALUES (UUID(), 'device_check_free_tier', '0', 'number') ON DUPLICATE KEY UPDATE setting_value = '0'").catch(async () => {
      await Database.query("UPDATE system_settings SET setting_value = '0' WHERE setting_key = 'device_check_free_tier'");
    });
    const RevenueService = require('../../services/RevenueService');
    if (RevenueService.clearCache) RevenueService.clearCache();
    const first = expectStatus(await check('user2', phone.imei), 200);
    if (!first.body.requiresPayment) return; // fee is 0 on this install
    const inv = expectStatus(await api().post('/api/revenue-admin/create-invoice').set(auth('user2')).send({ fee_type: 'device_check' }), 201);
    expect(inv.body.authorization_url).toMatch(/^https:\/\//);
    // an unpaid reference is refused
    expectStatus(await check('user2', phone.imei, { pay_by_pass: inv.body.reference }), 402);
    await payInvoice(inv.body.reference, inv.body.amount);
    const paid = expectStatus(await check('user2', phone.imei, { pay_by_pass: inv.body.reference }), 200);
    expect(paid.body.deviceStatus).toBe('legitimate');
    // a payment unlocks one check only
    expectStatus(await check('user2', phone.imei, { pay_by_pass: inv.body.reference }), 402);
    await Database.query("UPDATE system_settings SET setting_value = '100' WHERE setting_key = 'device_check_free_tier'");
    if (RevenueService.clearCache) RevenueService.clearCache();
  });
});

describe('reporting an item stolen', () => {
  test('first report: pay, confirm identity, then everyone who checks is warned', async () => {
    const owner = state().users.user;
    const phone = await registerItem('user', { category: 'smartphone', brand: 'Samsung', model: 'A56', imei: makeImei() });
    await confirmItem('user', phone.id);
    const body = { device_id: phone.id, report_type: 'stolen', description: 'Snatched at Oshodi bus stop', occurred_at: new Date().toISOString(), location: 'Oshodi, Lagos' };

    expectStatus(await api().post('/api/report-management').set(auth('user')).send({ device_id: phone.id }), 400);
    const pay = expectStatus(await api().post('/api/report-management').set(auth('user')).send(body), 200);
    expect(pay.body.requiresPayment).toBe(true);
    const inv = expectStatus(await api().post('/api/revenue-admin/create-invoice').set(auth('user')).send({ fee_type: 'report_verification_fee' }), 201);
    await payInvoice(inv.body.reference, inv.body.amount);
    const nin = prembly.addPerson('Ada', 'Tester');
    const made = expectStatus(await api().post('/api/report-management').set(auth('user')).send({ ...body, nin, pay_by_pass: inv.body.reference }), 200, 201);
    const caseId = made.body.case_id || made.body.report?.case_id || made.body.caseId;
    expect(caseId).toBeTruthy();

    const [dev] = await Database.query('SELECT status FROM devices WHERE id = ?', [phone.id]);
    expect(dev.status).toBe('stolen');

    outbox.clear();
    const r = expectStatus(await check('user2', phone.imei), 200);
    expect(r.body.deviceStatus).toBe('stolen');
    // the owner is told where it was checked
    await new Promise((res) => setTimeout(res, 300));
    expect(outbox.messages.some((m) => m.to === owner.email)).toBe(true);

    // the report is listed for the owner and for admins
    const mine = expectStatus(await api().get('/api/user-portal/reports').set(auth('user')), 200);
    expect(mine.body.data.reports.some((x) => x.case_id === caseId)).toBe(true);
    expectStatus(await api().get(`/api/user-portal/reports/${caseId}`).set(auth('user')), 200);
    const adm = expectStatus(await api().get('/api/admin-dashboard/reports?page=1&limit=50').set(auth('admin')), 200);
    expect(JSON.stringify(adm.body)).toContain(caseId);

    // a stolen item cannot be sold or transferred
    const t = await api().post('/api/device-transfer/initiate').set(auth('user')).send({ deviceId: phone.id, buyerEmail: state().users.user2.email });
    expect(t.status).toBe(400);
  });

  test('you can only report your own items', async () => {
    const phone = await registerItem('user', { category: 'smartphone', brand: 'Tecno', model: 'Spark 30', imei: makeImei() });
    await confirmItem('user', phone.id);
    expectStatus(await api().post('/api/report-management').set(auth('user2')).send({ device_id: phone.id, report_type: 'stolen', description: 'x', occurred_at: new Date().toISOString() }), 403, 404);
  });
});

describe('there is no public check', () => {
  // Every way of looking an item up needs a signed-in account
  const lookups = [
    ['post', '/api/public-check/enhanced'],
    ['get', '/api/public-check?imei=356938035643809'],
    ['get', '/api/public-check/history?identifier=356938035643809'],
    ['get', '/api/public-check/mine'],
    ['get', '/api/found-device/check?imei=356938035643809'],
    ['post', '/api/found-device/report'],
  ];
  test.each(lookups)('%s %s refuses visitors', async (method, url) => {
    const r = await api()[method](url).send({ imei: '356938035643809', deviceIdentifier: '356938035643809' });
    expect(r.status).toBe(401);
  });
});
