// One place for every identity check (NIN for people, CAC number for
// businesses).
//
//  - The first time a number is seen, it is looked up with Prembly ONCE and
//    what Prembly returns is saved, encrypted, in identity_records. Whether
//    the names match or not, that number is never sent to Prembly again.
//  - After that, the person types the number again and we compare it with
//    the saved record, and the saved Prembly names with their registered
//    names. No Prembly call.
//  - A number confirmed for one account can't be used by another.
//  - People only ever see the same wording, whether or not Prembly was
//    called this time.
const crypto = require('crypto');
const Database = require('../config');
const PIIEncryptionService = require('./PIIEncryptionService');

const MAX_FAILED_PER_DAY = 3;      // wrong numbers / mismatches before a pause
const MAX_NEW_LOOKUPS = 3;         // different numbers one account may look up, ever

// Messages people see (never say whether Prembly was called)
const MESSAGES = {
  bad_format_nin: 'Enter your 11-digit NIN.',
  bad_format_cac: 'Enter your business registration number (RC or BN number).',
  mismatch: 'We could not confirm your identity with these details. Check the number and make sure the name on your account is the name on your NIN.',
  business_mismatch: 'We could not confirm this business with these details. Check the registration number and that the business name matches your CAC registration.',
  not_director: 'Your name is not among the directors of this company. Confirm your own NIN first, then try again.',
  inactive: 'This company is not listed as active with the CAC.',
  in_use: 'This number cannot be used with this account. If you think this is a mistake, contact support.',
  too_many: 'Too many unsuccessful attempts today. Please try again tomorrow or contact support.',
  limit: 'We could not confirm your identity. Please contact support so we can help.',
  unavailable: 'Identity checks are temporarily unavailable. Please try again shortly.',
};

class IdentityError extends Error {
  constructor(code, status = 400) { super(MESSAGES[code] || code); this.code = code; this.status = status; }
}

const clean = (kind, value) => {
  const v = String(value || '').toUpperCase().replace(/[\s-]/g, '');
  if (kind === 'nin') return /^\d{11}$/.test(v) ? v : null;
  // CAC: RC123456, BN1234567, IT12345 or just digits
  const m = v.match(/^(RC|BN|IT)?(\d{3,10})$/);
  return m ? `${m[1] || 'RC'}${m[2]}` : null;
};

function hashId(kind, value) {
  const key = process.env.KYC_ENCRYPTION_KEY || process.env.JWT_SECRET || 'identity';
  return crypto.createHmac('sha256', key).update(`${kind}:${value}`).digest('hex');
}

const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s-]/g, ' ');
const tokens = (...parts) => new Set(norm(parts.filter(Boolean).join(' ')).split(/[\s-]+/).filter(Boolean));

// The NIN's first name and surname must both be in the registered name
// (order, capitals, accents and hyphens don't matter).
function personMatches(record, user) {
  const mine = tokens(user.first_name, user.middle_name, user.last_name, user.name);
  const first = [...tokens(record.first_name)][0];
  const last = [...tokens(record.last_name)][0];
  return !!(first && last && mine.has(first) && mine.has(last));
}

