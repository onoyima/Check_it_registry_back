// Backend for the browser (end-to-end) tests.
//
//   node tests/e2e/server.js
//
// Builds a throw-away database (proveownership_e2e_test by default), creates
// one account per role, puts a few items on the marketplace so pages have
// something to show, and starts the API on E2E_API_PORT (default 5055).
// Paystack, email and SMS are replaced by local stand-ins. A few helper
// routes under /__e2e let the browser tests read the outbox and "pay" on
// Paystack's behalf. They exist only in this test server.
process.env.TEST_DB_NAME = process.env.E2E_DB_NAME || 'proveownership_e2e_test';
process.env.PORT = process.env.E2E_API_PORT || '5055';
process.env.FRONTEND_URL = process.env.E2E_FRONTEND_URL || 'http://localhost:4300';
require('../system/env');

const express = require('express');
const crypto = require('crypto');

async function seed(h) {
  const s = h.state();
  const { Database } = h;
  // A phone, a laptop and a car on the marketplace, sold by a verified owner
  const items = [
    { category: 'mobile_phone', brand: 'Apple', model: 'iPhone 14 Pro', imei: h.makeImei(), serial: h.makeSerial(), color: 'Deep Purple', storage_capacity: '256GB', price: 650000, title: 'iPhone 14 Pro 256GB — like new', condition: 'excellent' },
    { category: 'computer', brand: 'Dell', model: 'XPS 13', serial: h.makeSerial(), price: 820000, title: 'Dell XPS 13 (2023), 16GB RAM', condition: 'good' },
    { category: 'vehicle', brand: 'Toyota', model: 'Corolla', vin: h.makeVin(), license_plate: 'LND 482 KJ', year: '2016', price: 7400000, title: 'Toyota Corolla 2016, Lagos cleared', condition: 'used' },
  ];
  for (const it of items) {
    const { price, title, condition, ...device } = it;
    const d = await h.registerItem('user2', { ...device, description: title, region: 'Lagos' });
    const id = d.device?.id || d.id || d.deviceId;
    await h.confirmItem('user2', id);
    await Database.query("UPDATE devices SET ownership_level = 'verified_owner' WHERE id = ?", [id]);
    const r = await h.api().post('/api/marketplace').set(h.auth('user2')).send({
      device_id: id, title, price, location: 'Ikeja, Lagos', condition, description: `${title}. Clean, working and checked. The seller can meet in Ikeja or arrange delivery.`,
      images: [photo(it.category), photo(it.category, true)],
    });
    if (r.status >= 300) console.warn('[e2e] listing failed', r.status, r.body);
  }
  // Plenty of free checks, so repeated runs don't hit the payment step
  // (the payment step has its own test, which lowers this for a moment)
  await Database.query("UPDATE system_settings SET setting_value = '100000' WHERE setting_key = 'device_check_free_tier'");
  // One item for the main user so "My items" is not empty
  const mine = await h.registerItem('user', { category: 'mobile_phone', brand: 'Samsung', model: 'Galaxy S23', imei: h.makeImei(), serial: h.makeSerial(), region: 'Lagos' });
  await h.confirmItem('user', mine.device?.id || mine.id || mine.deviceId);
}

// Simple coloured product pictures (as data URLs), so cards have real images
// without writing anything into the uploads folder
function photo(kind, alt = false) {
  const c = { mobile_phone: ['#6d28d9', '#a78bfa', '📱'], computer: ['#0f766e', '#5eead4', '💻'], vehicle: ['#b45309', '#fcd34d', '🚗'] }[kind] || ['#334155', '#94a3b8', '📦'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/><circle cx="${alt ? 600 : 200}" cy="${alt ? 200 : 620}" r="150" fill="#ffffff22"/><text x="400" y="470" font-size="260" text-anchor="middle">${c[2]}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

(async () => {
  const globalSetup = require('../system/global-setup');
  await globalSetup();
  require('../system/paystack-fake').install();
  const h = require('../system/helpers');
  await seed(h);

  const { app } = require('../../app');
  const tools = express.Router();
  tools.use(express.json());
  tools.get('/state', (req, res) => res.json(h.state()));
  tools.get('/outbox', (req, res) => res.json(h.outbox.messages.filter((m) => !req.query.to || String(m.to).includes(req.query.to))));
  tools.get('/otp', async (req, res) => {
    const [row] = await h.Database.query('SELECT otp_code FROM otps WHERE user_id = ? AND (? = \'\' OR otp_type = ?) ORDER BY created_at DESC LIMIT 1', [req.query.user, req.query.type || '', req.query.type || '']);
    res.json({ otp: row?.otp_code || null });
  });
  tools.get('/transfer-codes', async (req, res) => {
    const [row] = await h.Database.query('SELECT otp_code, buyer_otp_code FROM ownership_transfers WHERE device_id = ? ORDER BY created_at DESC LIMIT 1', [req.query.device]);
    res.json(row || {});
  });
  // What Paystack does when the person pays: mark it paid and send the signed webhook
  tools.post('/pay', async (req, res) => {
    const { reference, amount } = req.body;
    require('../system/paystack-fake').markPaid(reference);
    const body = JSON.stringify({ event: 'charge.success', data: { reference, amount: Math.round(Number(amount) * 100), currency: 'NGN' } });
    const sig = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(body).digest('hex');
    const r = await h.api().post('/api/payments/webhook/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', sig).send(body);
    res.status(r.status).json(r.body);
  });
  // The helper routes sit in front of the real app (and its 404 handler)
  const root = express();
  root.use('/__e2e', tools);
  root.use(app);
  root.listen(Number(process.env.PORT), () => console.log(`[e2e] API ready on ${process.env.PORT} (database ${process.env.TEST_DB_NAME})`));
})().catch((e) => { console.error('[e2e] setup failed:', e); process.exit(1); });
