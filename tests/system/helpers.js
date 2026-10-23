// Shared helpers for the system tests.
require('./env');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app } = require('../../app');
const Database = require('../../config');
const { STATE_FILE } = require('./env');

const api = () => request(app);
let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// A valid 15-digit IMEI (Luhn check digit computed)
function makeImei() {
  const d = ('35' + String(Date.now()).slice(-9) + String(Math.floor(100 + Math.random() * 899))).slice(0, 14).split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 14; i++) { let x = d[i]; if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9; } sum += x; }
  return d.join('') + ((10 - (sum % 10)) % 10);
}
const makeSerial = () => ('SN' + uniq()).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
const makeVin = () => {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  let v = 'J'; // Japanese VIN: check digit not enforced
  while (v.length < 17) v += chars[Math.floor(Math.random() * chars.length)];
  return v;
};

// Register through the API, confirm email, set the role, then log in
// (reading the emailed sign-in code from the database for admin/police).
async function createAccount(role) {
  const email = `${role}.${uniq()}@test.proveownership.local`;
  const password = 'Str0ng!Passw0rd#2026';
  const first = { user: 'Ada', user2: 'Bola', business: 'Chidi', admin: 'Dayo', lea: 'Emeka' }[role] || 'Test';
  const r = await api().post('/api/auth/register').send({
    first_name: first, last_name: 'Tester', name: `${first} Tester`, email, password,
    phone: '080' + String(Math.floor(10000000 + Math.random() * 89999999)), region: 'Lagos',
    role: role === 'business' ? 'business' : 'user',
  });
  if (r.status !== 201) throw new Error(`register ${role} failed: ${r.status} ${JSON.stringify(r.body)}`);
  const id = r.body.user.id;
  const dbRole = role === 'user2' ? 'user' : role;
  await Database.query('UPDATE users SET verified_at = NOW(), role = ? WHERE id = ?', [dbRole, id]);
  const token = await login(email, password, id);
  return { id, email, password, role: dbRole, token };
}

async function login(email, password, id) {
  const r = await api().post('/api/auth/login').set('User-Agent', 'system-tests').send({ email, password });
  if (r.body.token) return r.body.token;
  if (r.body.requires_device_verification) {
    const [otp] = await Database.query("SELECT otp_code FROM otps WHERE user_id = ? AND otp_type = 'device_login' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1", [id]);
    const v = await api().post('/api/auth/verify-device').set('User-Agent', 'system-tests')
      .send({ user_id: id, otp_code: otp.otp_code, device_fingerprint: r.body.device_fingerprint, remember_device: true });
    if (v.body.token) return v.body.token;
    throw new Error(`verify-device failed: ${v.status} ${JSON.stringify(v.body)}`);
  }
  throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
}

function state() { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
const auth = (who) => ({ Authorization: `Bearer ${state().users[who].token}` });

// Register an item through the API and confirm it (as the email link would)
async function registerItem(who, body) {
  const r = await api().post('/api/device-management').set(auth(who)).send(body);
  if (r.status !== 201) throw new Error(`registerItem failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
async function confirmItem(who, deviceId) {
  const token = Database.generateJWT({ type: 'device_verify', device_id: deviceId, user_id: state().users[who].id });
  return api().post('/api/device-management/verify-device-link').send({ token });
}

// A tiny valid PNG for upload tests
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Assert a status and show the body when it is wrong (much easier to debug)
function expectStatus(res, ...codes) {
  if (!codes.includes(res.status)) {
    throw new Error(`Expected ${codes.join('/')} but got ${res.status} for ${res.req?.method} ${res.req?.path}: ${JSON.stringify(res.body).slice(0, 400)}`);
  }
  return res;
}
// The newest unused one-time code emailed to a user
async function latestOtp(userId, type) {
  const rows = await Database.query(
    `SELECT otp_code FROM otps WHERE user_id = ? ${type ? 'AND otp_type = ?' : ''} AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    type ? [userId, type] : [userId]
  );
  return rows[0] && rows[0].otp_code;
}
// Simulate Paystack confirming a payment (signed webhook, like production)
async function payInvoice(reference, amountNaira) {
  const crypto = require('crypto');
  const body = JSON.stringify({ event: 'charge.success', data: { reference, amount: Math.round(Number(amountNaira) * 100), currency: 'NGN' } });
  const sig = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(body).digest('hex');
  const r = await api().post('/api/payments/webhook/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', sig).send(body);
  await new Promise((res) => setTimeout(res, 300)); // webhook finishes after replying
  return r;
}
const outbox = require('../../utils/test-outbox');

module.exports = { expectStatus, latestOtp, payInvoice, outbox, api, app, Database, state, auth, createAccount, login, registerItem, confirmItem, makeImei, makeSerial, makeVin, uniq, PNG, path };
