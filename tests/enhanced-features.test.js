const request = require('supertest');
const app = require('../app');
const Database = require('../config');

describe('Enhanced Features API Tests', () => {
  let authToken;
  let adminToken;
  let testUserId;
  let testDeviceId;

  beforeAll(async () => {
    // Setup test database connection
    await Database.connect();
    
    // Create test user and get auth token
    const userResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'TestPass123!',
        role: 'user'
      });

    testUserId = userResponse.body.user.id;
    authToken = userResponse.body.token;

    // Create admin user
    const adminResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Admin User',
        email: 'admin@example.com',
        password: 'AdminPass123!',
        role: 'admin'
      });

    adminToken = adminResponse.body.token;
  });

  afterAll(async () => {
    // Cleanup test data
    await Database.query('DELETE FROM users WHERE email IN (?, ?)', 
      ['test@example.com', 'admin@example.com']);
    await Database.disconnect();
  });

  describe('Profile Management', () => {
    test('GET /api/profile/profile - should get user profile', async () => {
      const response = await request(app)
        .get('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.profile).toHaveProperty('id', testUserId);
      expect(response.body.profile).toHaveProperty('name', 'Test User');
      expect(response.body.profile).toHaveProperty('email', 'test@example.com');
      expect(response.body.profile).toHaveProperty('stats');
    });

    test('PUT /api/profile/profile - should update user profile', async () => {
      const updateData = {
        name: 'Updated Test User',
        phone: '+234 801 234 5678',
        region: 'lagos'
      };

      const response = await request(app)
        .put('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.message).toBe('Profile updated successfully');

      // Verify the update
      const profileResponse = await request(app)
        .get('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(profileResponse.body.profile.name).toBe('Updated Test User');
      expect(profileResponse.body.profile.phone).toBe('+234 801 234 5678');
      expect(profileResponse.body.profile.region).toBe('lagos');
    });

    test('PUT /api/profile/profile - should validate input', async () => {
      const invalidData = {
        name: 'A', // Too short
        phone: 'invalid-phone',
        region: 'a'.repeat(100) // Too long
      };

      await request(app)
        .put('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    test('PUT /api/profile/password - should change password', async () => {
      const passwordData = {
        currentPassword: 'TestPass123!',
        newPassword: 'NewTestPass123!'
      };

      const response = await request(app)
        .put('/api/profile/password')
        .set('Authorization', `Bearer ${authToken}`)
        .send(passwordData)
        .expect(200);

      expect(response.body.message).toBe('Password changed successfully');

      // Test login with new password
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'NewTestPass123!'
        })
        .expect(200);

      expect(loginResponse.body).toHaveProperty('token');
    });

    test('GET /api/profile/activity - should get user activity', async () => {
      const response = await request(app)
        .get('/api/profile/activity')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('activities');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.activities)).toBe(true);
    });
  });

  describe('Settings Management', () => {
    test('GET /api/settings/preferences - should get user preferences', async () => {
      const response = await request(app)
        .get('/api/settings/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('preferences');
      expect(response.body.preferences).toHaveProperty('email_notifications');
      expect(response.body.preferences).toHaveProperty('sms_notifications');
    });

    test('PUT /api/settings/notifications - should update notification preferences', async () => {
      const notificationSettings = {
        email_notifications: true,
        sms_notifications: false,
        push_notifications: true,
        device_alerts: true,
        transfer_notifications: false,
        verification_notifications: true,
        report_updates: true,
        marketing_emails: false
      };

      const response = await request(app)
        .put('/api/settings/notifications')
        .set('Authorization', `Bearer ${authToken}`)
        .send(notificationSettings)
        .expect(200);

      expect(response.body.message).toBe('Notification preferences updated successfully');
    });

    test('PUT /api/settings/appearance - should update appearance preferences', async () => {
      const appearanceSettings = {
        theme_preference: 'dark',
        language_preference: 'en',
        timezone: 'Africa/Lagos'
      };

      const response = await request(app)
        .put('/api/settings/appearance')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appearanceSettings)
        .expect(200);

      expect(response.body.message).toBe('Appearance preferences updated successfully');
    });

    test('POST /api/settings/security/revoke-sessions - should revoke all sessions', async () => {
      const response = await request(app)
        .post('/api/settings/security/revoke-sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toContain('sessions have been revoked');
      expect(response.body).toHaveProperty('revoked_sessions');
    });
  });

  describe('Admin Dashboard', () => {
    test('GET /api/admin-dashboard/overview - should get dashboard overview', async () => {
      const response = await request(app)
        .get('/api/admin-dashboard/overview')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('stats');
      expect(response.body.stats).toHaveProperty('users');
      expect(response.body.stats).toHaveProperty('devices');
      expect(response.body.stats).toHaveProperty('reports');
      expect(response.body.stats).toHaveProperty('system');
      expect(response.body).toHaveProperty('recent_activity');
      expect(response.body).toHaveProperty('verification_queue');
    });

    test('GET /api/admin-dashboard/performance - should get performance metrics', async () => {
      const response = await request(app)
        .get('/api/admin-dashboard/performance')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('database');
      expect(response.body).toHaveProperty('api');
      expect(response.body).toHaveProperty('hourly_activity');
      expect(response.body).toHaveProperty('top_errors');
    });

    test('GET /api/admin-dashboard/users/summary - should get user management summary', async () => {
      const response = await request(app)
        .get('/api/admin-dashboard/users/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('role_distribution');
      expect(response.body).toHaveProperty('regional_distribution');
      expect(response.body).toHaveProperty('recent_registrations');
      expect(response.body).toHaveProperty('activity_summary');
    });

    test('GET /api/admin-dashboard/security/overview - should get security overview', async () => {
      const response = await request(app)
        .get('/api/admin-dashboard/security/overview')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('security_events');
      expect(response.body).toHaveProperty('suspicious_ips');
      expect(response.body).toHaveProperty('recent_alerts');
      expect(response.body).toHaveProperty('two_factor_stats');
    });

    test('GET /api/admin-dashboard/alerts - should get system alerts', async () => {
      const response = await request(app)
        .get('/api/admin-dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('alerts');
      expect(response.body).toHaveProperty('summary');
      expect(Array.isArray(response.body.alerts)).toBe(true);
    });

    test('Admin routes should require admin role', async () => {
      await request(app)
        .get('/api/admin-dashboard/overview')
        .set('Authorization', `Bearer ${authToken}`) // Regular user token
        .expect(403);
    });
  });

  describe('Audit Trail', () => {
    test('GET /api/audit/logs - should get audit logs (admin only)', async () => {
      const response = await request(app)
        .get('/api/audit/logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('logs');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.logs)).toBe(true);
    });

    test('GET /api/audit/logs with filters - should filter audit logs', async () => {
      const response = await request(app)
        .get('/api/audit/logs?severity=high&resource_type=auth&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.filters.severity).toBe('high');
      expect(response.body.filters.resource_type).toBe('auth');
      expect(response.body.pagination.limit).toBe(10);
    });

    test('GET /api/audit/stats - should get audit statistics', async () => {
      const response = await request(app)
        .get('/api/audit/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('overview');
      expect(response.body).toHaveProperty('top_actions');
      expect(response.body).toHaveProperty('top_users');
      expect(response.body).toHaveProperty('hourly_activity');
      expect(response.body).toHaveProperty('security_events');
    });

    test('GET /api/audit/system-health - should get system health', async () => {
      const response = await request(app)
        .get('/api/audit/system-health')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('database');
      expect(response.body).toHaveProperty('error_rates');
      expect(response.body).toHaveProperty('active_sessions');
      expect(response.body).toHaveProperty('performance');
    });

    test('Audit routes should require admin role', async () => {
      await request(app)
        .get('/api/audit/logs')
        .set('Authorization', `Bearer ${authToken}`) // Regular user token
        .expect(403);
    });
  });

  describe('Data Export', () => {
    test('POST /api/settings/data-export - should request data export', async () => {
      const response = await request(app)
        .post('/api/settings/data-export')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ export_type: 'profile' })
        .expect(200);

      expect(response.body.message).toBe('Data export request submitted successfully');
      expect(response.body).toHaveProperty('export_id');
      expect(response.body).toHaveProperty('estimated_completion');
    });

    test('GET /api/settings/data-export/status - should get export status', async () => {
      const response = await request(app)
        .get('/api/settings/data-export/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('exports');
      expect(Array.isArray(response.body.exports)).toBe(true);
    });

    test('POST /api/settings/data-export - should prevent multiple pending exports', async () => {
      // First request
      await request(app)
        .post('/api/settings/data-export')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ export_type: 'full' })
        .expect(200);

      // Second request should fail
      await request(app)
        .post('/api/settings/data-export')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ export_type: 'devices' })
        .expect(400);
    });
  });

  describe('API Key Management', () => {
    let apiKeyId;

    test('POST /api/settings/api-keys - should create API key', async () => {
      const keyData = {
        name: 'Test API Key',
        permissions: ['read:devices', 'write:reports'],
        expires_in_days: 30
      };

      const response = await request(app)
        .post('/api/settings/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send(keyData)
        .expect(200);

      expect(response.body.message).toBe('API key created successfully');
      expect(response.body).toHaveProperty('api_key');
      expect(response.body).toHaveProperty('key_prefix');
      expect(response.body).toHaveProperty('expires_at');
      expect(response.body.api_key).toMatch(/^ck_[a-f0-9]{16}_[a-f0-9]{64}$/);
    });

    test('GET /api/settings/api-keys - should list API keys', async () => {
      const response = await request(app)
        .get('/api/settings/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('api_keys');
      expect(Array.isArray(response.body.api_keys)).toBe(true);
      
      if (response.body.api_keys.length > 0) {
        apiKeyId = response.body.api_keys[0].id;
        expect(response.body.api_keys[0]).toHaveProperty('name');
        expect(response.body.api_keys[0]).toHaveProperty('key_prefix');
        expect(response.body.api_keys[0]).not.toHaveProperty('key_hash'); // Should not expose hash
      }
    });

    test('DELETE /api/settings/api-keys/:id - should revoke API key', async () => {
      if (apiKeyId) {
        const response = await request(app)
          .delete(`/api/settings/api-keys/${apiKeyId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.message).toBe('API key revoked successfully');
      }
    });
  });

  describe('Input Validation', () => {
    test('Should validate required fields', async () => {
      const response = await request(app)
        .put('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({}) // Empty body
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'name',
            message: expect.stringContaining('required')
          })
        ])
      );
    });

    test('Should validate field lengths', async () => {
      const response = await request(app)
        .put('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'A', // Too short
          region: 'a'.repeat(100) // Too long
        })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
    });

    test('Should validate email format', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'invalid-email',
          password: 'TestPass123!',
          role: 'user'
        })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
    });

    test('Should validate password strength', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test2@example.com',
          password: 'weak', // Weak password
          role: 'user'
        })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('Error Handling', () => {
    test('Should handle unauthorized requests', async () => {
      await request(app)
        .get('/api/profile/profile')
        .expect(401);
    });

    test('Should handle invalid tokens', async () => {
      await request(app)
        .get('/api/profile/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    test('Should handle non-existent resources', async () => {
      const fakeId = '123e4567-e89b-12d3-a456-426614174000';
      
      await request(app)
        .get(`/api/audit/logs/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    test('Should handle malformed JSON', async () => {
      const response = await request(app)
        .put('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      expect(response.body.error).toBe('Invalid JSON format');
    });
  });

  describe('Security', () => {
    test('Should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    });

    test('Should sanitize input', async () => {
      const maliciousInput = {
        name: '<script>alert("xss")</script>Test User',
        region: 'lagos<img src=x onerror=alert(1)>'
      };

      await request(app)
        .put('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(maliciousInput)
        .expect(200);

      // Verify the input was sanitized
      const profileResponse = await request(app)
        .get('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(profileResponse.body.profile.name).not.toContain('<script>');
      expect(profileResponse.body.profile.region).not.toContain('<img');
    });

    test('Should prevent SQL injection', async () => {
      const sqlInjection = "'; DROP TABLE users; --";
      
      const response = await request(app)
        .put('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: sqlInjection,
          region: 'lagos'
        })
        .expect(200);

      // Verify user still exists (table wasn't dropped)
      await request(app)
        .get('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });
  });
});

// Performance tests
describe('Performance Tests', () => {
  let authToken;

  beforeAll(async () => {
    const userResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Perf Test User',
        email: 'perf@example.com',
        password: 'PerfPass123!',
        role: 'user'
      });

    authToken = userResponse.body.token;
  });

  afterAll(async () => {
    await Database.query('DELETE FROM users WHERE email = ?', ['perf@example.com']);
  });

  test('Profile endpoint should respond within 500ms', async () => {
    const start = Date.now();
    
    await request(app)
      .get('/api/profile/profile')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(500);
  });

  test('Should handle concurrent requests', async () => {
    const promises = Array(10).fill().map(() =>
      request(app)
        .get('/api/profile/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(10);
    results.forEach(result => {
      expect(result.status).toBe(200);
    });
  });
});