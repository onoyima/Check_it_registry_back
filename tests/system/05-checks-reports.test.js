// Checking items: your own items are free and give a certificate for a
// buyer; other people's items are free for the admin's number of checks,
// then paid. Every check records the person's photo, location, IP address
// and browser ID. Then reporting an item stolen, and what everyone sees.
const { api, auth, state, Database, registerItem, confirmItem, expectStatus, makeImei, payInvoice, outbox, createAccount, selfie } = require('./helpers');
const PaystackService = require('../../services/PaystackService');
const prembly = require('./prembly-fake');
prembly.install();

// Stand-in for Paystack's API: hand back a checkout link (no network)
beforeAll(() => {
  PaystackService.initializeTransaction = async ({ reference }) => ({ status: true, data: { authorization_url: `https://checkout.paystack.test/${reference}`, reference } });
});

const BROWSER_ID = 'systemtestsbrowser01';
let photo;
beforeAll(async () => { photo = await selfie(); });
const checkBody = (identifier, extra = {}) => ({
  deviceIdentifier: identifier,
  checkerLocation: { latitude: 6.5244, longitude: 3.3792, accuracy: 20 },
  deviceFingerprint: { visitorId: 'system-tests', userAgent: 'system-tests' },
  networkInfo: { ip: '102.89.1.10' },
  checkReason: 'purchase_check',
  selfie: photo,
  ...extra,
});
const headersFor = (who) => (typeof who === 'string' ? auth(who) : { Authorization: `Bearer ${who.token}` });
const check = (who, id, extra) => api().post('/api/public-check/enhanced').set(headersFor(who)).set('X-Device-Id', BROWSER_ID).send(checkBody(id, extra));
const setPrice = (key, value) => Database.query('UPDATE system_settings SET setting_value = ? WHERE setting_key = ?', [String(value), key]);

