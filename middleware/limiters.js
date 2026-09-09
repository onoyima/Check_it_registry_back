// Shared rate-limiters. Centralized so both app.js (mount-level) and route
// files (per-route, e.g. OTP endpoints in auth.js) use the same definitions
// without circular requires.
const rateLimit = require('express-rate-limit');

// Attached at app level to /api/ (all endpoints). Generous but still blocks
// straightforward abuse.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// Auth endpoints: tuned so legitimate multi-step flows (login + OTP resend +
// verify + password reset) do not trip the limiter, while brute force is blocked.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' }
});

// Per-OTP-verification limiter — the sensitive endpoint, so keep it tight.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts, please try again later.' }
});

module.exports = { apiLimiter, authLimiter, otpLimiter };
