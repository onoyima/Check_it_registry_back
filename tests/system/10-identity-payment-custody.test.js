// Reports: every report is paid and every report confirms identity with the
// NIN; Prembly is used once per number. Reported items are held by
// ProveOwnership until the owner pays the release fee. Businesses verify
// with their CAC number the same way.
const { api, Database, createAccount, expectStatus, makeImei, makeSerial, payInvoice } = require('./helpers');
const PaystackService = require('../../services/PaystackService');
const IdentityService = require('../../services/IdentityService');
const prembly = require('./prembly-fake');

beforeAll(() => {
  prembly.install();
  PaystackService.initializeTransaction = async ({ reference }) => ({ status: true, data: { authorization_url: `https://checkout.paystack.test/${reference}`, reference } });
});

const as = (acct) => ({ Authorization: `Bearer ${acct.token}` });
async function item(acct) {
  const r = await api().post('/api/device-management').set(as(acct)).send({ category: 'smartphone', brand: 'Samsung', model: 'A35', imei: makeImei() });
  expect(r.status).toBe(201);
  const token = Database.generateJWT({ type: 'device_verify', device_id: r.body.id, user_id: acct.id });
  await api().post('/api/device-management/verify-device-link').send({ token });
  return r.body;
}
async function paid(acct, fee = 'report_verification_fee') {
  const inv = expectStatus(await api().post('/api/revenue-admin/create-invoice').set(as(acct)).send({ fee_type: fee }), 201);
  await payInvoice(inv.body.reference, inv.body.amount);
  return inv.body.reference;
}
const report = (acct, device, extra = {}) => api().post('/api/report-management').set(as(acct)).send({
  device_id: device.id, report_type: 'stolen', description: 'Taken from my bag in a danfo', occurred_at: new Date().toISOString(), location: 'Yaba, Lagos', ...extra,
});

