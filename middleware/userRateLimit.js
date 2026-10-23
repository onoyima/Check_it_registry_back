// Per-user rate limiting middleware
// Falls back to IP-based limiting for unauthenticated requests

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Per-user rate limiter - uses user ID as key when authenticated, IP otherwise
const userRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Too many requests from this account, please try again later.',
  } = options;

  return rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => {
      if (req.user?.id) return `user:${req.user.id}`;
      return ipKeyGenerator(req.ip || 'unknown');
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
};

// Strict per-user rate limiter for sensitive operations (password change, 2FA, etc.)
const strictUserRateLimit = userRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts for this operation. Please try again in 15 minutes.',
});

// Per-IP rate limiter for unauthenticated endpoints
const publicRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  keyGenerator: (req) => ipKeyGenerator(req.ip || 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

module.exports = { userRateLimit, strictUserRateLimit, publicRateLimit };
