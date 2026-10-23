// Registering every kind of item, the right identifier for each, duplicates,
// confirming by email link and by code, editing, release and removal.
const { api, auth, state, registerItem, confirmItem, expectStatus, latestOtp, makeImei, makeSerial, makeVin } = require('./helpers');

describe('registering items', () => {
  const cases = [
    ['phone', { category: 'smartphone', brand: 'Apple', model: 'iPhone 15', imei: makeImei() }, 'mobile_phone'],
    ['tablet', { category: 'tablet', brand: 'Samsung', model: 'Tab S9', imei: makeImei() }, 'mobile_phone'],
    ['laptop', { category: 'laptop', brand: 'Dell', model: 'XPS 14', serial: makeSerial() }, 'computer'],
    ['watch', { category: 'smartwatch', brand: 'Garmin', model: 'Fenix 8', serial: makeSerial() }, 'smart_watch'],
    ['headphones', { category: 'headphones', brand: 'Sony', model: 'WH-1000XM6', serial: makeSerial() }, 'electronics'],
    ['tv', { category: 'tv', brand: 'LG', model: 'OLED C4', serial: makeSerial() }, 'electronics'],
    ['car', { category: 'vehicle', brand: 'Toyota', model: 'Corolla', vin: makeVin(), licensePlate: 'LND123AB', year: '2018' }, 'vehicle'],
    ['motorcycle', { category: 'motorcycle', brand: 'Bajaj', model: 'Pulsar', vin: makeVin() }, 'vehicle'],
    ['jewellery', { category: 'jewelry', brand: 'Local jeweller', model: 'Gold ring', description: '18k gold ring engraved A&T 2019', estimatedValue: 450000 }, 'jewelry'],
    ['other', { category: 'others', brand: 'Honda', model: 'EU22i', description: 'Generator: red, dent on left side', serial: makeSerial() }, 'others'],
  ];

  test.each(cases)('%s registers with the right category', async (_n, body, stored) => {
    const d = await registerItem('user', body);
    expect(d.category).toBe(stored);
    expect(d.ownership_level).toBe('registered');
    expect(d.status).toBe('unverified');
  });

  test('the identifying number is required and checked', async () => {
    expectStatus(await api().post('/api/device-management').set(auth('user')).send({ category: 'smartphone', brand: 'X', model: 'Y' }), 400);
    expectStatus(await api().post('/api/device-management').set(auth('user')).send({ category: 'smartphone', brand: 'X', model: 'Y', imei: '123456789012345' }), 400);
    expectStatus(await api().post('/api/device-management').set(auth('user')).send({ category: 'laptop', brand: 'X', model: 'Y' }), 400);
    expectStatus(await api().post('/api/device-management').set(auth('user')).send({ category: 'vehicle', brand: 'X', model: 'Y', vin: 'TOO-SHORT' }), 400);
  });

  test('the same number cannot be registered twice; a claim is offered', async () => {
    const imei = makeImei();
    await registerItem('user', { category: 'smartphone', brand: 'Tecno', model: 'Camon 40', imei });
    const mine = expectStatus(await api().post('/api/device-management').set(auth('user')).send({ category: 'smartphone', brand: 'Tecno', model: 'Camon 40', imei }), 409);
    expect(mine.body.canClaim).toBeFalsy();
    const other = expectStatus(await api().post('/api/device-management').set(auth('user2')).send({ category: 'smartphone', brand: 'Tecno', model: 'Camon 40', imei }), 409);
    expect(other.body.canClaim).toBe(true);
  });

  test('confirm by email link', async () => {
    const d = await registerItem('user', { category: 'laptop', brand: 'HP', model: 'Spectre', serial: makeSerial() });
    expectStatus(await confirmItem('user', d.id), 200);
    const got = expectStatus(await api().get(`/api/device-management/${d.id}`).set(auth('user')), 200);
    expect(got.body.status).toBe('verified');
  });

  test('confirm by emailed code', async () => {
    const d = await registerItem('user', { category: 'laptop', brand: 'Asus', model: 'ZenBook', serial: makeSerial() });
    expectStatus(await api().post('/api/device-management/resend-verification').set(auth('user')).send({ device_id: d.id }), 200);
    const code = await latestOtp(state().users.user.id, 'device_verification');
    expectStatus(await api().post('/api/device-management/verify-device').set(auth('user')).send({ device_id: d.id, otp_code: code }), 200);
  });

  test('my items list shows them, others cannot see them', async () => {
    const d = await registerItem('user', { category: 'laptop', brand: 'Lenovo', model: 'ThinkPad', serial: makeSerial() });
    const list = expectStatus(await api().get('/api/user-portal/devices?limit=100').set(auth('user')), 200);
    expect(list.body.data.devices.some((x) => x.id === d.id)).toBe(true);
    expectStatus(await api().get(`/api/device-management/${d.id}`).set(auth('user2')), 404);
  });

  test('owners can edit descriptions but not identifiers or status', async () => {
    const serial = makeSerial();
    const d = await registerItem('user', { category: 'laptop', brand: 'Acer', model: 'Swift', serial });
    expectStatus(await api().put(`/api/device-management/${d.id}`).set(auth('user')).send({ color: 'Silver', serial: 'HACKED1', status: 'verified' }), 200);
    const got = (await api().get(`/api/device-management/${d.id}`).set(auth('user'))).body;
    expect(got.color).toBe('Silver');
    expect(got.serial).toBe(serial);
    expect(got.status).toBe('unverified');
  });

  test('release frees the number for a new owner', async () => {
    const serial = makeSerial();
    const d = await registerItem('user', { category: 'laptop', brand: 'MSI', model: 'Katana', serial });
    await confirmItem('user', d.id);
    expectStatus(await api().post(`/api/device-management/${d.id}/release`).set(auth('user')), 200);
    const again = await registerItem('user2', { category: 'laptop', brand: 'MSI', model: 'Katana', serial });
    expect(again.id).toBe(d.id);
  });

  test('remove an item', async () => {
    const d = await registerItem('user', { category: 'laptop', brand: 'Apple', model: 'MacBook Air', serial: makeSerial() });
    expectStatus(await api().delete(`/api/device-management/${d.id}`).set(auth('user')), 200);
    expectStatus(await api().get(`/api/device-management/${d.id}`).set(auth('user')), 404);
  });
});
