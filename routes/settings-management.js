const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateInput, sanitizeInput } = require('../middleware/validation');
const { logActivity } = require('../services/AuditService');
const router = express.Router();

// Get user settings and preferences
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const connection = req.app.get('db');

    // Get user preferences
    const [userRows] = await connection.execute(`
      SELECT 
        email_notifications,
        sms_notifications,
        push_notifications,
        device_alerts,
        transfer_notifications,
        verification_notifications,
        report_updates,
        marketing_emails,
        theme_preference,
        language_preference,
        timezone,
        two_factor_enabled,
        session_timeout,
        auto_logout_enabled
      FROM users 
      WHERE id = ?
    `, [req.user.id]);

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const preferences = userRows[0];

    // Get user's active sessions
    const [sessions] = await connection.execute(`
      SELECT 
        id,
        ip_address,
        user_agent,
        created_at,
        last_activity,
        is_current
      FROM user_sessions 
      WHERE user_id = ? AND expires_at > NOW()
      ORDER BY last_activity DESC
    `, [req.user.id]);

    res.json({
      preferences,
      active_sessions: sessions
    });
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    res.status(500).json({ error: 'Failed to fetch user preferences' });
  }
});

// Update notification preferences
router.put('/notifications', authenticateToken, async (req, res) => {
  try {
    const connection = req.app.get('db');
    const {
      email_notifications,
      sms_notifications,
      push_notifications,
      device_alerts,
      transfer_notifications,
      verification_notifications,
      report_updates,
      marketing_emails
    } = req.body;

    await connection.execute(`
      UPDATE users 
      SET 
        email_notifications = ?,
        sms_notifications = ?,
        push_notifications = ?,
        device_alerts = ?,
        transfer_notifications = ?,
        verification_notifications = ?,
        report_updates = ?,
        marketing_emails = ?,
        updated_at = NOW()
      WHERE id = ?
    `, [
      Boolean(email_notifications),
      Boolean(sms_notifications),
      Boolean(push_notifications),
      Boolean(device_alerts),
      Boolean(transfer_notifications),
      Boolean(verification_notifications),
      Boolean(report_updates),
      Boolean(marketing_emails),
      req.user.id
    ]);

    await logActivity(connection, req.user.id, 'notification_preferences_updated', 'user', req.user.id, 
      'User updated notification preferences', req.ip, req.get('User-Agent'));

    res.json({ message: 'Notification preferences updated successfully' });
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

// Update appearance preferences
router.put('/appearance', authenticateToken, [
  validateInput('theme_preference', { required: false, enum: ['light', 'dark', 'auto'] }),
  validateInput('language_preference', { required: false, enum: ['en', 'ha', 'yo', 'ig'] }),
  validateInput('timezone', { required: false, maxLength: 50 })
], async (req, res) => {
  try {
    const connection = req.app.get('db');
    const { theme_preference, language_preference, timezone } = sanitizeInput(req.body);

    await connection.execute(`
      UPDATE users 
      SET 
        theme_preference = COALESCE(?, theme_preference),
        language_preference = COALESCE(?, language_preference),
        timezone = COALESCE(?, timezone),
        updated_at = NOW()
      WHERE id = ?
    `, [theme_preference, language_preference, timezone, req.user.id]);

    await logActivity(connection, req.user.id, 'appearance_preferences_updated', 'user', req.user.id, 
      'User updated appearance preferences', req.ip, req.get('User-Agent'));

    res.json({ message: 'Appearance preferences updated successfully' });
  } catch (error) {
    console.error('Error updating appearance preferences:', error);
    res.status(500).json({ error: 'Failed to update appearance preferences' });
  }
});

// Update privacy preferences
router.put('/privacy', authenticateToken, async (req, res) => {
  try {
    const connection = req.app.get('db');
    const {
      profile_visibility,
      show_online_status,
      allow_contact_from_strangers,
      data_sharing_consent,
      analytics_consent
    } = req.body;

    await connection.execute(`
      UPDATE users 
      SET 
        profile_visibility = COALESCE(?, profile_visibility),
        show_online_status = COALESCE(?, show_online_status),
        allow_contact_from_strangers = COALESCE(?, allow_contact_from_strangers),
        data_sharing_consent = COALESCE(?, data_sharing_consent),
        analytics_consent = COALESCE(?, analytics_consent),
        updated_at = NOW()
      WHERE id = ?
    `, [
      profile_visibility,
      Boolean(show_online_status),
      Boolean(allow_contact_from_strangers),
      Boolean(data_sharing_consent),
      Boolean(analytics_consent),
      req.user.id
    ]);

    await logActivity(connection, req.user.id, 'privacy_preferences_updated', 'user', req.user.id, 
      'User updated privacy preferences', req.ip, req.get('User-Agent'));

    res.json({ message: 'Privacy preferences updated successfully' });
  } catch (error) {
    console.error('Error updating privacy preferences:', error);
    res.status(500).json({ error: 'Failed to update privacy preferences' });
  }
});

// Update security settings
router.put('/security', authenticateToken, [
  validateInput('session_timeout', { required: false, type: 'number', min: 15, max: 1440 }),
  validateInput('auto_logout_enabled', { required: false, type: 'boolean' })
], async (req, res) => {
  try {
    const connection = req.app.get('db');
    const { session_timeout, auto_logout_enabled, require_password_change } = req.body;

    await connection.execute(`
      UPDATE users 
      SET 
        session_timeout = COALESCE(?, session_timeout),
        auto_logout_enabled = COALESCE(?, auto_logout_enabled),
        require_password_change = COALESCE(?, require_password_change),
        updated_at = NOW()
      WHERE id = ?
    `, [
      session_timeout,
      Boolean(auto_logout_enabled),
      Boolean(require_password_change),
      req.user.id
    ]);

    await logActivity(connection, req.user.id, 'security_settings_updated', 'security', req.user.id, 
      'User updated security settings', req.ip, req.get('User-Agent'));

    res.json({ message: 'Security settings updated successfully' });
  } catch (error) {
    console.error('Error updating security settings:', error);
    res.status(500).json({ error: 'Failed to update security settings' });
  }
});

// Revoke all sessions except current
router.post('/security/revoke-sessions', authenticateToken, async (req, res) => {
  try {
    const connection = req.app.get('db');

    // Get current session ID from token or create logic to identify current session
    const currentSessionId = req.session?.id || req.headers['x-session-id'];

    let query = 'UPDATE user_sessions SET expires_at = NOW() WHERE user_id = ?';
    let params = [req.user.id];

    if (currentSessionId) {
      query += ' AND id != ?';
      params.push(currentSessionId);
    }

    const [result] = await connection.execute(query, params);

    await logActivity(connection, req.user.id, 'sessions_revoked', 'security', req.user.id, 
      `User revoked ${result.affectedRows} active sessions`, req.ip, req.get('User-Agent'));

    res.json({ 
      message: 'All other sessions have been revoked successfully',
      revoked_sessions: result.affectedRows
    });
  } catch (error) {
    console.error('Error revoking sessions:', error);
    res.status(500).json({ error: 'Failed to revoke sessions' });
  }
});

// Get API keys (for advanced users)
router.get('/api-keys', authenticateToken, async (req, res) => {
  try {
    const connection = req.app.get('db');

    const [apiKeys] = await connection.execute(`
      SELECT 
        id,
        name,
        key_prefix,
        permissions,
        last_used_at,
        expires_at,
        created_at,
        is_active
      FROM api_keys 
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [req.user.id]);

    res.json({ api_keys: apiKeys });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Create new API key
router.post('/api-keys', authenticateToken, [
  validateInput('name', { required: true, minLength: 3, maxLength: 50 }),
  validateInput('permissions', { required: true, type: 'array' }),
  validateInput('expires_in_days', { required: false, type: 'number', min: 1, max: 365 })
], async (req, res) => {
  try {
    const connection = req.app.get('db');
    const { name, permissions, expires_in_days = 90 } = sanitizeInput(req.body);

    // Generate API key
    const crypto = require('crypto');
    const keyPrefix = 'ck_' + crypto.randomBytes(8).toString('hex');
    const keySecret = crypto.randomBytes(32).toString('hex');
    const fullKey = keyPrefix + '_' + keySecret;
    const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_in_days);

    await connection.execute(`
      INSERT INTO api_keys (
        user_id, name, key_prefix, key_hash, permissions, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [
      req.user.id,
      name,
      keyPrefix,
      keyHash,
      JSON.stringify(permissions),
      expiresAt
    ]);

    await logActivity(connection, req.user.id, 'api_key_created', 'security', req.user.id, 
      `User created API key: ${name}`, req.ip, req.get('User-Agent'));

    res.json({ 
      message: 'API key created successfully',
      api_key: fullKey,
      key_prefix: keyPrefix,
      expires_at: expiresAt,
      warning: 'This is the only time you will see the full API key. Please store it securely.'
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Revoke API key
router.delete('/api-keys/:id', authenticateToken, async (req, res) => {
  try {
    const connection = req.app.get('db');
    const { id } = req.params;

    // Verify the API key belongs to the user
    const [keyRows] = await connection.execute(
      'SELECT name FROM api_keys WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );

    if (keyRows.length === 0) {
      return res.status(404).json({ error: 'API key not found' });
    }

    await connection.execute(
      'UPDATE api_keys SET is_active = FALSE, updated_at = NOW() WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );

    await logActivity(connection, req.user.id, 'api_key_revoked', 'security', id, 
      `User revoked API key: ${keyRows[0].name}`, req.ip, req.get('User-Agent'));

    res.json({ message: 'API key revoked successfully' });
  } catch (error) {
    console.error('Error revoking API key:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// Get data export status
router.get('/data-export/status', authenticateToken, async (req, res) => {
  try {
    const connection = req.app.get('db');

    const [exports] = await connection.execute(`
      SELECT 
        id,
        export_type,
        status,
        file_path,
        file_size,
        created_at,
        completed_at,
        expires_at
      FROM data_exports 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [req.user.id]);

    res.json({ exports });
  } catch (error) {
    console.error('Error fetching data export status:', error);
    res.status(500).json({ error: 'Failed to fetch data export status' });
  }
});

// Request data export
router.post('/data-export', authenticateToken, [
  validateInput('export_type', { required: true, enum: ['full', 'profile', 'devices', 'reports', 'activity'] })
], async (req, res) => {
  try {
    const connection = req.app.get('db');
    const { export_type } = req.body;

    // Check if user has a pending export
    const [pendingExports] = await connection.execute(`
      SELECT id FROM data_exports 
      WHERE user_id = ? AND status = 'pending'
    `, [req.user.id]);

    if (pendingExports.length > 0) {
      return res.status(400).json({ error: 'You already have a pending data export request' });
    }

    // Create export request
    const [result] = await connection.execute(`
      INSERT INTO data_exports (
        user_id, export_type, status, created_at, expires_at
      ) VALUES (?, ?, 'pending', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))
    `, [req.user.id, export_type]);

    await logActivity(connection, req.user.id, 'data_export_requested', 'user', result.insertId, 
      `User requested ${export_type} data export`, req.ip, req.get('User-Agent'));

    // Here you would typically queue a background job to process the export
    // For now, we'll just return the request ID

    res.json({ 
      message: 'Data export request submitted successfully',
      export_id: result.insertId,
      estimated_completion: '15-30 minutes'
    });
  } catch (error) {
    console.error('Error requesting data export:', error);
    res.status(500).json({ error: 'Failed to request data export' });
  }
});

// Download data export
router.get('/data-export/:id/download', authenticateToken, async (req, res) => {
  try {
    const connection = req.app.get('db');
    const { id } = req.params;

    const [exports] = await connection.execute(`
      SELECT file_path, export_type, status, expires_at
      FROM data_exports 
      WHERE id = ? AND user_id = ?
    `, [id, req.user.id]);

    if (exports.length === 0) {
      return res.status(404).json({ error: 'Export not found' });
    }

    const exportData = exports[0];

    if (exportData.status !== 'completed') {
      return res.status(400).json({ error: 'Export is not ready for download' });
    }

    if (new Date() > new Date(exportData.expires_at)) {
      return res.status(410).json({ error: 'Export has expired' });
    }

    // In a real implementation, you would serve the file from storage
    // For now, we'll return a placeholder response
    res.json({
      message: 'Export download would start here',
      export_type: exportData.export_type,
      file_path: exportData.file_path
    });

    await logActivity(connection, req.user.id, 'data_export_downloaded', 'user', id, 
      `User downloaded ${exportData.export_type} data export`, req.ip, req.get('User-Agent'));

  } catch (error) {
    console.error('Error downloading data export:', error);
    res.status(500).json({ error: 'Failed to download data export' });
  }
});

// System settings (admin only)
router.get('/system', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const connection = req.app.get('db');

    const [settings] = await connection.execute(`
      SELECT setting_key, setting_value, description, category
      FROM system_settings 
      ORDER BY category, setting_key
    `);

    // Group settings by category
    const groupedSettings = settings.reduce((acc, setting) => {
      if (!acc[setting.category]) {
        acc[setting.category] = [];
      }
      acc[setting.category].push({
        key: setting.setting_key,
        value: setting.setting_value,
        description: setting.description
      });
      return acc;
    }, {});

    res.json({ settings: groupedSettings });
  } catch (error) {
    console.error('Error fetching system settings:', error);
    res.status(500).json({ error: 'Failed to fetch system settings' });
  }
});

// Update system settings (admin only)
router.put('/system', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const connection = req.app.get('db');
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Invalid settings format' });
    }

    await connection.beginTransaction();

    try {
      for (const [key, value] of Object.entries(settings)) {
        await connection.execute(`
          UPDATE system_settings 
          SET setting_value = ?, updated_at = NOW()
          WHERE setting_key = ?
        `, [String(value), key]);
      }

      await connection.commit();

      await logActivity(connection, req.user.id, 'system_settings_updated', 'system', null, 
        `Admin updated system settings: ${Object.keys(settings).join(', ')}`, req.ip, req.get('User-Agent'));

      res.json({ message: 'System settings updated successfully' });
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Error updating system settings:', error);
    res.status(500).json({ error: 'Failed to update system settings' });
  }
});

module.exports = router;