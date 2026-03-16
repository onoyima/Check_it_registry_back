#!/usr/bin/env node

// Populate default system settings and alerts
require('dotenv').config();
const Database = require('../config');

async function populateDefaults() {
  try {
    console.log('🚀 Populating default system settings and alerts...');

    // Insert default system settings (using actual table structure)
    const settings = [
      ['app_name', 'Check It Device Registry', 'string', 'Application name'],
      ['app_version', '1.0.0', 'string', 'Application version'],
      ['maintenance_mode', 'false', 'boolean', 'Enable maintenance mode'],
      ['registration_enabled', 'true', 'boolean', 'Allow new user registrations'],
      ['email_verification_required', 'true', 'boolean', 'Require email verification for new accounts'],
      ['max_devices_per_user', '10', 'number', 'Maximum devices per regular user'],
      ['max_devices_per_business', '100', 'number', 'Maximum devices per business user'],
      ['device_verification_required', 'true', 'boolean', 'Require admin verification for devices'],
      ['public_check_enabled', 'true', 'boolean', 'Enable public device checking'],
      ['report_auto_assignment', 'true', 'boolean', 'Auto-assign reports to LEA users'],
      ['notification_rate_limit', '10', 'number', 'Max notifications per user per hour'],
      ['session_timeout_minutes', '60', 'number', 'Default session timeout in minutes'],
      ['password_min_length', '8', 'number', 'Minimum password length'],
      ['failed_login_attempts', '5', 'number', 'Max failed login attempts before lockout'],
      ['account_lockout_minutes', '30', 'number', 'Account lockout duration in minutes'],
      ['api_rate_limit_per_minute', '100', 'number', 'API requests per minute per user'],
      ['backup_retention_days', '30', 'number', 'Database backup retention period'],
      ['log_retention_days', '90', 'number', 'Audit log retention period'],
      ['file_upload_max_size', '5242880', 'number', 'Maximum file upload size in bytes (5MB)'],
      ['allowed_file_types', 'jpg,jpeg,png,gif,pdf,doc,docx', 'string', 'Allowed file upload types']
    ];

    let settingsInserted = 0;
    for (const [key, value, settingType, description] of settings) {
      try {
        await Database.query(
          'INSERT IGNORE INTO system_settings (setting_key, setting_value, setting_type, description, is_public) VALUES (?, ?, ?, ?, ?)',
          [key, value, settingType, description, false]
        );
        settingsInserted++;
      } catch (error) {
        console.log(`ℹ️  Setting '${key}' already exists or error: ${error.message}`);
      }
    }

    console.log(`✅ Inserted ${settingsInserted} system settings`);

    // Insert default system alerts (using actual table structure)
    const alerts = [
      ['system', 'low', 'System Started', 'Check It Device Registry system has been started successfully.'],
      ['system', 'medium', 'Database Migration Complete', 'Enhanced features migration has been applied successfully.']
    ];

    let alertsInserted = 0;
    for (const [alertType, severity, title, message] of alerts) {
      try {
        // Generate UUID for the alert
        const alertId = require('crypto').randomUUID();
        await Database.query(
          'INSERT IGNORE INTO system_alerts (id, alert_type, severity, title, message, is_resolved) VALUES (?, ?, ?, ?, ?, ?)',
          [alertId, alertType, severity, title, message, false]
        );
        alertsInserted++;
      } catch (error) {
        console.log(`ℹ️  Alert '${alertType}' already exists or error: ${error.message}`);
      }
    }

    console.log(`✅ Inserted ${alertsInserted} system alerts`);

    // Verify the data was inserted
    const settingsCount = await Database.query('SELECT COUNT(*) as count FROM system_settings');
    const alertsCount = await Database.query('SELECT COUNT(*) as count FROM system_alerts');

    console.log(`📊 Total system settings: ${settingsCount[0].count}`);
    console.log(`📊 Total system alerts: ${alertsCount[0].count}`);

    console.log('✅ Default data population completed successfully!');

  } catch (error) {
    console.error('❌ Error populating defaults:', error);
    process.exit(1);
  } finally {
    await Database.close();
    process.exit(0);
  }
}

populateDefaults();