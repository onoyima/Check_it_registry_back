// Parts of the app that can be switched on and off by an admin without a new
// release (Admin -> Modules & payments). To add one, add it to MODULES.
const Database = require('../config');

const MODULES = {
  marketplace: {
    label: 'Marketplace',
    description: 'Buying and selling verified items, the cart, orders, escrow and seller payouts.',
    setting: 'module_marketplace',
    default: 'off',
  },
};

let cache = { at: 0, values: {} };
const TTL_MS = 15 * 1000;

async function load() {
  if (Date.now() - cache.at < TTL_MS) return cache.values;
  const keys = Object.values(MODULES).map((m) => m.setting);
  const rows = await Database.query(`SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (${keys.map(() => '?').join(',')})`, keys).catch(() => []);
  const values = {};
  for (const [name, m] of Object.entries(MODULES)) {
    const row = rows.find((r) => r.setting_key === m.setting);
    values[name] = String(row ? row.setting_value : m.default).toLowerCase() === 'on';
  }
  cache = { at: Date.now(), values };
  return values;
}

async function isOn(name) { return !!(await load())[name]; }

async function set(name, on, adminId) {
  const m = MODULES[name];
  if (!m) throw Object.assign(new Error('Unknown module'), { status: 404 });
  const value = on ? 'on' : 'off';
  const row = await Database.selectOne('system_settings', 'id', 'setting_key = ?', [m.setting]);
  if (row) await Database.update('system_settings', { setting_value: value, updated_by: adminId || null, updated_at: new Date() }, 'id = ?', [row.id]);
  else await Database.insert('system_settings', { id: Database.generateUUID(), setting_key: m.setting, setting_value: value, setting_type: 'string', description: `${m.label} on or off`, created_at: new Date(), updated_at: new Date() });
  cache.at = 0;
  await Database.logAudit(adminId || null, on ? 'MODULE_ON' : 'MODULE_OFF', 'system_settings', m.setting, null, { module: name }).catch(() => {});
  return value;
}

async function list() {
  const values = await load();
  return Object.entries(MODULES).map(([name, m]) => ({ name, label: m.label, description: m.description, on: values[name] }));
}

// Middleware: answers 503 for a switched-off module. Admins can still use it,
// so they can prepare it before switching it on.
function requireModule(name) {
  return async (req, res, next) => {
    try {
      if (await isOn(name)) return next();
      const auth = String(req.headers.authorization || '');
      if (auth.startsWith('Bearer ')) {
        try {
          const jwt = require('jsonwebtoken');
          const p = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
          if (['admin', 'super_admin'].includes(p.role)) return next();
        } catch (_) { /* not signed in: treat as visitor */ }
      }
      return res.status(503).json({ moduleOff: name, error: `The ${MODULES[name].label.toLowerCase()} is not open yet. Please check back soon.` });
    } catch (e) { next(e); }
  };
}

module.exports = { MODULES, isOn, set, list, requireModule };
