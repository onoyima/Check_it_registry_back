// Main Express Server - MySQL Version
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
// const rateLimit = require('express-rate-limit'); // Disabled for development
const Database = require('./config');

// Import services
const BackgroundJobs = require('./services/BackgroundJobs');
const SystemMonitor = require('./services/SystemMonitorService');

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

// Rate limiting disabled as requested
console.log('ℹ️  Rate limiting disabled - all endpoints unrestricted');

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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

// Optional routes (can be enabled as needed)
app.use('/api/lea-portal', require('./routes/lea-portal'));
app.use('/api/audit-trail', require('./routes/audit-trail'));
// app.use('/api/found-device', require('./routes/found-device'));
// app.use('/api/test-email', require('./routes/test-email'));
// app.use('/api/analytics', require('./routes/analytics'));
// app.use('/api/system-health', require('./routes/system-health'));
app.use('/api/user-management', require('./routes/user-management'));
// app.use('/api/dashboard-config', require('./routes/dashboard-config'));
// app.use('/api/info', require('./routes/api-info'));
app.use('/api/admin-system', require('./routes/admin-system'));
app.use('/api/user-portal', require('./routes/user-portal'));
app.use('/api/landing-content', require('./routes/landing-content'));
// app.use('/api/settings', require('./routes/settings-management'));
// app.use('/api/audit', require('./routes/audit-trail'));

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

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  // Don't leak error details in production
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

// Start server
app.listen(PORT, () => {
  console.log(`Check It API Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  
  // Start background jobs in development (for testing)
  if (process.env.NODE_ENV === 'development') {
    console.log('🚀 Starting background jobs for development...');
    BackgroundJobs.start();
    
    console.log('🔍 Starting system monitoring...');
    SystemMonitor.start();
  }
});

module.exports = app;