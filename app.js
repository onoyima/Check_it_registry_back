// Main Express Server - MySQL Version
require('dotenv').config();
const path = require('path');

// Fail-fast environment validation (R4 JWT secret, R5 email provider, R1
// encryption key, R7 rate-limit sanity, immediate-before-deploy checklist).
// In production, a missing critical secret aborts startup instead of failing
// at request time. In dev/test, problems are logged but non-fatal.
const { validateEnv } = require('./config/env');
const envProblems = validateEnv({
  failFast: (process.env.NODE_ENV || 'development') === 'production',
});
for (const p of envProblems) {
  console.warn('[env] ' + p);
}

// Global async error handlers must be installed BEFORE any routes are
// registered so every async route handler is protected. In Express 4,
// rejected promises inside async handlers are NOT automatically forwarded to
// the error middleware — these installs fix that process-wide.
const { installGlobalHandlers, installProcessHandlers } = require('./middleware/asyncHandler');
installGlobalHandlers();
installProcessHandlers();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const Database = require('./config');

// Import services
const BackgroundJobs = require('./services/BackgroundJobs');
const SystemMonitor = require('./services/SystemMonitorService');
const { runMigrations } = require('./services/migrations');
const errorStore = require('./services/ErrorStore');

// Import middleware
const { validationErrorHandler } = require('./middleware/validation');
const { requestLogger } = require('./middleware/requestLogger');
const { responseEnvelope } = require('./middleware/responseEnvelope');

// Import routes
const { router: authRoutes } = require('./routes/auth');
const deviceRoutes = require('./routes/device-management');
const publicCheckRoutes = require('./routes/public-check');
const reportRoutes = require('./routes/report-management');

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      reportUri: [process.env.CSP_REPORT_URI || "/api/csp-report"],
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' }
}));

// Apply custom security headers
app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  next();
});

// Response compression
app.use(compression());

// CORS: allow local dev ports and custom headers for device check context
const isDev = (process.env.NODE_ENV || 'development') !== 'production';

function getCorsOrigin() {
  if (isDev) return true;
  const allowed = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map(s => s.trim().replace(/\/$/, ''));
  if (allowed.length === 1) return allowed[0];
  return (origin, callback) => {
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  };
}

app.use(cors({
  origin: getCorsOrigin(),
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Forwarded-For',
    'x-mac-address',
    'x-client-mac',
    'x-location-lat',
    'x-location-lon',
    'x-location-accuracy',
    'User-Agent'
  ]
}));

// Rate limiting - enabled for all endpoints
const { apiLimiter, authLimiter } = require('./middleware/limiters');
app.use('/api/', apiLimiter);

// Stricter rate limit for auth endpoints.
// Tuned so legitimate flows (multi-step login + OTP resend + verify + password
// reset) do not trip the limiter: env-tunable, 60/15 min by default. The
// aggressive per-OTP limiter (see middleware/limiters.js otpLimiter) is the
// real defense against OTP abuse.
app.use('/api/auth/', authLimiter);

// Body parsing middleware
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: false, limit: '500kb' }));

// IP blocking middleware — blocks IPs that cause repeated errors
const IP_BLOCK_THRESHOLD = 10;
const ipFailCount = new Map();

app.use((req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  if (ip) {
    const blocked = errorStore.getBlockedIps().find(b => b.ip === ip);
    if (blocked) {
      return res.status(403).json({ error: 'Your IP has been blocked due to repeated errors. Contact support.' });
    }
  }
  next();
});

// Request logging — logs auth, error, and slow requests
app.use(requestLogger);

