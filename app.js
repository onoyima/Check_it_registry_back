// Main Express Server - MySQL Version
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const Database = require('./config');

// Import services
const BackgroundJobs = require('./services/BackgroundJobs');
const SystemMonitor = require('./services/SystemMonitorService');
const { runMigrations } = require('./services/migrations');
const errorStore = require('./services/ErrorStore');

// Import middleware
const { validationErrorHandler } = require('./middleware/validation');

// Import routes
const { router: authRoutes } = require('./routes/auth');
const deviceRoutes = require('./routes/device-management');
const publicCheckRoutes = require('./routes/public-check');
const reportRoutes = require('./routes/report-management');
const adminRoutes = require('./routes/admin-portal');

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// Apply custom security headers to match test expectations
app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block'
  });
  next();
});

// Response compression
app.use(compression());

// CORS: allow local dev ports and custom headers for device check context
const isDev = (process.env.NODE_ENV || 'development') !== 'production';
app.use(cors({
  origin: isDev ? true : (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, ''),
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
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', apiLimiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' }
});
app.use('/api/auth/', authLimiter);

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

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

// Core API routes (essential functionality only)
const kycRoutes = require('./routes/kyc');

// ... existing routes ...
app.use('/api/auth', authRoutes);
app.use('/api/kyc', kycRoutes); // Add KYC routes
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
app.use('/api/orders', require('./routes/orders'));
app.use('/api/escrow', require('./routes/escrow'));

// Revenue and security admin routes
app.use('/api/revenue-admin', require('./routes/revenue-admin'));

// Business customer onboarding
app.use('/api/business', require('./routes/business-onboarding'));

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

// API Documentation
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Check It API Documentation'
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

// Validation error handler — handles malformed JSON etc.
app.use(validationErrorHandler);

// Global error handler — captures all errors for the landing page
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  
  // Track IP failures for potential blocking
  if (ip && error.status >= 400) {
    const count = (ipFailCount.get(ip) || 0) + 1;
    ipFailCount.set(ip, count);
    if (count >= IP_BLOCK_THRESHOLD) {
      errorStore.blockIp(ip, `Exceeded ${IP_BLOCK_THRESHOLD} error threshold (${count} errors)`);
      ipFailCount.delete(ip);
    }
  }
  
  errorStore.capture(error, req);
  
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(error.status || 500).json({
    error: isDevelopment ? error.message : 'Internal server error',
    ...(isDevelopment && { stack: error.stack })
  });
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

async function startServer() {
  try {
    await runMigrations();
  } catch (err) {
    console.error('Migration error (server will still start):', err.message);
  }

  app.listen(PORT, () => {
    console.log(`Check It API Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);

    if (process.env.NODE_ENV === 'development') {
      BackgroundJobs.start();
      SystemMonitor.start();
    }
  });
}

if (require.main === module || !module.parent) {
  startServer();
}

module.exports = { app, startServer };