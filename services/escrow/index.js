// Marketplace escrow: one place that decides which payment company holds a
// buyer's money until delivery, and talks to it. Every other payment (report,
// release, check, verification fees) stays on Paystack.
//
// The admin picks the provider in Admin -> Modules & payments (setting
// "marketplace_escrow_provider", default Monnify). Each sale remembers the
// provider that took its money, so confirming, releasing and refunding always
// go back to that same provider even after the setting changes.
const Database = require('../../config');

const providers = {
  monnify: require('./providers/monnify'),
  flutterwave: require('./providers/flutterwave'),
  vesicash: require('./providers/vesicash'),
  paystack: require('./providers/paystack'),
};
const DEFAULT = 'monnify';

function get(name) {
  const p = providers[String(name || '').toLowerCase()];
  if (!p) throw Object.assign(new Error(`Unknown payment provider "${name}"`), { status: 400 });
  return p;
}

async function currentName() {
  const row = await Database.selectOne('system_settings', 'setting_value', "setting_key = 'marketplace_escrow_provider'").catch(() => null);
  return (row?.setting_value || DEFAULT).toLowerCase();
}

// The provider new sales use. Refuses to start a sale on a provider that
// isn't ready or has no keys, rather than failing at the payment page.
async function current() {
  const p = get(await currentName());
  if (!p.ready) throw Object.assign(new Error(`${p.label} is not set up yet. Choose another escrow provider in the admin settings.`), { status: 503 });
  if (!p.configured()) throw Object.assign(new Error(`${p.label} has no API keys yet. Add them to the server settings, or choose another escrow provider.`), { status: 503 });
  return p;
}

async function setCurrent(name, adminId) {
  const p = get(name);
  if (!p.ready) throw Object.assign(new Error(`${p.label} is not ready yet`), { status: 400 });
  const row = await Database.selectOne('system_settings', 'id', "setting_key = 'marketplace_escrow_provider'");
  if (row) await Database.update('system_settings', { setting_value: p.name, updated_by: adminId || null, updated_at: new Date() }, 'id = ?', [row.id]);
  else await Database.insert('system_settings', { id: Database.generateUUID(), setting_key: 'marketplace_escrow_provider', setting_value: p.name, setting_type: 'string', description: 'Who holds marketplace payments until delivery', created_at: new Date(), updated_at: new Date() });
  await Database.logAudit(adminId || null, 'ESCROW_PROVIDER_CHANGED', 'system_settings', 'marketplace_escrow_provider', null, { provider: p.name }).catch(() => {});
  return p.name;
}

async function list() {
  const active = await currentName();
  return Object.values(providers).map((p) => ({
    name: p.name, label: p.label, ready: !!p.ready, configured: !!p.configured(), holdsFunds: !!p.holdsFunds, active: p.name === active,
  }));
}

module.exports = { get, current, currentName, setCurrent, list, providers };