describe('every report: pay, then confirm identity', () => {
  test('the first report looks the NIN up once; the next report pays again and does not', async () => {
    const ada = await createAccount('user');
    const nin = prembly.addPerson('Ada', 'Tester');
    const [p1, p2] = [await item(ada), await item(ada)];

    // no payment yet: asked to pay
    const ask = expectStatus(await report(ada, p1), 200);
    expect(ask.body.requiresPayment).toBe(true);
    expect(ask.body.feeType).toBe('report_verification_fee');

    // paid, but no NIN: asked for it
    const ref1 = await paid(ada);
    expectStatus(await report(ada, p1, { pay_by_pass: ref1 }), 400);
    // paid + NIN: filed; Prembly called once
    expectStatus(await report(ada, p1, { pay_by_pass: ref1, nin }), 201, 200);
    expect(prembly.callsFor(nin)).toBe(1);

    // second report: the same payment can't be used again
    const again = await report(ada, p2, { pay_by_pass: ref1, nin });
    expect([402, 200]).toContain(again.status);
    expect(again.body.requiresPayment).toBe(true);
    // new payment + NIN again: filed, and Prembly was NOT called again
    const ref2 = await paid(ada);
    expectStatus(await report(ada, p2, { pay_by_pass: ref2, nin }), 201, 200);
    expect(prembly.callsFor(nin)).toBe(1);

    const [{ n }] = await Database.query("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = 'report_verification_fee'", [ada.id]);
    expect(Number(n)).toBe(2);
  });

  test('a wrong NIN on a later report fails, and the payment is kept for the retry', async () => {
    const ada = await createAccount('user');
    const nin = prembly.addPerson('Ada', 'Tester');
    expectStatus(await api().post('/api/security/nin/verify').set(as(ada)).send({ nin }), 200);
    const phone = await item(ada);
    const ref = await paid(ada);
    const wrong = await report(ada, phone, { pay_by_pass: ref, nin: '12345678901' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.identityFailed).toBe(true);
    expect(wrong.body.paid).toBe(true);
    // same payment, right NIN: works
    expectStatus(await report(ada, phone, { pay_by_pass: ref, nin }), 201, 200);
  });

  test('names that don\'t match fail, the NIN is not looked up twice, and the wording never changes', async () => {
    const ada = await createAccount('user');
    const nin = prembly.addPerson('Grace', 'Okon'); // someone else's NIN
    const first = await api().post('/api/security/nin/verify').set(as(ada)).send({ nin });
    expect(first.status).toBe(400);
    const second = await api().post('/api/security/nin/verify').set(as(ada)).send({ nin });
    expect(prembly.callsFor(nin)).toBe(1);
    expect(second.body.error).toBe(first.body.error);
    expect(first.body.error).toBe(IdentityService.MESSAGES.mismatch);
    expect(JSON.stringify(first.body)).not.toMatch(/prembly|once|first time|already/i);
  });

  test('a NIN confirmed for one account cannot be used by another', async () => {
    const ada = await createAccount('user');
    const nin = prembly.addPerson('Ada', 'Tester');
    expectStatus(await api().post('/api/security/nin/verify').set(as(ada)).send({ nin }), 200);
    const other = await createAccount('user'); // also called Ada Tester
    const r = await api().post('/api/security/nin/verify').set(as(other)).send({ nin });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(IdentityService.MESSAGES.in_use);
    expect(prembly.callsFor(nin)).toBe(1);
  });

  test('after 3 failed tries in a day, it pauses', async () => {
    const ada = await createAccount('user');
    for (let i = 0; i < 3; i++) await api().post('/api/security/nin/verify').set(as(ada)).send({ nin: prembly.addPerson('Bola', `X${i}`) });
    const r = await api().post('/api/security/nin/verify').set(as(ada)).send({ nin: prembly.addPerson('Ada', 'Tester') });
    expect(r.status).toBe(429);
  });

  test('once identity is confirmed, the name can\'t be changed', async () => {
    const ada = await createAccount('user');
    expectStatus(await api().post('/api/security/nin/verify').set(as(ada)).send({ nin: prembly.addPerson('Ada', 'Tester') }), 200);
    expectStatus(await api().put('/api/auth/profile').set(as(ada)).send({ first_name: 'Someone', last_name: 'Else' }), 403);
    // other details still can
    expectStatus(await api().put('/api/auth/profile').set(as(ada)).send({ first_name: 'Ada', last_name: 'Tester', region: 'Lagos' }), 200);
    const st = expectStatus(await api().get('/api/security/verification-status').set(as(ada)), 200);
    expect(st.body.identity_confirmed).toBe(true);
    expect(JSON.stringify(st.body)).not.toMatch(/last_digits|\*\*\*\*/);
  });

  test('NINs are stored encrypted, never in plain text', async () => {
    const ada = await createAccount('user');
    const nin = prembly.addPerson('Ada', 'Tester');
    expectStatus(await api().post('/api/security/nin/verify').set(as(ada)).send({ nin }), 200);
    const rows = await Database.query('SELECT * FROM identity_records WHERE user_id = ?', [ada.id]);
    expect(rows.length).toBe(1);
    expect(JSON.stringify(rows)).not.toContain(nin);
    expect(JSON.stringify(rows)).not.toMatch(/Tester/);
    const inv = await Database.query('SELECT metadata FROM payment_invoices WHERE user_id = ?', [ada.id]);
    expect(JSON.stringify(inv)).not.toContain(nin);
  });
});

describe('reported items are held by ProveOwnership', () => {
  async function reported(acct) {
    const nin = prembly.addPerson('Ada', 'Tester');
    const phone = await item(acct);
    expectStatus(await report(acct, phone, { pay_by_pass: await paid(acct), nin }), 201, 200);
    return phone;
  }
  const admin = async () => createAccount('admin');

  test('held → found → owner pays the release fee → handed over → back in the owner\'s name', async () => {
    const ada = await createAccount('user');
    const phone = await reported(ada);
    const mine = expectStatus(await api().get('/api/custody/mine').set(as(ada)), 200);
    const c = mine.body.items.find((x) => x.device_id === phone.id);
    expect(c.status).toBe('held');

    // anyone checking is told it is held by ProveOwnership
    const checker = await createAccount('user');
    const chk = await api().post('/api/public-check/enhanced').set(as(checker)).send({
      deviceIdentifier: phone.imei, checkerLocation: { latitude: 6.5, longitude: 3.3, accuracy: 20 },
      deviceFingerprint: { visitorId: 't' }, networkInfo: { ip: '102.89.1.10', mac: '00:11:22:33:44:55' }, checkReason: 'purchase_check',
    });
    expect(chk.body.custody?.holder).toBe('ProveOwnership');

    // it can't be listed, transferred or released while held
    expectStatus(await api().post(`/api/device-management/${phone.id}/release`).set(as(ada)), 409, 400);

    // the owner can't hand it over to themselves; an admin marks it found
    expectStatus(await api().post(`/api/custody/${c.id}/found`).set(as(ada)), 403);
    const adm = await admin();
    expectStatus(await api().post(`/api/custody/${c.id}/found`).set(as(adm)).send({ note: 'Recovered at Alaba market' }), 200);
    // handover before payment is refused
    expectStatus(await api().post(`/api/custody/${c.id}/handover`).set(as(adm)), 409);

    // owner pays the release fee
    const ask = expectStatus(await api().post(`/api/custody/${c.id}/release`).set(as(ada)), 200);
    expect(ask.body.requiresPayment).toBe(true);
    expect(ask.body.feeType).toBe('device_release_fee');
    const paidRes = expectStatus(await api().post(`/api/custody/${c.id}/release`).set(as(ada)).send({ pay_by_pass: await paid(ada, 'device_release_fee') }), 200);
    expect(paidRes.body.status).toBe('release_paid');

    expectStatus(await api().post(`/api/custody/${c.id}/handover`).set(as(adm)), 200);
    const [d] = await Database.query('SELECT status FROM devices WHERE id = ?', [phone.id]);
    expect(d.status).toBe('verified');
    const [r] = await Database.query("SELECT status FROM reports WHERE device_id = ? AND report_type = 'stolen'", [phone.id]);
    expect(r.status).toBe('resolved');
    const [t] = await Database.query("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = 'device_release_fee'", [ada.id]);
    expect(Number(t.n)).toBe(1);
  });

  test('the owner got it back themselves: paying the fee releases it at once', async () => {
    const ada = await createAccount('user');
    const phone = await reported(ada);
    const c = (await api().get('/api/custody/mine').set(as(ada))).body.items.find((x) => x.device_id === phone.id);
    const r = expectStatus(await api().post(`/api/custody/${c.id}/release`).set(as(ada)).send({ pay_by_pass: await paid(ada, 'device_release_fee') }), 200);
    expect(r.body.status).toBe('released');
    const [d] = await Database.query('SELECT status FROM devices WHERE id = ?', [phone.id]);
    expect(d.status).toBe('verified');
  });

  test('police resolving the case means it waits for the release fee; a dismissed report lets it go free', async () => {
    const ada = await createAccount('user');
    const phone = await reported(ada);
    const [rep] = await Database.query("SELECT case_id FROM reports WHERE device_id = ? AND report_type = 'stolen'", [phone.id]);
    const adm = await admin();
    expectStatus(await api().put(`/api/report-management/${rep.case_id}`).set(as(adm)).send({ status: 'resolved' }), 200);
    let [c] = await Database.query('SELECT status FROM device_custody WHERE device_id = ?', [phone.id]);
    expect(c.status).toBe('found');
    let [d] = await Database.query('SELECT status FROM devices WHERE id = ?', [phone.id]);
    expect(d.status).toBe('found');

    const bola = await createAccount('user');
    const phone2 = await reported(bola);
    const [rep2] = await Database.query("SELECT case_id FROM reports WHERE device_id = ? AND report_type = 'stolen'", [phone2.id]);
    expectStatus(await api().put(`/api/report-management/${rep2.case_id}`).set(as(adm)).send({ status: 'dismissed' }), 200);
    [c] = await Database.query('SELECT status FROM device_custody WHERE device_id = ?', [phone2.id]);
    expect(c.status).toBe('closed');
    [d] = await Database.query('SELECT status FROM devices WHERE id = ?', [phone2.id]);
    expect(d.status).toBe('verified');
  });

  test('an admin can waive the release fee', async () => {
    const ada = await createAccount('user');
    const phone = await reported(ada);
    const adm = await admin();
    const desk = expectStatus(await api().get('/api/custody/desk').set(as(adm)), 200);
    const c = desk.body.items.find((x) => x.device_id === phone.id);
    expect(c).toBeTruthy();
    expectStatus(await api().post(`/api/custody/${c.id}/waive`).set(as(ada)), 403);
    const w = expectStatus(await api().post(`/api/custody/${c.id}/waive`).set(as(adm)), 200);
    expect(w.body.status).toBe('released');
  });
});

describe('business verification', () => {
  async function businessWithProfile(name) {
    const biz = await createAccount('business'); // Chidi Tester
    expectStatus(await api().post('/api/business-profile/register').set(as(biz)).send({ businessName: name, registrationNumber: 'RC1' }), 200);
    return biz;
  }

  test('pays once, a wrong number fails without using the payment, then the right one passes; Prembly once per number', async () => {
    const biz = await businessWithProfile('Chidi Phones Limited');
    const good = prembly.addCompany('CHIDI PHONES LTD', { directors: [{ name: 'Chidi Tester' }] });
    const other = prembly.addCompany('Some Other Company Ltd', { directors: [{ name: 'Chidi Tester' }] });

    const ask = expectStatus(await api().post('/api/security/cac/verify').set(as(biz)).send({ rcNumber: good }), 200);
    expect(ask.body.requiresPayment).toBe(true);
    const ref = await paid(biz, 'business_verification_fee');

    const bad = await api().post('/api/security/cac/verify').set(as(biz)).send({ rcNumber: other, pay_by_pass: ref });
    expect(bad.status).toBe(400);
    expect(bad.body.paid).toBe(true);
    // trying the same wrong number again: no new Prembly call
    await api().post('/api/security/cac/verify').set(as(biz)).send({ rcNumber: other, pay_by_pass: ref });
    expect(prembly.callsFor(other)).toBe(1);

    const ok = expectStatus(await api().post('/api/security/cac/verify').set(as(biz)).send({ rcNumber: `RC ${good}`, pay_by_pass: ref }), 200);
    expect(ok.body.status).toBe('passed');
    const [bp] = await Database.query('SELECT verification_status FROM business_profiles WHERE user_id = ?', [biz.id]);
    expect(bp.verification_status).toBe('verified');
    // name is now locked
    expectStatus(await api().post('/api/business-profile/register').set(as(biz)).send({ businessName: 'New Name Ltd', registrationNumber: good }), 403);
  });

  test('the account holder must be a director, or confirm their own NIN first', async () => {
    const biz = await businessWithProfile('Lagos Gadgets Limited');
    const rc = prembly.addCompany('Lagos Gadgets Ltd', { directors: [{ name: 'Grace Okon' }] });
    const ref = await paid(biz, 'business_verification_fee');
    const r1 = await api().post('/api/security/cac/verify').set(as(biz)).send({ rcNumber: rc, pay_by_pass: ref });
    expect(r1.body.error).toBe(IdentityService.MESSAGES.not_director);
    expectStatus(await api().post('/api/security/nin/verify').set(as(biz)).send({ nin: prembly.addPerson('Chidi', 'Tester') }), 200);
    expectStatus(await api().post('/api/security/cac/verify').set(as(biz)).send({ rcNumber: rc, pay_by_pass: ref }), 200);
    expect(prembly.callsFor(rc)).toBe(1);
  });

  test('a business reports with its registration number, paying each time', async () => {
    const biz = await businessWithProfile('Ikeja Devices Limited');
    const rc = prembly.addCompany('Ikeja Devices Ltd', { directors: [{ name: 'Chidi Tester' }] });
    expectStatus(await api().post('/api/security/cac/verify').set(as(biz)).send({ rcNumber: rc, pay_by_pass: await paid(biz, 'business_verification_fee') }), 200);
    const phone = await item(biz);
    expectStatus(await report(biz, phone, { pay_by_pass: await paid(biz), rc_number: rc }), 201, 200);
    expect(prembly.callsFor(rc)).toBe(1);
  });
});
