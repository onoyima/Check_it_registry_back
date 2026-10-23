// "Remember this device": after one emailed code, the same browser signs in
// without a code; another browser, or "don't remember", still needs one.
const { api, Database, createAccount, outbox } = require('./helpers');

// The app sends a random id it keeps in the browser
const CHROME = {
  'X-Device-Id': 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
};
const FIREFOX = { ...CHROME, 'X-Device-Id': 'ffffeeeeddddccccbbbbaaaa99998888', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0' };

const signIn = (acct, headers, extra = {}) => api().post('/api/auth/login').set(headers).send({ email: acct.email, password: acct.password, ...extra });
const latestCode = async (userId) => (await Database.query(
  "SELECT otp_code FROM otps WHERE user_id = ? AND otp_type = 'device_login' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1", [userId]))[0]?.otp_code;
const verify = (r, code, headers, remember) => api().post('/api/auth/verify-device').set(headers)
  .send({ user_id: r.body.user_id, otp_code: code, device_fingerprint: r.body.device_fingerprint, remember_device: remember });

describe('remember this device', () => {
  let saved;
  beforeAll(() => { saved = process.env.ENABLE_EMAIL_OTP; process.env.ENABLE_EMAIL_OTP = 'true'; });
  afterAll(() => { process.env.ENABLE_EMAIL_OTP = saved; });

  test('a remembered browser signs in straight away next time', async () => {
    const acct = await createAccount('user');
    const first = await signIn(acct, CHROME, { remember_device: true });
    expect(first.body.requires_device_verification).toBe(true);
    const v = await verify(first, await latestCode(acct.id), CHROME, true);
    expect(v.status).toBe(200);
    expect(v.body.device_trusted).toBe(true);

    const again = await signIn(acct, CHROME);
    expect(again.body.requires_device_verification).toBeFalsy();
    expect(again.body.token).toBeTruthy();

    // ...still remembered after signing out
    await api().post('/api/auth/logout').set(CHROME).set('Authorization', `Bearer ${again.body.token}`);
    const afterLogout = await signIn(acct, CHROME);
    expect(afterLogout.body.token).toBeTruthy();

    // ...and after the browser updates itself (new version number)
    const updated = { ...CHROME, 'User-Agent': CHROME['User-Agent'].replace('Chrome/130.0.0.0', 'Chrome/131.0.0.0') };
    const afterUpdate = await signIn(acct, updated);
    expect(afterUpdate.body.token).toBeTruthy();

    // a different browser still needs a code
    const other = await signIn(acct, FIREFOX);
    expect(other.body.requires_device_verification).toBe(true);
  });

  test('"Remember me" keeps you signed in for 30 days, otherwise one day', async () => {
    const jwt = require('jsonwebtoken');
    const acct = await createAccount('user');
    const first = await signIn(acct, { ...CHROME, 'X-Device-Id': 'r1r2r3r4r5r6r7r8r9r0r1r2r3r4r5r6' }, { remember_device: true });
    const v = await verify(first, await latestCode(acct.id), { ...CHROME, 'X-Device-Id': 'r1r2r3r4r5r6r7r8r9r0r1r2r3r4r5r6' }, true);
    const life = (t) => { const d = jwt.decode(t); return (d.exp - d.iat) / 86400; };
    expect(life(v.body.token)).toBe(30);
    const short = await signIn(acct, FIREFOX);
    const v2 = await verify(short, await latestCode(acct.id), FIREFOX, false);
    expect(life(v2.body.token)).toBe(1);
  });

  test('admin accounts: a remembered browser skips the code for 7 days', async () => {
    const admin = await createAccount('admin'); // signs in once from "system-tests"
    const H = { ...CHROME, 'X-Device-Id': 'adminbrowser0000000000000000000a' };
    const first = await signIn(admin, H);
    expect(first.body.requires_device_verification).toBe(true);
    await verify(first, await latestCode(admin.id), H, true);
    const again = await signIn(admin, H);
    expect(again.body.token).toBeTruthy();
    // remembered for 7 days from the code, even if used every day
    const [row] = await Database.query("SELECT TIMESTAMPDIFF(HOUR, NOW(), expires_at) AS h FROM user_sessions WHERE user_id = ? AND is_trusted = 1 AND is_active = 1 ORDER BY created_at DESC LIMIT 1", [admin.id]);
    expect(row.h).toBeGreaterThan(24 * 6);
    expect(row.h).toBeLessThanOrEqual(24 * 7);
    await Database.query("UPDATE user_sessions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE user_id = ?", [admin.id]);
    const later = await signIn(admin, H);
    expect(later.body.requires_device_verification).toBe(true);
  });

  test('browsers remembered before this change are still recognised', async () => {
    const acct = await createAccount('user');
    const OLD = { ...CHROME }; delete OLD['X-Device-Id'];
    const first = await signIn(acct, OLD);
    await verify(first, await latestCode(acct.id), OLD, true);
    // now the updated app sends its id: still remembered, no code
    const again = await signIn(acct, { ...CHROME, 'X-Device-Id': 'upgradedbrowser00000000000000001' });
    expect(again.body.token).toBeTruthy();
  });

  test('without "remember", the next sign-in asks for a code again', async () => {
    const acct = await createAccount('user');
    const first = await signIn(acct, CHROME);
    await verify(first, await latestCode(acct.id), CHROME, false);
    const again = await signIn(acct, CHROME);
    expect(again.body.requires_device_verification).toBe(true);
  });
});