// Serve uploaded files statically — public directories only
// Sensitive directories (kyc, proofs, evidence, ids) require auth via API routes
const uploadsPath = path.join(__dirname, 'uploads');
const publicUploadDirs = ['profiles', 'devices', 'transfers', 'misc'];
app.use('/uploads', (req, res, next) => {
  // Block access to sensitive subdirectories via static serving
  const firstSegment = req.path.split('/')[1];
  const sensitiveDirs = ['kyc', 'proofs', 'evidence', 'ids'];
  if (sensitiveDirs.includes(firstSegment)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}, express.static(uploadsPath, {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : '0',
  etag: true,
  lastModified: true
}));

// Trust proxy for rate limiting and IP detection
app.set('trust proxy', 1);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// CSP report endpoint
app.post('/api/csp-report', express.json({ type: 'application/csp-report' }), (req, res) => {
  console.warn('[CSP Violation]', JSON.stringify(req.body, null, 2));
  res.sendStatus(204);
});

// Core API routes (essential functionality only)
const kycRoutes = require('./routes/kyc');

app.use('/api/auth', authRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/device-management', deviceRoutes);
app.use('/api/public-check', publicCheckRoutes);
app.use('/api/report-management', reportRoutes);
app.use('/api/admin-portal', require('./routes/admin-portal'));
app.use('/api/files', require('./routes/files'));

// Essential enhanced routes
app.use('/api/profile', require('./routes/profile-management'));

// Admin and management routes
app.use('/api/admin-dashboard', require('./routes/admin-dashboard'));

// Enhanced security and recovery routes
app.use('/api/device-transfer', require('./routes/device-transfer'));
app.use('/api/recovery-services', require('./routes/recovery-services'));
app.use('/api/marketplace', require('./routes/marketplace'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/payments', require('./routes/payouts'));
app.use('/api/payments/webhook', require('./routes/payment-webhook'));
app.use('/api/checkout', require('./routes/checkout'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/escrow', require('./routes/escrow'));

// Revenue and security admin routes
app.use('/api/revenue-admin', require('./routes/revenue-admin'));

// Business customer onboarding
app.use('/api/business', require('./routes/business-onboarding'));

// Business registration and profile
app.use('/api/business-profile', require('./routes/business-registration'));

// Security endpoints (MFA, reauthentication)
app.use('/api/security', require('./routes/security-routes'));

// Additional routes
app.use('/api/lea-portal', require('./routes/lea-portal'));
app.use('/api/audit', require('./routes/audit-trail'));
app.use('/api/found-device', require('./routes/found-device'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/system-health', require('./routes/system-health'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/user-management', require('./routes/user-management'));
app.use('/api/admin-system', require('./routes/admin-system'));
app.use('/api/user-portal', require('./routes/user-portal'));
app.use('/api/landing-content', require('./routes/landing-content'));
app.use('/api/settings', require('./routes/settings-management'));
app.use('/api/dashboard-config', require('./routes/dashboard-config'));
app.use('/api/info', require('./routes/api-info'));
app.use('/api/search', require('./routes/search'));
app.use('/api/advanced-search', require('./routes/advanced-search'));

// Session management routes
app.use('/api/sessions', require('./routes/session-management'));

// PII encryption admin route
app.use('/api/admin/pii', require('./routes/pii-admin'));

// Archive, restore, deleted records management
app.use('/api/archive', require('./routes/archive'));

// API Documentation
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Prove Ownership API Documentation'
}));

// Serve OpenAPI JSON
app.get('/api/openapi.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpecs);
});

// Background jobs management (admin only)
app.get('/api/admin/jobs/status', (req, res) => {
  // Simple auth check
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const user = Database.verifyJWT(token);
    
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    res.json(BackgroundJobs.getStatus());
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.post('/api/admin/jobs/run', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const user = Database.verifyJWT(token);
    
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    await BackgroundJobs.runJobsNow();
    res.json({ success: true, message: 'Background jobs executed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to run background jobs' });
  }
});

// Response envelope middleware — wraps API responses in consistent { success, data } shape
app.use(responseEnvelope);

// Landing page — shows errors, blocked IPs, system status
app.get('/', (req, res) => {
  res.send(errorStore.renderLandingPage(req));
});

// Capture 404s as errors
app.use('*', (req, res) => {
  const err = new Error(`Endpoint not found: ${req.method} ${req.originalUrl}`);
  err.status = 404;
  errorStore.capture(err, req);
  res.status(404).json({ error: 'Endpoint not found' });
});

// Validation error handler — handles malformed JSON etc.
app.use(validationErrorHandler);

// Global error handler — captures all errors for the landing page
// Safest possible error contract: never crashes, never leaks internals,
// and always returns a well-formed JSON error response.
app.use((error, req, res, next) => {
  void next;
  const isDev = process.env.NODE_ENV === 'development';
  const message = (error && error.message) || String(error || 'Unknown error');
  if (isDev) console.error('Global error:', error);

  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;

  // Track IP failures for potential blocking
  const status = error?.status || error?.statusCode || 500;
  if (ip && status >= 400) {
    const count = (ipFailCount.get(ip) || 0) + 1;
    ipFailCount.set(ip, count);
    if (count >= IP_BLOCK_THRESHOLD) {
      errorStore.blockIp(ip, `Exceeded ${IP_BLOCK_THRESHOLD} error threshold`);
      ipFailCount.delete(ip);
    }
  }

  errorStore.capture(error, req);

  // If headers were already sent, we cannot send a JSON body — just terminate
  // the connection safely instead of throwing "headers already sent".
  if (res.headersSent) {
    return req.socket ? req.socket.destroy() : undefined;
  }

  // In production, never leak raw error messages (they may contain SQL, paths,
  // or internal details). Always return a clean, structured response.
  const responseBody = {
    error: isDev ? message : 'An unexpected error occurred. Please try again.'
  };

  try {
    return res.status(status).json(responseBody);
  } catch (sendErr) {
    console.error('Global error handler could not send response:', sendErr);
    try { res.end(); } catch (_) {}
    return undefined;
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await Database.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await Database.close();
  process.exit(0);
});

async function waitForDatabase(retries = 10, baseDelayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await Database.query('SELECT 1');
      return;
    } catch (err) {
      if (attempt === retries) {
        throw new Error(`Database unreachable after ${retries} attempts: ${err.message}`);
      }
      const delay = baseDelayMs * attempt;
      console.warn(`[db] Connection attempt ${attempt}/${retries} failed (${err.message}); retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function startServer() {
  // Wait for MySQL with retry/backoff so a temporarily unavailable database
  // (e.g. container still warming up) does not cause a transient boot failure
  // or a flood of connection errors. In production this is a hard requirement
  // before migrations and listening.
  try {
    await waitForDatabase();
  } catch (err) {
    console.error('[db] ' + err.message);
    if (process.env.NODE_ENV === 'production') {
      console.error('Aborting startup: database is required in production.');
      process.exit(1);
    }
    // Non-production: continue so the app (and its health/error endpoints)
    // still come up; DB-backed requests will surface their own errors.
  }

  try {
    await runMigrations();
  } catch (err) {
    console.error('Migration error (server will still start):', err.message);
  }

  app.listen(PORT, () => {
    console.log(`Prove Ownership API Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);

    if (process.env.NODE_ENV === 'development') {
      SystemMonitor.start();
    }
  });
}

if (require.main === module || !module.parent) {
  startServer();
}

module.exports = { app, startServer };