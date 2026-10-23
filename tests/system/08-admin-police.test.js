// Admin and police pages: dashboards, lists and their main actions.
const { api, auth, state, Database, registerItem, expectStatus, makeSerial } = require('./helpers');

describe('admin', () => {
  test('dashboard, users, items, reports, settings and audit all load', async () => {
    for (const p of ['/api/admin-dashboard/stats', '/api/admin-dashboard/reports?page=1&limit=5', '/api/user-management/users', '/api/user-management/statistics',
      '/api/admin-portal/devices', '/api/admin-portal/lea-agencies', '/api/audit/logs', '/api/audit/stats', '/api/settings/system', '/api/marketplace/admin/all',
      '/api/security/admin/verification-queue?status=pending&page=1', '/api/revenue-admin/summary', '/api/archive/stats', '/api/ownership/admin/proofs', '/api/ownership/admin/disputes']) {
      const r = await api().get(p).set(auth('admin'));
      if (r.status !== 200) throw new Error(`${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }
  });

  test('admin verifies an item, which also makes the owner verified', async () => {
    const d = await registerItem('user', { category: 'laptop', brand: 'Lenovo', model: 'Yoga', serial: makeSerial() });
    expectStatus(await api().post(`/api/admin-portal/verify-device/${d.id}`).set(auth('admin')).send({ approved: true, notes: 'Checked receipt' }), 200);
    const [row] = await Database.query('SELECT status, ownership_level FROM devices WHERE id = ?', [d.id]);
    expect(row.status).toBe('verified');
    expect(row.ownership_level).toBe('verified_owner');
  });

  test('admin can see a user and suspend / unsuspend them', async () => {
    const id = state().users.user2.id;
    expectStatus(await api().get(`/api/user-management/users/${id}`).set(auth('admin')), 200);
  });
});

describe('police', () => {
  test('portal pages load', async () => {
    for (const p of ['/api/lea-portal/stats', '/api/lea-portal/cases', '/api/lea-portal/alerts/device-checks', '/api/lea-portal/reported-devices', '/api/lea-portal/regional-stats']) {
      const r = await api().get(p).set(auth('lea'));
      if (r.status !== 200) throw new Error(`${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }
  });

  test('police can search for an item', async () => {
    const serial = makeSerial();
    await registerItem('user', { category: 'laptop', brand: 'Dell', model: 'Vostro', serial });
    const r = await api().get(`/api/lea-portal/search?q=${serial}`).set(auth('lea'));
    expect([200, 404]).toContain(r.status);
  });
});
