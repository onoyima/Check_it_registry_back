// Calls EVERY backend route as the right kind of user with empty / dummy
// input and fails on any server error (5xx). Bad input must give a clear
// 4xx, never a crash. Destructive account actions use throw-away accounts.
const { api, app, createAccount, uniq } = require('./helpers');

function listRoutes() {
  const out = [];
  const prefixOf = (layer) => {
    if (!layer.regexp || layer.regexp.fast_slash) return '';
    return layer.regexp.source.replace('^\\/', '/').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/').replace(/\$$/, '').replace(/\/\?$/, '');
  };
  const walk = (stack, base) => {
    for (const l of stack) {
      if (l.route) {
        for (const m of Object.keys(l.route.methods)) for (const p of [].concat(l.route.path)) out.push([m.toUpperCase(), (base + p).replace(/\/+/g, '/')]);
      } else if (l.name === 'router' && l.handle.stack) walk(l.handle.stack, base + prefixOf(l));
    }
  };
  walk(app._router.stack, '');
  return out.filter(([m, p]) => p.startsWith('/api/') && !p.includes('*') && m !== '_ALL');
}

const roleFor = (p) => {
  if (/^\/api\/(admin|admin-portal|admin-dashboard|admin-system|user-management|analytics|audit|revenue-admin|archive|system-health|admin\/pii|dashboard-config|settings)/.test(p) || /\/admin(\/|$)/.test(p)) return 'admin';
  if (p.startsWith('/api/lea-portal')) return 'lea';
  if (/^\/api\/(business|business-profile)/.test(p) || p.includes('/seller')) return 'business';
  return 'user';
};

// Actions that end the session or delete the account: run them with a
// separate throw-away account so the other calls keep working.
const SESSION_ENDING = [/\/logout/, /\/sessions\/(revoke|terminate)/, /account-deletion|delete-account/, /change-password|password\/change/, /\/sessions\/all/];
const SKIP = [/^\/api\/payments\/webhook\/paystack$/, /^\/api\/csp-report$/];

describe('every API route answers without a server error', () => {
  const routes = listRoutes();
  const tokens = {};
  const failures = [];
  const statuses = {};

  beforeAll(async () => {
    for (const r of ['user', 'admin', 'lea', 'business']) tokens[r] = (await createAccount(r === 'user' ? 'user' : r)).token;
  });

  test(`${routes.length} routes`, async () => {
    for (const [method, path] of routes) {
      if (SKIP.some((re) => re.test(path))) continue;
      const url = path.replace(/:([A-Za-z_]+)/g, (_, n) => (/(id|Id|ID)$/.test(n) ? '00000000-0000-4000-8000-000000000000' : `x${uniq()}`));
      const role = roleFor(path);
      let token = tokens[role];
      if (SESSION_ENDING.some((re) => re.test(path))) token = (await createAccount(role === 'user' ? 'user' : role)).token;
      const req = api()[method.toLowerCase()](url).set('Authorization', `Bearer ${token}`).set('User-Agent', 'system-tests');
      const res = method === 'GET' || method === 'DELETE' ? await req : await req.send({});
      if (res.status >= 500) failures.push(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
      // The app's catch-all answer: the route exists in code but is never reached
      if (res.status === 404 && res.body?.error === 'Endpoint not found') failures.push(`${method} ${path} -> unreachable ("Endpoint not found")`);
      statuses[res.status] = (statuses[res.status] || 0) + 1;
    }
    if (failures.length) console.log('Server errors:\n' + failures.join('\n'));
    if (process.env.SWEEP_VERBOSE) console.log('Status counts:', statuses);
    expect(failures).toEqual([]);
  });
});
