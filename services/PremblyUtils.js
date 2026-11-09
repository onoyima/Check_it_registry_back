// Shared helpers for the Prembly (IdentityPass) API.
// Response shapes vary across endpoints: some use response_code, older ones
// use status_code, and fields switch between snake_case and camelCase.

const BASE_URL = (process.env.PREMBLY_BASE_URL || 'https://api.prembly.com').replace(/\/+$/, '');

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

// Accept { status: true, response_code: '00' }, { status: true, status_code: '00' }
// and responses that only set status.
function isSuccess(body) {
  if (!body || body.status !== true) return false;
  const code = body.response_code ?? body.status_code;
  return code === undefined || code === null || code === '' || String(code) === '00';
}

function firstRecord(raw) {
  return Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
}

// Normalize DOB strings (22-05-1998, 1998-05-22, 9/15/1900) to YYYY-MM-DD so
// they fit DATE columns. Nigerian records are day-first unless that is invalid.
function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const match = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!match) return raw;
  let day = Number(match[1]);
  let month = Number(match[2]);
  const year = match[3];
  if (month > 12) {
    const swapped = month;
    month = day;
    day = swapped;
  }
  if (day < 1 || day > 31 || month < 1 || month > 12) return raw;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Never mark sandbox identities as verified in production.
function assertProductionReady(body) {
  if (body?.is_sandbox === true && process.env.NODE_ENV === 'production' && process.env.PREMBLY_ALLOW_SANDBOX !== 'true') {
    throw new Error('Prembly is in sandbox mode; set a live PREMBLY_API_KEY before verifying identities in production.');
  }
}

function errorDetail(body, fallback) {
  const detail = body?.detail || body?.message || fallback;
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

module.exports = {
  BASE_URL,
  pick,
  isSuccess,
  firstRecord,
  normalizeDate,
  assertProductionReady,
  errorDetail
};
