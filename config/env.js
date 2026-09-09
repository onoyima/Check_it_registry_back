// Environment validation & fail-fast boot guard.
//
// Covers:
//   R4  - JWT secret present + strong enough (fail fast in production)
//   R5  - Email/SMTP configuration present before OTP/email features rely on it
//   R7  - Rate-limit env values sane (avoid accidental lockout / bypass)
//   Immediate checklist - surface missing/misconfigured env at startup instead
//                          of failing later at request time.
//
// Design: `validateEnv({ failFast })` returns a list of problems rather than
// throwing directly so callers (tests, scripts) can opt into lenient mode.
require('dotenv').config();

const REQUIRED_PRODUCTION = ['DB_HOST', 'DB_NAME', 'JWT_SECRET', 'KYC_ENCRYPTION_KEY'];
const EMAIL_VARS = ['RESEND_API_KEY', 'MAIL_FROM_ADDRESS'];

function validateEnv({ failFast = false } = {}) {
  const problems = [];
  const isProd = (process.env.NODE_ENV || 'development') === 'production';

  // --- R4: JWT secret ---
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    problems.push('JWT_SECRET is missing. JWT signing/verification will fail.');
  } else if (jwtSecret.length < 32) {
    problems.push(`JWT_SECRET is only ${jwtSecret.length} chars; use >= 32 for HS256 strength.`);
  }
  if (process.env.JWT_SECRET_PREVIOUS && process.env.JWT_SECRET_PREVIOUS === jwtSecret) {
    problems.push('JWT_SECRET and JWT_SECRET_PREVIOUS are identical; rotation is ineffective.');
  }

  // --- R5: Email / SMTP ---
  const emailConfigured = EMAIL_VARS.some((v) => process.env[v]);
  if (!emailConfigured) {
    problems.push(
      'No email provider configured (RESEND_API_KEY / MAIL_FROM_ADDRESS). ' +
        'OTP & notification emails will silently fail for users.'
    );
  } else {
    if (!process.env.RESEND_API_KEY) {
      problems.push('MAIL_FROM_ADDRESS is set but RESEND_API_KEY is missing; email sends will fail.');
    }
    if (!process.env.MAIL_FROM_ADDRESS) {
      problems.push('RESEND_API_KEY is set but MAIL_FROM_ADDRESS is missing; email sends will fail.');
    }
  }

  // --- R1: encryption key (fail fast even in dev — decrypt failures lose data) ---
  const encKey = process.env.KYC_ENCRYPTION_KEY;
  if (!encKey) {
    problems.push('KYC_ENCRYPTION_KEY is missing; PII/NIN encryption will throw.');
  } else if (encKey.length < 32) {
    problems.push(`KYC_ENCRYPTION_KEY is ${encKey.length} chars; use >= 32.`);
  }

  // --- R7: rate-limit env sanity ---
  const rlm = parseInt(process.env.RATE_LIMIT_MAX, 10);
  if (process.env.RATE_LIMIT_MAX !== undefined && (Number.isNaN(rlm) || rlm < 1)) {
    problems.push('RATE_LIMIT_MAX is not a positive integer; ignoring is safer than trusting the value.');
  }

  // --- Immediate: required production vars ---
  if (isProd) {
    for (const v of REQUIRED_PRODUCTION) {
      if (!process.env[v]) {
        problems.push(`Required production env var "${v}" is missing.`);
      }
    }
  }

  if (failFast && problems.length > 0) {
    const err = new Error('Environment validation failed:\n  - ' + problems.join('\n  - '));
    err.code = 'ENV_VALIDATION_FAILED';
    throw err;
  }

  return problems;
}

module.exports = { validateEnv };