describe('checking items', () => {
  let phone;
  beforeAll(async () => {
    phone = await registerItem('user', { category: 'smartphone', brand: 'Infinix', model: 'Note 40', imei: makeImei() });
    await confirmItem('user', phone.id);
  });

  test('a check needs a location, fingerprint and a photo of the person', async () => {
    expectStatus(await api().post('/api/public-check/enhanced').set(auth('user2')).send({ deviceIdentifier: phone.imei }), 400);
    expectStatus(await check('user2', phone.imei, { checkerLocation: {} }), 400);
    const noPhoto = expectStatus(await check('user2', phone.imei, { selfie: undefined }), 400);
    expect(noPhoto.body.error).toMatch(/photo/i);
    expectStatus(await check('user2', phone.imei, { selfie: 'data:image/jpeg;base64,AAAA' }), 400);
    expectStatus(await check('user2', phone.imei, { selfie: 'data:text/html;base64,' + Buffer.from('<b>x</b>'.repeat(300)).toString('base64') }), 400);
  });

  test('a registered item shows no reports and its ownership level', async () => {
    const r = expectStatus(await check('user2', phone.imei), 200);
    expect(r.body.deviceStatus).toBe('legitimate');
    expect(r.body.ownershipLevel).toBe('registered');
    expect(r.body.ownItem).toBe(false);
    expect(r.body.certificate).toBeFalsy(); // only owners get a certificate
  });

  test('an unknown number shows "not registered"', async () => {
    const r = expectStatus(await check('user2', makeImei()), 200);
    expect(r.body.deviceStatus === 'not_found' || r.body.success === false).toBe(true);
  });

  test('each check records the photo, live location, the IP our server saw, the browser ID; no made-up MAC', async () => {
    const r = expectStatus(await check('user2', phone.imei), 200);
    const [log] = await Database.query('SELECT * FROM device_check_logs WHERE id = ?', [r.body.checkId]);
    expect(log.checker_user_id).toBe(state().users.user2.id);
    expect(Number(log.latitude)).toBeCloseTo(6.5244, 3);
    expect(Number(log.longitude)).toBeCloseTo(3.3792, 3);
    expect(log.ip_address).toBe('127.0.0.1');          // what the server saw
    expect(log.reported_ip).toBe('102.89.1.10');       // what the browser claimed
    expect(log.browser_device_id).toBe(BROWSER_ID);
    expect(log.mac_address).toBeNull();
    expect(log.selfie_url).toMatch(/^\/uploads\/selfies\/.+\.jpg$/);
    expect(log.searched_identifier).toBe(phone.imei);
    expect(Number(log.is_own_item)).toBe(0);
    // the photo is private: the checker and staff can open it, the item's owner can't
    const file = log.selfie_url.replace('/uploads/', '/api/files/view/');
    expectStatus(await api().get(file).set(auth('user2')), 200);
    expectStatus(await api().get(file).set(auth('admin')), 200);
    expectStatus(await api().get(file).set(auth('lea')), 200);
    expect([401, 403, 404]).toContain((await api().get(file).set(auth('user'))).status);
  });

  test('the owner can see who checked the item, but not their photo or network details', async () => {
    const r = expectStatus(await api().get(`/api/public-check/history?device_id=${phone.id}`).set(auth('user')), 200);
    const c = r.body.data.checks[0];
    expect(c.checker_user_id).toBe(state().users.user2.id);
    expect(c.latitude).toBeTruthy();
    for (const f of ['selfie_url', 'ip_address', 'reported_ip', 'browser_device_id', 'user_agent']) expect(c[f]).toBeUndefined();
    const staff = expectStatus(await api().get(`/api/public-check/history?device_id=${phone.id}`).set(auth('lea')), 200);
    expect(staff.body.data.checks[0].selfie_url).toBeTruthy();
    // the admin item page lists the checks with the photo and details
    const adm = expectStatus(await api().get(`/api/admin-dashboard/devices/${phone.id}`).set(auth('admin')), 200);
    const hist = adm.body.check_history || adm.body.data?.check_history || [];
    expect(hist.length).toBeGreaterThan(0);
    expect(hist[0]).toMatchObject({ ip_address: '127.0.0.1', browser_device_id: BROWSER_ID });
    expect(hist[0].selfie_url).toBeTruthy();
  });

  test('nobody else can see who checked the item, or open someone else\'s check', async () => {
    expectStatus(await api().get(`/api/public-check/history?device_id=${phone.id}`).set(auth('user2')), 403);
    expectStatus(await api().get(`/api/public-check/history?identifier=${phone.imei}`).set(auth('user2')), 403);
    expectStatus(await api().get(`/api/public-check/history?device_id=${phone.id}`).set(auth('lea')), 200);
    const mine = expectStatus(await api().get('/api/public-check/mine').set(auth('user2')), 200);
    const one = mine.body.data.checks.find((c) => c.device_id === phone.id);
    expect(one).toBeTruthy();
    expectStatus(await api().get(`/api/public-check/report/${one.id}`).set(auth('user2')), 200);   // the checker
    const owner = expectStatus(await api().get(`/api/public-check/report/${one.id}`).set(auth('user')), 200); // the owner
    expect(owner.body.data.check.selfie_url).toBeUndefined();
    expectStatus(await api().get(`/api/public-check/report/${one.id}`).set(auth('business')), 404); // a stranger
  });

  test('the old header-based check is closed', async () => {
    expectStatus(await api().get(`/api/public-check?imei=${phone.imei}`).set(auth('user2')), 410);
  });
});

