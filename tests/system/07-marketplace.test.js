// Marketplace: only verified owners sell; browsing and filters; buying with
// Paystack and escrow; delivery confirmation moves the item to the buyer.
const { api, auth, state, Database, registerItem, confirmItem, expectStatus, makeImei, payInvoice, PNG } = require('./helpers');
const fake = require('./paystack-fake');
beforeAll(() => fake.install());

async function verifiedItem(who, body) {
  const d = await registerItem(who, body);
  await confirmItem(who, d.id);
  await Database.query("UPDATE devices SET ownership_level = 'verified_owner' WHERE id = ?", [d.id]);
  return d;
}

describe('marketplace', () => {
  test('only verified owners can list', async () => {
    const d = await registerItem('business', { category: 'smartphone', brand: 'Apple', model: 'iPhone 14', imei: makeImei() });
    await confirmItem('business', d.id);
    const r = expectStatus(await api().post('/api/marketplace').set(auth('business')).send({ device_id: d.id, title: 'iPhone 14', price: 650000, condition: 'good' }), 400);
    expect(r.body.error).toMatch(/verified owner/i);
  });

  test('list with photos, browse, filter by type, open a listing, message the seller', async () => {
    const d = await verifiedItem('business', { category: 'smartphone', brand: 'Samsung', model: 'S24 Ultra', imei: makeImei() });
    const img = expectStatus(await api().post('/api/files/upload/device-image').set(auth('business')).attach('device_image', PNG, { filename: 'p.png', contentType: 'image/png' }), 200);
    expect(img.body.file.url).toMatch(/^\/uploads\/devices\//);
    // product photos are public
    expectStatus(await api().get(img.body.file.url), 200);
    const listing = expectStatus(await api().post('/api/marketplace').set(auth('business')).send({ device_id: d.id, title: 'Samsung S24 Ultra 256GB', description: 'Clean, with box', price: 980000, condition: 'excellent', currency: 'NGN', images: [img.body.file.url] }), 201);
    const id = listing.body.id || listing.body.listing?.id;
    expect(id).toBeTruthy();
    // the same item cannot be listed twice
    expectStatus(await api().post('/api/marketplace').set(auth('business')).send({ device_id: d.id, title: 'again', price: 1 }), 400);

    const all = expectStatus(await api().get('/api/marketplace'), 200);
    const found = all.body.find((l) => l.id === id);
    expect(found.ownership_level).toBe('verified_owner');
    expect(found.images[0]).toBe(img.body.file.url);
    const phones = expectStatus(await api().get('/api/marketplace?category=mobile_phone'), 200);
    expect(phones.body.some((l) => l.id === id)).toBe(true);
    const cars = expectStatus(await api().get('/api/marketplace?category=vehicle'), 200);
    expect(cars.body.some((l) => l.id === id)).toBe(false);
    expect((await api().get('/api/marketplace?search=S24')).body.some((l) => l.id === id)).toBe(true);
    expectStatus(await api().get(`/api/marketplace/${id}`), 200);

    expectStatus(await api().post(`/api/marketplace/${id}/messages`).set(auth('user2')).send({ message: 'Is it still available?', content: 'Is it still available?' }), 200, 201);
    expectStatus(await api().get(`/api/marketplace/${id}/messages`).set(auth('business')), 200);
  });

  test('buy → pay → escrow → buyer confirms delivery → item is the buyer’s', async () => {
    const buyer = state().users.user2;
    const d = await verifiedItem('business', { category: 'smartphone', brand: 'Apple', model: 'iPhone 15 Pro', imei: makeImei() });
    const listing = expectStatus(await api().post('/api/marketplace').set(auth('business')).send({ device_id: d.id, title: 'iPhone 15 Pro', price: 1200000, condition: 'excellent' }), 201);
    const id = listing.body.id || listing.body.listing?.id;

    expectStatus(await api().post(`/api/marketplace/${id}/initiate-purchase`).set(auth('business')), 400); // own listing
    const start = expectStatus(await api().post(`/api/marketplace/${id}/initiate-purchase`).set(auth('user2')), 200);
    const ref = start.body.reference;
    expect(start.body.authorization_url || start.body.authorizationUrl || start.body.paymentUrl).toBeTruthy();

    // completing without paying is refused
    expectStatus(await api().post('/api/marketplace/complete-purchase').set(auth('user2')).send({ reference: ref }), 400);
    fake.markPaid(ref);
    await payInvoice(ref, fake.payments.get(ref).amount); // Paystack's webhook
    const orders = expectStatus(await api().get('/api/escrow/buyer-orders').set(auth('user2')), 200);
    const list = orders.body.data || orders.body.orders || orders.body;
    const order = list.find((o) => o.listing_id === id);
    expect(order).toBeTruthy();
    expect(order.escrow_status).toBe('held');
    const [stillSeller] = await Database.query('SELECT user_id FROM devices WHERE id = ?', [d.id]);
    expect(stillSeller.user_id).toBe(state().users.business.id);

    expectStatus(await api().put(`/api/escrow/${order.escrow_id}/confirm-delivery`).set(auth('business')), 400, 403);
    expectStatus(await api().put(`/api/escrow/${order.escrow_id}/confirm-delivery`).set(auth('user2')), 200);
    const [now] = await Database.query('SELECT user_id, ownership_level FROM devices WHERE id = ?', [d.id]);
    expect(now.user_id).toBe(buyer.id);
    expect(now.ownership_level).toBe('verified_owner');
    expectStatus(await api().put(`/api/escrow/${order.escrow_id}/confirm-delivery`).set(auth('user2')), 400);
  });

  test('seller dashboard numbers and orders load', async () => {
    expectStatus(await api().get('/api/marketplace/seller/stats').set(auth('business')), 200);
    expectStatus(await api().get('/api/marketplace/seller/orders').set(auth('business')), 200);
    expectStatus(await api().get('/api/escrow/seller-orders').set(auth('business')), 200);
  });
});
