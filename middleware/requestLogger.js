const Database = require('../config');

const SENSITIVE_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password'];
const SENSITIVE_FIELDS = ['password', 'token', 'secret', 'otp', 'authorization'];

function redactBody(body) {
  if (!body || typeof body !== 'object') return body;
  const redacted = { ...body };
  for (const key of Object.keys(redacted)) {
    if (SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f))) {
      redacted[key] = '[REDACTED]';
    }
  }
  return redacted;
}

function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl, ip } = req;

  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - start;
    const { statusCode } = res;

    // Only log slow requests, errors, or auth-related endpoints
    const isAuth = SENSITIVE_PATHS.some(p => originalUrl.startsWith(p));
    const isError = statusCode >= 400;
    const isSlow = duration > 2000;

    if (isAuth || isError || isSlow) {
      const entry = {
        method,
        path: originalUrl,
        status: statusCode,
        duration: `${duration}ms`,
        ip: ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent') || '',
        userId: req.user?.id || null,
      };

      // Log to audit_logs for auth endpoints
      if (isAuth && process.env.NODE_ENV !== 'test') {
        Database.insert('audit_logs', {
          id: Database.generateUUID(),
          user_id: req.user?.id || null,
          action: `request_${method.toLowerCase()}`,
          resource_type: 'http',
          resource_id: null,
          details: JSON.stringify({
            method,
            path: originalUrl,
            status: statusCode,
            duration: `${duration}ms`,
          }),
          ip_address: ip || req.connection.remoteAddress,
          user_agent: req.get('User-Agent'),
          severity: isError ? 'medium' : 'low',
          status: isError ? 'failed' : 'success',
          created_at: new Date(),
        }).catch(() => {});
      }

      if (isError || isSlow) {
        console.error(JSON.stringify(entry));
      }
    }

    originalEnd.apply(res, args);
  };

  next();
}

module.exports = { requestLogger };
