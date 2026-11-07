// What is recorded about the person behind each item check, the price rules
// for checks, and the check certificates owners show to buyers.
//
// Recorded for every check (device_check_logs):
//   - the account that checked, and when
//   - live location from the phone or computer (latitude, longitude, accuracy)
//   - a photo of the person, taken with their camera at the check
//   - the IP address as our server sees it (ip_address), and the one the
//     browser reported, if any (reported_ip), for comparison
//   - a browser ID: a random id the app keeps in that browser (X-Device-Id)
//   - browser and device details (user agent, screen, time zone, language...)
// A MAC address is NOT recorded: web browsers never reveal it to websites.
const net = require('net');
const crypto = require('crypto');
const Database = require('../config');
const RevenueService = require('./RevenueService');

const STAFF = ['admin', 'super_admin', 'lea'];
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

function cleanIp(value) {
  if (!value) return null;
  let ip = String(Array.isArray(value) ? value[0] : value).split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return net.isIP(ip) ? ip.slice(0, 45) : null;
}

// req.ip honours the "trust proxy" setting (TRUST_PROXY), so behind the
// VPS's web server it is the visitor's address, not the proxy's.
function clientIp(req) {
  return cleanIp(req.ip) || cleanIp(req.socket?.remoteAddress) || null;
}

function browserDeviceId(req) {
  const id = String(req.get('X-Device-Id') || '');
  return /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
}

// A photo sent as a data URL (data:image/jpeg;base64,...). Returns
// { buffer, mime } or null if it isn't a real, reasonably sized image.
function parseSelfie(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length < 1000 || buffer.length > MAX_PHOTO_BYTES) return null;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isPng = buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP';
  if (!(isJpeg || isPng || isWebp)) return null;
  return { buffer, mime: m[1] };
}

// Save the photo as a private file (only the checker, admins and police can
// open it). It is re-encoded, which also removes any hidden data in it.
async function saveSelfie(photo, userId) {
  let out;
  try {
    const sharp = require('sharp');
    out = await sharp(photo.buffer).rotate().resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 }).toBuffer();
  } catch (e) {
    throw Object.assign(new Error('We could not read the photo. Please take it again.'), { status: 400 });
  }
  const files = require('./FileUploadService');
  const name = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.jpg`;
  return files.saveToDisk(out, 'selfies', name, userId);
}

// Free checks of other people's items: the admin's number, minus the checks
// of items that weren't theirs this person has already made
async function allowance(userId) {
  const freeLimit = await RevenueService.getFee('device_check_free_others');
  const [row] = await Database.query(
    'SELECT COUNT(*) AS n FROM device_check_logs WHERE checker_user_id = ? AND is_own_item = 0', [userId]);
  const used = Number(row?.n || 0);
  return { freeLimit, used, remaining: Math.max(0, freeLimit - used) };
}

function newCode() {
  const pick = () => Array.from(crypto.randomBytes(4), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `PO-${pick()}-${pick()}`;
}

function normaliseCode(code) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^PO[A-Z0-9]{8}$/.test(c)) return null;
  return `PO-${c.slice(2, 6)}-${c.slice(6, 10)}`;
}

// Give an owner's check a certificate code
async function issueCertificate(checkId) {
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    try {
      const r = await Database.query(
        'UPDATE device_check_logs SET certificate_code = ? WHERE id = ? AND certificate_code IS NULL', [code, checkId]);
      if (r?.affectedRows === 1) return { code, issuedAt: new Date() };
      const [row] = await Database.query('SELECT certificate_code FROM device_check_logs WHERE id = ?', [checkId]);
      if (row?.certificate_code) return { code: row.certificate_code, issuedAt: new Date() };
      return null;
    } catch (e) {
      if (!/Duplicate/i.test(e.message)) throw e; // try another code
    }
  }
  return null;
}

const ending = (v) => (v ? String(v).slice(-4) : null);

// What a buyer sees when they enter a seller's certificate code
async function readCertificate(code, viewer, req) {
  const c = normaliseCode(code);
  if (!c) return null;
  const [row] = await Database.query(
    `SELECT l.id, l.device_id, l.checker_user_id, l.check_result, l.created_at,
            d.user_id AS current_owner_id, d.category, d.brand, d.model, d.imei, d.serial, d.vin, d.status, d.ownership_level,
            u.first_name, u.middle_name, u.last_name, u.name
       FROM device_check_logs l
       JOIN devices d ON d.id = l.device_id
       LEFT JOIN users u ON u.id = l.checker_user_id
      WHERE l.certificate_code = ? AND l.is_own_item = 1`, [c]);
  if (!row) return null;
  const [report] = await Database.query(
    "SELECT report_type FROM reports WHERE device_id = ? AND status IN ('open','under_review') ORDER BY created_at DESC LIMIT 1",
    [row.device_id]).catch(() => []);
  const custody = await require('./CustodyService').publicState(row.device_id).catch(() => null);
  const ownerName = [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ') || row.name || null;
  await Database.logAudit(viewer?.id || null, 'CHECK_CERTIFICATE_VIEWED', 'device_check_logs', row.id, null,
    { code: c }, req?.ip).catch(() => {});
  return {
    code: c,
    issuedAt: row.created_at,
    ownerName,
    item: { category: row.category, brand: row.brand, model: row.model, identifierEnding: ending(row.imei || row.serial || row.vin) },
    resultAtCheck: row.check_result,
    // Now, not just when the certificate was made
    stillOwnedByIssuer: row.current_owner_id === row.checker_user_id,
    reportedNow: report?.report_type || (['stolen', 'lost'].includes(row.status) ? row.status : null),
    heldByProveOwnership: !!custody?.held,
    ownershipLevel: row.ownership_level || 'registered',
    viewerIsOwner: viewer?.id === row.checker_user_id,
  };
}

// Item owners can see who checked their item and where, but the checker's
// photo and network details are for the checker and staff only
const PRIVATE_FIELDS = ['selfie_url', 'ip_address', 'reported_ip', 'browser_device_id', 'device_fingerprint', 'user_agent',
  'browser_fingerprint', 'mac_address', 'session_id', 'suspicious_flags', 'risk_score', 'certificate_code', 'fee_paid'];
function forViewer(check, user) {
  if (!check) return check;
  if (STAFF.includes(user?.role) || check.checker_user_id === user?.id) return check;
  const out = { ...check };
  for (const f of PRIVATE_FIELDS) delete out[f];
  return out;
}

module.exports = {
  cleanIp, clientIp, browserDeviceId, parseSelfie, saveSelfie, allowance,
  issueCertificate, readCertificate, normaliseCode, forViewer,
};