function similarity(a, b) {
  const clip = (s) => norm(s).replace(/\b(limited|ltd|plc|enterprises?|ventures?|nigeria|nig|company|co|and)\b/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  const A = clip(a); const B = clip(b);
  if (!A.length || !B.length) return 0;
  if (A.join(' ') === B.join(' ')) return 1;
  const hits = A.filter((w) => B.includes(w)).length;
  return hits / Math.max(A.length, B.length);
}

class IdentityService {
  static get MESSAGES() { return MESSAGES; }
  static get IdentityError() { return IdentityError; }
  static hashId(kind, value) { return hashId(kind, clean(kind, value) || value); }
  static personMatches(record, user) { return personMatches(record, user); }

  // Where Prembly is called (replaced in tests)
  static async providerLookup(kind, number, extra = {}) {
    if (kind === 'nin') return require('./NINVerificationService').verifyNIN(number);
    return require('./CACVerificationService').verifyRCNumber(number.replace(/^(RC|BN|IT)/, ''), extra.companyName, number.slice(0, 2));
  }

  static decryptData(rec) {
    try { return rec?.data_encrypted ? JSON.parse(PIIEncryptionService.decrypt(rec.data_encrypted) || 'null') : null; } catch { return null; }
  }

  static async failuresToday(userId) {
    const [r] = await Database.query('SELECT COUNT(*) AS n FROM identity_attempts WHERE user_id = ? AND success = 0 AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)', [userId]);
    return Number(r?.n || 0);
  }

  static async attempt(userId, kind, purpose, success, reason, providerCalled) {
    await Database.insert('identity_attempts', {
      id: Database.generateUUID(), user_id: userId, kind, purpose, success: success ? 1 : 0, reason: reason || null, provider_called: providerCalled ? 1 : 0, created_at: new Date(),
    }).catch(() => {});
  }

  // The record a number belongs to, looking it up with Prembly only if we
  // have never seen it. Returns { rec, data, providerCalled }.
  static async recordFor(userId, kind, number, extra) {
    const id_hash = hashId(kind, number);
    let rec = await Database.selectOne('identity_records', '*', 'kind = ? AND id_hash = ?', [kind, id_hash]);
    if (rec) return { rec, data: this.decryptData(rec), providerCalled: false };

    const [{ n } = { n: 0 }] = await Database.query(
      'SELECT COUNT(*) AS n FROM identity_attempts WHERE user_id = ? AND kind = ? AND provider_called = 1', [userId, kind]);
    if (Number(n) >= MAX_NEW_LOOKUPS) throw new IdentityError('limit');

    let data;
    try {
      data = await this.providerLookup(kind, number, extra);
    } catch (e) {
      console.error(`[Identity] ${kind} lookup failed:`, e.message);
      // A clear "no such record" answer is saved too, so it isn't paid for twice
      if (/not found|invalid|no record|does not exist/i.test(e.message)) {
        data = { not_found: true };
      } else {
        throw new IdentityError('unavailable', 503);
      }
    }
    const safe = { ...data }; delete safe.nin;
    rec = {
      id: Database.generateUUID(), kind, id_hash, id_encrypted: PIIEncryptionService.encrypt(number), id_last4: number.slice(-4),
      user_id: null, status: 'unmatched', data_encrypted: PIIEncryptionService.encrypt(JSON.stringify(safe)), provider: 'prembly',
      fetched_at: new Date(), updated_at: new Date(),
    };
    try {
      await Database.insert('identity_records', rec);
    } catch (e) {
      // Someone else saved the same number at the same moment
      rec = await Database.selectOne('identity_records', '*', 'kind = ? AND id_hash = ?', [kind, id_hash]);
    }
    return { rec, data: safe, providerCalled: true };
  }

  /**
   * Confirm a person with their NIN. Used on every report, and once on the
   * identity page. Throws IdentityError with a friendly message on failure.
   */
  static async confirmNin(userId, ninInput, purpose = 'report') {
    const nin = clean('nin', ninInput);
    if (!nin) throw new IdentityError('bad_format_nin');
    if (await this.failuresToday(userId) >= MAX_FAILED_PER_DAY) throw new IdentityError('too_many', 429);

    const user = await Database.selectOne('users', 'id, name, first_name, middle_name, last_name, email', 'id = ?', [userId]);
    if (!user) throw new IdentityError('mismatch');

    const mine = await Database.selectOne('identity_records', '*', "user_id = ? AND kind = 'nin' AND status = 'matched'", [userId]);
    let providerCalled = false;
    let ok = false; let reason = 'mismatch';

    if (mine) {
      // Already confirmed: it must be the same NIN, and the saved names must
      // still match the account
      if (mine.id_hash === hashId('nin', nin)) {
        const data = this.decryptData(mine) || {};
        ok = personMatches(data, user);
      }
    } else {
      const found = await this.recordFor(userId, 'nin', nin);
      providerCalled = found.providerCalled;
      const { rec, data } = found;
      if (rec.status === 'matched' && rec.user_id && rec.user_id !== userId) {
        reason = 'in_use';
      } else if (data && !data.not_found && personMatches(data, user)) {
        ok = true;
        await Database.update('identity_records', { user_id: userId, status: 'matched', matched_at: new Date(), updated_at: new Date() }, 'id = ?', [rec.id]);
        await this.markPersonVerified(userId, nin, data);
      } else if (!rec.user_id) {
        await Database.update('identity_records', { user_id: userId, updated_at: new Date() }, 'id = ? AND user_id IS NULL', [rec.id]);
      }
    }

    await this.attempt(userId, 'nin', purpose, ok, ok ? null : reason, providerCalled);
    if (!ok) {
      if (reason === 'mismatch') await this.alertAdmins(userId, 'nin', purpose);
      throw new IdentityError(reason);
    }
    return { confirmed: true };
  }

  // First successful confirmation: mark the account verified (badge, names
  // locked) and verify the person's waiting items, as before.
  static async markPersonVerified(userId, nin, data) {
    await Database.update('users', {
      kyc_status: 'verified', is_verified: true, nin_verified_at: new Date(), nin_last_digits: nin.slice(-4),
      verified_full_name: [data.first_name, data.middle_name, data.last_name].filter(Boolean).join(' '),
      verified_dob: data.date_of_birth || null, verified_gender: data.gender || null,
      verification_badge_visible: true, caution_flag: false, updated_at: new Date(),
    }, 'id = ?', [userId]).catch((e) => console.warn('[Identity] user update:', e.message));
    await Database.query("UPDATE devices SET status = 'verified', verified_at = NOW(), updated_at = NOW() WHERE user_id = ? AND status = 'unverified'", [userId]).catch(() => {});
    await Database.logAudit(userId, 'IDENTITY_CONFIRMED', 'users', userId, null, { kind: 'nin' }).catch(() => {});
  }

  /**
   * Confirm a business with its CAC registration number. Passes when the
   * CAC name matches the business name, the company is active, and the
   * account holder is a director (or has confirmed their own NIN).
   */
  static async confirmBusiness(userId, rcInput, purpose = 'business') {
    const rc = clean('cac', rcInput);
    if (!rc) throw new IdentityError('bad_format_cac');
    if (await this.failuresToday(userId) >= MAX_FAILED_PER_DAY) throw new IdentityError('too_many', 429);

    const user = await Database.selectOne('users', 'id, name, first_name, middle_name, last_name', 'id = ?', [userId]);
    const profile = await Database.selectOne('business_profiles', '*', 'user_id = ?', [userId]);
    if (!user || !profile) throw new IdentityError('business_mismatch');

    const mine = await Database.selectOne('identity_records', '*', "user_id = ? AND kind = 'cac' AND status = 'matched'", [userId]);
    let providerCalled = false; let ok = false; let reason = 'business_mismatch'; let data = null; let rec = null;

    if (mine) {
      if (mine.id_hash === hashId('cac', rc)) { rec = mine; data = this.decryptData(mine) || {}; }
    } else {
      const found = await this.recordFor(userId, 'cac', rc, { companyName: profile.business_name });
      providerCalled = found.providerCalled; rec = found.rec; data = found.data;
      if (rec.status === 'matched' && rec.user_id && rec.user_id !== userId) { reason = 'in_use'; data = null; }
    }

    if (data && !data.not_found) {
      const nameOk = similarity(profile.business_name, data.company_name) >= 0.6;
      const active = ['active', 'registered', 'in business'].some((s) => String(data.status || '').toLowerCase().includes(s));
      const holderIsDirector = (data.directors || []).some((d) => personMatches(this.splitName(d.name), user));
      const ninConfirmed = !!(await Database.selectOne('identity_records', 'id', "user_id = ? AND kind = 'nin' AND status = 'matched'", [userId]));
      if (!nameOk) reason = 'business_mismatch';
      else if (!active) reason = 'inactive';
      else if (!holderIsDirector && !ninConfirmed) reason = 'not_director';
      else ok = true;
    }

    if (ok && rec && rec.status !== 'matched') {
      await Database.update('identity_records', { user_id: userId, status: 'matched', matched_at: new Date(), updated_at: new Date() }, 'id = ?', [rec.id]);
    } else if (rec && !rec.user_id) {
      await Database.update('identity_records', { user_id: userId, updated_at: new Date() }, 'id = ? AND user_id IS NULL', [rec.id]);
    }

    await this.attempt(userId, 'cac', purpose, ok, ok ? null : reason, providerCalled);
    if (!ok) {
      if (reason === 'business_mismatch') await this.alertAdmins(userId, 'cac', purpose);
      throw new IdentityError(reason);
    }
    return { confirmed: true, company: { name: data.company_name, status: data.status, registration_date: data.registration_date, address: data.address } };
  }

  static splitName(full) {
    const parts = norm(full).split(/[\s-]+/).filter(Boolean);
    return { first_name: parts[0], last_name: parts[parts.length - 1] };
  }

  // Names can't be changed once identity is confirmed (only by an admin)
  static async namesLocked(userId) {
    const rec = await Database.selectOne('identity_records', 'id', "user_id = ? AND kind = 'nin' AND status = 'matched'", [userId]).catch(() => null);
    return !!rec;
  }

  static async status(userId) {
    const nin = await Database.selectOne('identity_records', 'id', "user_id = ? AND kind = 'nin' AND status = 'matched'", [userId]);
    const cac = await Database.selectOne('identity_records', 'id', "user_id = ? AND kind = 'cac' AND status = 'matched'", [userId]);
    return { identity_confirmed: !!nin, business_confirmed: !!cac };
  }

  static async alertAdmins(userId, kind, purpose) {
    try {
      const user = await Database.selectOne('users', 'name, first_name, last_name, email', 'id = ?', [userId]);
      await Database.insert('system_alerts', {
        id: Database.generateUUID(), alert_type: 'security', severity: 'high',
        title: kind === 'nin' ? 'Identity check did not match' : 'Business check did not match',
        message: `${[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.name || 'A user'} (${user?.email || userId}) did not pass the ${kind === 'nin' ? 'NIN' : 'CAC'} check during ${purpose}.`,
        details: JSON.stringify({ userId, kind, purpose, at: new Date().toISOString() }),
        is_resolved: false, created_at: new Date(),
      });
    } catch (e) { console.warn('[Identity] alert:', e.message); }
  }
}

module.exports = IdentityService;