describe('what checks cost', () => {
  test("own items are always free; other people's: the admin's free number, then the admin's price", async () => {
    await setPrice('device_check_free_others', 3);
    await setPrice('device_check_fee', 150);
    const buyer = await createAccount('user2');
    const seller = await createAccount('user');
    const mine = await registerItem('user2', { category: 'smartphone', brand: 'Tecno', model: 'Camon 30', imei: makeImei() });
    const theirs = await registerItem('user', { category: 'smartphone', brand: 'Itel', model: 'S25', imei: makeImei() });
    await confirmItem('user', theirs.id);

    let a = expectStatus(await api().get('/api/public-check/allowance').set(headersFor(buyer)), 200);
    expect(a.body).toMatchObject({ freeLimit: 3, used: 0, remaining: 3, fee: 150 });

    for (let i = 0; i < 3; i++) {
      const r = expectStatus(await check(buyer, theirs.imei), 200);
      expect(r.body.requiresPayment).toBeFalsy();
    }
    a = expectStatus(await api().get('/api/public-check/allowance').set(headersFor(buyer)), 200);
    expect(a.body.remaining).toBe(0);

    // the 4th check of someone else's item asks for the admin's price
    const ask = expectStatus(await check(buyer, theirs.imei), 200);
    expect(ask.body).toMatchObject({ requiresPayment: true, amount: 150 });
    // ...an unknown number counts as someone else's too
    expect(expectStatus(await check(buyer, makeImei()), 200).body.requiresPayment).toBe(true);

    // but checking your own item is still free, and gives a certificate
    const own = expectStatus(await check({ token: state().users.user2.token }, mine.imei), 200);
    expect(own.body.ownItem).toBe(true);
    expect(own.body.requiresPayment).toBeFalsy();
    expect(own.body.certificate.code).toMatch(/^PO-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // pay, and the same check goes through once
    const inv = expectStatus(await api().post('/api/revenue-admin/create-invoice').set(headersFor(buyer)).send({ fee_type: 'device_check' }), 201);
    expect(inv.body.amount).toBe(150);
    expectStatus(await check(buyer, theirs.imei, { pay_by_pass: inv.body.reference }), 402); // not paid yet
    await payInvoice(inv.body.reference, inv.body.amount);
    const paid = expectStatus(await check(buyer, theirs.imei, { pay_by_pass: inv.body.reference }), 200);
    expect(paid.body.deviceStatus).toBe('legitimate');
    const [log] = await Database.query('SELECT fee_paid, is_paid FROM device_check_logs WHERE id = ?', [paid.body.checkId]);
    expect(Number(log.fee_paid)).toBe(150);
    expectStatus(await check(buyer, theirs.imei, { pay_by_pass: inv.body.reference }), 402); // one payment, one check
    void seller;
  });

  test('if the admin has not set the price, the paid check is refused (never charged a made-up amount)', async () => {
    const buyer = await createAccount('user2');
    await setPrice('device_check_free_others', 0);
    await Database.query("UPDATE system_settings SET setting_value = '' WHERE setting_key = 'device_check_fee'");
    try {
      const theirs = await registerItem('user', { category: 'smartphone', brand: 'Nokia', model: 'G42', imei: makeImei() });
      const r = await check(buyer, theirs.imei);
      expect(r.status).toBe(503);
      expect(r.body.error).toMatch(/hasn't been set/);
      expectStatus(await api().post('/api/revenue-admin/create-invoice').set(headersFor(buyer)).send({ fee_type: 'device_check' }), 503);
    } finally {
      await setPrice('device_check_fee', 100);
      await setPrice('device_check_free_others', 3);
    }
  });
});

describe('check certificates (hand-to-hand sales)', () => {
  test('the seller checks their own item; the buyer verifies the code for free and sees what changed', async () => {
    const seller = await createAccount('user');
    const buyer = await createAccount('user2');
    const phone = (await api().post('/api/device-management').set(headersFor(seller)).send({ category: 'smartphone', brand: 'Apple', model: 'iPhone 13', imei: makeImei() })).body;
    const own = expectStatus(await check(seller, phone.imei), 200);
    const code = own.body.certificate.code;

    const r = expectStatus(await api().get(`/api/public-check/certificate/${code.toLowerCase().replace(/-/g, ' ')}`).set(headersFor(buyer)), 200);
    expect(r.body.certificate).toMatchObject({ code, ownerName: 'Ada Tester', stillOwnedByIssuer: true, reportedNow: null, heldByProveOwnership: false });
    expect(r.body.certificate.item).toMatchObject({ brand: 'Apple', model: 'iPhone 13', identifierEnding: phone.imei.slice(-4) });
    expect(JSON.stringify(r.body)).not.toContain(phone.imei); // only the last 4 digits

    // after the item changes hands, the certificate says so
    await Database.query('UPDATE devices SET user_id = ? WHERE id = ?', [buyer.id, phone.id]);
    const later = expectStatus(await api().get(`/api/public-check/certificate/${code}`).set(headersFor(buyer)), 200);
    expect(later.body.certificate.stillOwnedByIssuer).toBe(false);

    expectStatus(await api().get('/api/public-check/certificate/PO-ZZZZ-ZZZZ').set(headersFor(buyer)), 404);
    expectStatus(await api().get(`/api/public-check/certificate/${code}`), 401);
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
    const r = expectStatus(await check(await createAccount('user2'), phone.imei), 200);
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
