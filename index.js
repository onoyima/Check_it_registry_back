// Express.js Server - Replaces Supabase Edge Functions
// Main server file for Check It Device Registry

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const Database = require('./config');

// Import route handlers
const publicCheckRoutes = require('./routes/public-check');
const deviceManagementRoutes = require('./routes/device-management');
const reportManagementRoutes = require('./routes/report-management');
const adminPortalRoutes = require('./routes/admin-portal');
const adminSystemRoutes = require('./routes/admin-system');
const { router: authRoutes } = require('./routes/auth');
const deviceTransferRoutes = require('./routes/device-transfer');
const foundDeviceRoutes = require('./routes/found-device');
const leaPortalRoutes = require('./routes/lea-portal');
const userManagementRoutes = require('./routes/user-management');
const analyticsRoutes = require('./routes/analytics');
const systemHealthRoutes = require('./routes/system-health');
const filesRoutes = require('./routes/files');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/public-check', publicCheckRoutes);
app.use('/api/device-management', deviceManagementRoutes);
app.use('/api/report-management', reportManagementRoutes);
app.use('/api/admin-portal', adminPortalRoutes);
app.use('/api/admin-system', adminSystemRoutes);
app.use('/api/device-transfer', deviceTransferRoutes);
app.use('/api/found-device', foundDeviceRoutes);
app.use('/api/lea-portal', leaPortalRoutes);
app.use('/api/user-management', userManagementRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/system-health', systemHealthRoutes);
app.use('/api/files', filesRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
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
  console.log(`✅ Check It API Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});

module.exports = app;