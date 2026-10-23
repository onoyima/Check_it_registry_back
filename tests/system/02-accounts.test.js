// Accounts: sign-up rules, sign-in, email confirmation, password reset,
// sign-out, and role protection.
const { api, Database, createAccount, login, expectStatus, outbox, uniq, latestOtp } = require('./helpers');

describe('accounts', () => {
  const password = 'Str0ng!Passw0rd#2026';

  test('sign-up checks the input', async () => {
    expectStatus(await api().post('/api/auth/register').send({}), 400);
    expectStatus(await api().post('/api/auth/register').send({ first_name: 'A', last_name: 'B', name: 'A B', email: `w.${uniq()}@t.local`, password: 'password' }), 400);
    const email = `dupe.${uniq()}@t.local`;
    expectStatus(await api().post('/api/auth/register').send({ first_name: 'Dupe', last_name: 'User', name: 'Dupe User', email, password }), 201);
    expectStatus(await api().post('/api/auth/register').send({ first_name: 'Dupe', last_name: 'User', name: 'Dupe User', email, password }), 409);
  });

  test('nobody can make themselves an admin at sign-up', async () => {
    const r = expectStatus(await api().post('/api/auth/register').send({ first_name: 'Sneaky', last_name: 'User', name: 'Sneaky User', email: `sneaky.${uniq()}@t.local`, password, role: 'admin' }), 201);
    expect(r.body.user.role).toBe('user');
  });

  test('email confirmation link works', async () => {
    const email = `confirm.${uniq()}@t.local`;
    outbox.clear();
    const r = expectStatus(await api().post('/api/auth/register').send({ first_name: 'Conf', last_name: 'Irm', name: 'Conf Irm', email, password }), 201);
    const mail = outbox.messages.find((m) => m.to === email && /verify-email\?token=/.test(m.html));
    expect(mail).toBeTruthy();
    const token = decodeURIComponent(mail.html.match(/verify-email\?token=([^"&<\s]+)/)[1]);
    expectStatus(await api().post('/api/auth/verify-email').send({ token }), 200);
    const [u] = await Database.query('SELECT verified_at FROM users WHERE id = ?', [r.body.user.id]);
    expect(u.verified_at).toBeTruthy();
  });

  test('sign-in: wrong password refused, right password works, /me returns the user', async () => {
    const acc = await createAccount('user');
    expectStatus(await api().post('/api/auth/login').send({ email: acc.email, password: 'Wrong!Passw0rd#1' }), 401);
    const me = expectStatus(await api().get('/api/auth/me').set('Authorization', `Bearer ${acc.token}`), 200);
    expect(me.body.user.id).toBe(acc.id);
  });

  test('admins and police must enter an emailed code to sign in', async () => {
    const acc = await createAccount('admin');
    const r = await api().post('/api/auth/login').set('User-Agent', 'other-browser').send({ email: acc.email, password: acc.password });
    expect(r.body.requires_device_verification).toBe(true);
    expect(r.body.token).toBeUndefined();
  });

  test('password reset by email', async () => {
    const acc = await createAccount('user');
    outbox.clear();
    expectStatus(await api().post('/api/auth/request-password-reset').send({ email: acc.email }), 200);
    expect(outbox.messages.find((m) => m.to === acc.email)).toBeTruthy();
    const otp_code = await latestOtp(acc.id);
    const newPassword = 'N3w!Passw0rd#2026';
    expectStatus(await api().post('/api/auth/reset-password').send({ email: acc.email, otp_code, new_password: newPassword }), 200);
    expectStatus(await api().post('/api/auth/login').send({ email: acc.email, password: acc.password }), 401);
    expect(await login(acc.email, newPassword, acc.id)).toBeTruthy();
    // the old session no longer works
    expectStatus(await api().get('/api/auth/me').set('Authorization', `Bearer ${acc.token}`), 401);
  });

  test('sign-out ends the session', async () => {
    const acc = await createAccount('user');
    expectStatus(await api().post('/api/auth/logout').set('Authorization', `Bearer ${acc.token}`), 200);
    expectStatus(await api().get('/api/auth/me').set('Authorization', `Bearer ${acc.token}`), 401);
  });

  test('pages for other roles are refused', async () => {
    const acc = await createAccount('user');
    const h = { Authorization: `Bearer ${acc.token}` };
    expectStatus(await api().get('/api/admin-dashboard/stats').set(h), 403);
    expectStatus(await api().get('/api/ownership/admin/proofs').set(h), 403);
    expectStatus(await api().get('/api/lea-portal/cases').set(h), 403);
    expectStatus(await api().get('/api/auth/me'), 401);
  });
});
