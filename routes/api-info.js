// API Information and Status Routes
const express = require('express');
const Database = require('../config');
const BackgroundJobs = require('../services/BackgroundJobs');

const router = express.Router();

// Get API status and information (public endpoint)
router.get('/status', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Test database connectivity
    let dbStatus = 'healthy';
    let dbResponseTime = 0;
    try {
      const dbStart = Date.now();
      await Database.query('SELECT 1 as test');
      dbResponseTime = Date.now() - dbStart;
      if (dbResponseTime > 1000) dbStatus = 'slow';
    } catch (error) {
      dbStatus = 'error';
    }

    // Get basic system stats
    const stats = await Database.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM devices) as total_devices,
        (SELECT COUNT(*) FROM reports) as total_reports,
        (SELECT COUNT(*) FROM imei_checks) as total_checks
    `).catch(() => [{ total_users: 0, total_devices: 0, total_reports: 0, total_checks: 0 }]);

    const responseTime = Date.now() - startTime;

    res.json({
      api_name: 'Check It Device Registry API',
      version: '1.0.0',
      status: 'operational',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      response_time_ms: responseTime,
      database: {
        status: dbStatus,
        response_time_ms: dbResponseTime
      },
      background_jobs: {
        running: BackgroundJobs.getStatus().running
      },
      statistics: stats[0] || {},
      endpoints: {
        documentation: '/api/docs',
        health_check: '/health',
        openapi_spec: '/api/openapi.json'
      },
      features: {
        authentication: 'JWT',
        file_uploads: true,
        notifications: true,
        background_processing: true,
        rate_limiting: false,
        captcha: false
      }
    });

  } catch (error) {
    console.error('API status error:', error);
    res.status(500).json({
      api_name: 'Check It Device Registry API',
      status: 'error',
      error: 'Failed to retrieve API status',
      timestamp: new Date().toISOString()
    });
  }
});

// Get comprehensive API information
router.get('/info', async (req, res) => {
  try {
    const apiInfo = {
      api: {
        name: 'Check It Device Registry API',
        version: '1.0.0',
        description: 'Smart Device Registry & Recovery System API',
        base_url: process.env.BASE_URL || 'http://localhost:3006',
        documentation_url: `${process.env.BASE_URL || 'http://localhost:3006'}/api/docs`
      },
      authentication: {
        type: 'JWT Bearer Token',
        header: 'Authorization: Bearer <token>',
        login_endpoint: '/api/auth/login',
        register_endpoint: '/api/auth/register',
        token_expiry: '24 hours'
      },
      endpoints: {
        public: [
          {
            path: '/api/public-check',
            method: 'GET',
            description: 'Check device status by IMEI or serial number',
            parameters: ['imei', 'serial'],
            authentication: false
          },
          {
            path: '/api/found-device/report',
            method: 'POST',
            description: 'Report a found device',
            authentication: false
          },
          {
            path: '/api/found-device/check',
            method: 'GET',
            description: 'Check if device can be reported as found',
            authentication: false
          }
        ],
        authenticated: [
          {
            category: 'Device Management',
            endpoints: [
              {
                path: '/api/device-management',
                methods: ['GET', 'POST'],
                description: 'Manage user devices'
              },
              {
                path: '/api/device-management/:id',
                methods: ['GET', 'PUT', 'DELETE'],
                description: 'Individual device operations'
              }
            ]
          },
          {
            category: 'Report Management',
            endpoints: [
              {
                path: '/api/report-management',
                methods: ['GET', 'POST'],
                description: 'Manage theft/loss reports'
              },
              {
                path: '/api/report-management/:case_id',
                methods: ['GET', 'PUT'],
                description: 'Individual report operations'
              }
            ]
          },
          {
            category: 'Device Transfer',
            endpoints: [
              {
                path: '/api/device-transfer/initiate',
                method: 'POST',
                description: 'Initiate device ownership transfer'
              },
              {
                path: '/api/device-transfer/accept',
                method: 'POST',
                description: 'Accept device transfer with OTP'
              },
              {
                path: '/api/device-transfer/requests',
                method: 'GET',
                description: 'List transfer requests'
              }
            ]
          },
          {
            category: 'File Management',
            endpoints: [
              {
                path: '/api/files/upload/proof',
                method: 'POST',
                description: 'Upload proof of ownership document'
              },
              {
                path: '/api/files/upload/device-image',
                method: 'POST',
                description: 'Upload device image'
              },
              {
                path: '/api/files/view/:subdir/:filename',
                method: 'GET',
                description: 'View uploaded files'
              }
            ]
          }
        ],
        admin_only: [
          {
            category: 'Admin Portal',
            endpoints: [
              {
                path: '/api/admin-portal/stats',
                method: 'GET',
                description: 'Get admin dashboard statistics'
              },
              {
                path: '/api/admin-portal/verification-queue',
                method: 'GET',
                description: 'Get device verification queue'
              },
              {
                path: '/api/admin-portal/verify-device/:id',
                method: 'POST',
                description: 'Verify device registration'
              }
            ]
          },
          {
            category: 'User Management',
            endpoints: [
              {
                path: '/api/user-management/users',
                method: 'GET',
                description: 'List all users with filtering'
              },
              {
                path: '/api/user-management/users/:id/role',
                method: 'PUT',
                description: 'Update user role'
              }
            ]
          },
          {
            category: 'Analytics',
            endpoints: [
              {
                path: '/api/analytics/dashboard',
                method: 'GET',
                description: 'Get comprehensive analytics'
              },
              {
                path: '/api/analytics/hotspots',
                method: 'GET',
                description: 'Get theft hotspot analysis'
              }
            ]
          },
          {
            category: 'System Health',
            endpoints: [
              {
                path: '/api/system-health/status',
                method: 'GET',
                description: 'Get system health status'
              },
              {
                path: '/api/system-health/audit-logs',
                method: 'GET',
                description: 'Get audit logs'
              }
            ]
          }
        ],
        lea_only: [
          {
            category: 'LEA Portal',
            endpoints: [
              {
                path: '/api/lea-portal/stats',
                method: 'GET',
                description: 'Get LEA dashboard statistics'
              },
              {
                path: '/api/lea-portal/cases',
                method: 'GET',
                description: 'List assigned cases'
              },
              {
                path: '/api/lea-portal/cases/:caseId/status',
                method: 'PUT',
                description: 'Update case status'
              }
            ]
          }
        ]
      },
      data_models: {
        User: {
          id: 'string (UUID)',
          name: 'string',
          email: 'string',
          role: 'enum (user, business, admin, lea)',
          region: 'string',
          created_at: 'datetime'
        },
        Device: {
          id: 'string (UUID)',
          user_id: 'string (UUID)',
          imei: 'string (15 digits)',
          serial: 'string',
          brand: 'string',
          model: 'string',
          status: 'enum (verified, unverified, stolen, lost, found, pending_transfer)',
          proof_url: 'string (URL)',
          created_at: 'datetime'
        },
        Report: {
          id: 'string (UUID)',
          device_id: 'string (UUID)',
          case_id: 'string (CASE-YYYY-XXXXXX)',
          report_type: 'enum (stolen, lost, found)',
          status: 'enum (open, under_review, resolved, dismissed)',
          description: 'string',
          location: 'string',
          occurred_at: 'datetime',
          created_at: 'datetime'
        }
      },
      response_formats: {
        success: {
          success: true,
          data: '...',
          message: 'Optional success message'
        },
        error: {
          error: 'Error message',
          message: 'Optional detailed message',
          code: 'Optional error code'
        },
        pagination: {
          data: '...',
          pagination: {
            page: 'number',
            limit: 'number',
            total: 'number',
            pages: 'number'
          }
        }
      },
      status_codes: {
        200: 'Success',
        201: 'Created',
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        409: 'Conflict',
        500: 'Internal Server Error'
      },
      contact: {
        support_email: process.env.ADMIN_EMAIL || 'admin@checkit.local',
        documentation: '/api/docs',
        postman_collection: '/postman/Check-It-API.postman_collection.json'
      }
    };

    res.json(apiInfo);

  } catch (error) {
    console.error('API info error:', error);
    res.status(500).json({ error: 'Failed to retrieve API information' });
  }
});

// Get API usage statistics
router.get('/usage-stats', async (req, res) => {
  try {
    const { period = '7' } = req.query;
    const days = parseInt(period);

    const usageStats = await Database.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total_requests,
        COUNT(DISTINCT ip_address) as unique_ips
      FROM imei_checks
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [days]);

    const endpointStats = await Database.query(`
      SELECT 
        action as endpoint_type,
        COUNT(*) as request_count
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      AND action IN ('LOGIN', 'DEVICE_REGISTERED', 'REPORT_CREATED', 'PUBLIC_CHECK')
      GROUP BY action
      ORDER BY request_count DESC
    `, [days]);

    const userActivity = await Database.query(`
      SELECT 
        COUNT(CASE WHEN action = 'LOGIN' THEN 1 END) as logins,
        COUNT(CASE WHEN action = 'REGISTER' THEN 1 END) as registrations,
        COUNT(DISTINCT user_id) as active_users
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [days]);

    res.json({
      success: true,
      period_days: days,
      usage_by_date: usageStats,
      endpoint_usage: endpointStats,
      user_activity: userActivity[0] || {},
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Usage stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve usage statistics' });
  }
});

// Get API changelog/version history
router.get('/changelog', (req, res) => {
  const changelog = [
    {
      version: '1.0.0',
      date: '2024-01-15',
      changes: [
        'Initial release of Check It Device Registry API',
        'Complete authentication system with JWT',
        'Device registration and verification',
        'Public device checking',
        'Theft/loss reporting system',
        'LEA portal for case management',
        'Device transfer system with OTP',
        'Found device workflow',
        'File upload system',
        'Background job processing',
        'Comprehensive admin dashboard',
        'Analytics and reporting',
        'System health monitoring',
        'User management system',
        'Email notification system'
      ],
      breaking_changes: [],
      deprecations: []
    }
  ];

  res.json({
    success: true,
    changelog: changelog,
    current_version: '1.0.0'
  });
});

module.exports = router;