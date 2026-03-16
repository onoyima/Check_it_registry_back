const mysql = require('mysql2/promise');
const fs = require('fs');

async function runNotificationSchema() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'check_it_registry'
    });
    
    console.log('✅ Connected to database');
    
    // Step 1: Drop existing tables
    console.log('🗑️  Dropping existing tables...');
    
    await connection.execute('SET FOREIGN_KEY_CHECKS = 0');
    
    const dropTables = [
      'DROP TABLE IF EXISTS device_check_patterns',
      'DROP TABLE IF EXISTS system_notifications',
      'DROP TABLE IF EXISTS suspicious_activity_alerts',
      'DROP TABLE IF EXISTS notification_settings',
      'DROP TABLE IF EXISTS device_checks'
    ];
    
    for (const sql of dropTables) {
      try {
        await connection.execute(sql);
        console.log(`   ✅ ${sql}`);
      } catch (error) {
        console.log(`   ⚠️  ${sql} - ${error.message}`);
      }
    }
    
    await connection.execute('SET FOREIGN_KEY_CHECKS = 1');
    
    // Step 2: Create device_checks table
    console.log('📋 Creating device_checks table...');
    const deviceChecksSQL = `
      CREATE TABLE device_checks (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        device_id VARCHAR(36) NULL COMMENT 'Device being checked (NULL for non-existent devices)',
        query VARCHAR(100) NOT NULL COMMENT 'IMEI/Serial/MAC searched',
        checker_user_id VARCHAR(36) NULL COMMENT 'Registered user who performed check',
        checker_name VARCHAR(255) NULL COMMENT 'Name provided by anonymous checker',
        checker_email VARCHAR(255) NULL COMMENT 'Email provided by anonymous checker',
        checker_phone VARCHAR(20) NULL COMMENT 'Phone provided by anonymous checker',
        ip_address VARCHAR(45) NOT NULL,
        mac_address VARCHAR(17) NULL COMMENT 'Device MAC address',
        user_agent TEXT NULL,
        location_latitude DECIMAL(10, 8) NULL COMMENT 'GPS latitude',
        location_longitude DECIMAL(11, 8) NULL COMMENT 'GPS longitude',
        location_accuracy DECIMAL(8, 2) NULL COMMENT 'Location accuracy in meters',
        location_address TEXT NULL COMMENT 'Reverse geocoded address',
        device_fingerprint TEXT NULL COMMENT 'Browser/device fingerprint',
        check_result ENUM('found', 'not_found', 'reported_stolen', 'reported_lost', 'reported_missing') NOT NULL,
        device_status_at_check ENUM('verified', 'unverified', 'stolen', 'lost', 'found', 'pending_transfer') NULL,
        is_suspicious BOOLEAN DEFAULT FALSE COMMENT 'Flagged as suspicious check',
        alert_sent BOOLEAN DEFAULT FALSE COMMENT 'Whether alerts were sent for this check',
        notes TEXT NULL COMMENT 'Additional notes about the check',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
        FOREIGN KEY (checker_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB COMMENT='Comprehensive device check tracking with location and user data'
    `;
    
    await connection.execute(deviceChecksSQL);
    console.log('   ✅ device_checks table created');
    
    // Step 3: Create notification_settings table
    console.log('🔔 Creating notification_settings table...');
    const notificationSettingsSQL = `
      CREATE TABLE notification_settings (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id VARCHAR(36) NOT NULL,
        email_enabled BOOLEAN DEFAULT TRUE,
        email_device_checks BOOLEAN DEFAULT TRUE COMMENT 'Notify when device is checked',
        email_device_reports BOOLEAN DEFAULT TRUE COMMENT 'Notify when device is reported',
        email_device_transfers BOOLEAN DEFAULT TRUE COMMENT 'Notify about transfer requests',
        email_device_verification BOOLEAN DEFAULT TRUE COMMENT 'Notify about verification status',
        email_suspicious_activity BOOLEAN DEFAULT TRUE COMMENT 'Notify about suspicious checks',
        email_lea_updates BOOLEAN DEFAULT TRUE COMMENT 'Notify about LEA case updates',
        email_marketing BOOLEAN DEFAULT FALSE,
        sms_enabled BOOLEAN DEFAULT FALSE,
        sms_device_checks BOOLEAN DEFAULT FALSE,
        sms_device_reports BOOLEAN DEFAULT TRUE COMMENT 'SMS for critical reports',
        sms_suspicious_activity BOOLEAN DEFAULT TRUE COMMENT 'SMS for suspicious activity',
        sms_emergency_alerts BOOLEAN DEFAULT TRUE COMMENT 'SMS for emergency alerts',
        push_enabled BOOLEAN DEFAULT TRUE,
        push_device_checks BOOLEAN DEFAULT TRUE,
        push_device_reports BOOLEAN DEFAULT TRUE,
        push_device_transfers BOOLEAN DEFAULT TRUE,
        push_suspicious_activity BOOLEAN DEFAULT TRUE,
        digest_frequency ENUM('immediate', 'hourly', 'daily', 'weekly', 'never') DEFAULT 'immediate',
        quiet_hours_start TIME NULL COMMENT 'Start of quiet hours (no notifications)',
        quiet_hours_end TIME NULL COMMENT 'End of quiet hours',
        timezone VARCHAR(50) DEFAULT 'UTC',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_notification_settings (user_id)
      ) ENGINE=InnoDB COMMENT='Comprehensive notification preferences for users'
    `;
    
    await connection.execute(notificationSettingsSQL);
    console.log('   ✅ notification_settings table created');
    
    // Step 4: Create suspicious_activity_alerts table
    console.log('🚨 Creating suspicious_activity_alerts table...');
    const suspiciousAlertsSQL = `
      CREATE TABLE suspicious_activity_alerts (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        device_check_id VARCHAR(36) NOT NULL,
        device_id VARCHAR(36) NULL,
        alert_type ENUM('reported_device_check', 'multiple_checks_same_ip', 'multiple_checks_same_location', 'anonymous_check_reported_device', 'location_mismatch') NOT NULL,
        severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
        description TEXT NOT NULL,
        auto_generated BOOLEAN DEFAULT TRUE,
        reviewed_by VARCHAR(36) NULL COMMENT 'Admin/LEA who reviewed',
        reviewed_at TIMESTAMP NULL,
        status ENUM('pending', 'investigating', 'resolved', 'false_positive') DEFAULT 'pending',
        resolution_notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (device_check_id) REFERENCES device_checks(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB COMMENT='Suspicious activity alerts generated from device checks'
    `;
    
    await connection.execute(suspiciousAlertsSQL);
    console.log('   ✅ suspicious_activity_alerts table created');
    
    // Step 5: Create system_notifications table
    console.log('📢 Creating system_notifications table...');
    const systemNotificationsSQL = `
      CREATE TABLE system_notifications (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        recipient_user_id VARCHAR(36) NULL COMMENT 'User recipient (NULL for LEA/admin broadcasts)',
        recipient_role ENUM('user', 'admin', 'lea', 'business') NULL COMMENT 'Role-based notifications',
        recipient_region VARCHAR(100) NULL COMMENT 'Region-based notifications for LEAs',
        notification_type ENUM('device_check', 'device_report', 'suspicious_activity', 'transfer_request', 'verification_update', 'lea_case_update', 'system_alert') NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
        device_id VARCHAR(36) NULL,
        report_id VARCHAR(36) NULL,
        device_check_id VARCHAR(36) NULL,
        suspicious_alert_id VARCHAR(36) NULL,
        send_email BOOLEAN DEFAULT TRUE,
        send_sms BOOLEAN DEFAULT FALSE,
        send_push BOOLEAN DEFAULT TRUE,
        email_sent BOOLEAN DEFAULT FALSE,
        email_sent_at TIMESTAMP NULL,
        sms_sent BOOLEAN DEFAULT FALSE,
        sms_sent_at TIMESTAMP NULL,
        push_sent BOOLEAN DEFAULT FALSE,
        push_sent_at TIMESTAMP NULL,
        is_read BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMP NULL,
        action_url VARCHAR(500) NULL,
        action_text VARCHAR(100) NULL,
        metadata JSON NULL,
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
        FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL,
        FOREIGN KEY (device_check_id) REFERENCES device_checks(id) ON DELETE SET NULL,
        FOREIGN KEY (suspicious_alert_id) REFERENCES suspicious_activity_alerts(id) ON DELETE SET NULL
      ) ENGINE=InnoDB COMMENT='System-generated notifications with multi-channel delivery'
    `;
    
    await connection.execute(systemNotificationsSQL);
    console.log('   ✅ system_notifications table created');
    
    // Step 6: Create indexes
    console.log('📊 Creating indexes...');
    const indexes = [
      'CREATE INDEX idx_device_checks_device_id ON device_checks(device_id)',
      'CREATE INDEX idx_device_checks_checker_user_id ON device_checks(checker_user_id)',
      'CREATE INDEX idx_device_checks_query ON device_checks(query)',
      'CREATE INDEX idx_device_checks_ip_address ON device_checks(ip_address)',
      'CREATE INDEX idx_device_checks_mac_address ON device_checks(mac_address)',
      'CREATE INDEX idx_device_checks_location ON device_checks(location_latitude, location_longitude)',
      'CREATE INDEX idx_device_checks_check_result ON device_checks(check_result)',
      'CREATE INDEX idx_device_checks_is_suspicious ON device_checks(is_suspicious)',
      'CREATE INDEX idx_device_checks_created_at ON device_checks(created_at)',
      'CREATE INDEX idx_suspicious_alerts_device_check_id ON suspicious_activity_alerts(device_check_id)',
      'CREATE INDEX idx_suspicious_alerts_device_id ON suspicious_activity_alerts(device_id)',
      'CREATE INDEX idx_suspicious_alerts_alert_type ON suspicious_activity_alerts(alert_type)',
      'CREATE INDEX idx_suspicious_alerts_severity ON suspicious_activity_alerts(severity)',
      'CREATE INDEX idx_suspicious_alerts_status ON suspicious_activity_alerts(status)',
      'CREATE INDEX idx_system_notifications_recipient_user_id ON system_notifications(recipient_user_id)',
      'CREATE INDEX idx_system_notifications_recipient_role ON system_notifications(recipient_role)',
      'CREATE INDEX idx_system_notifications_notification_type ON system_notifications(notification_type)',
      'CREATE INDEX idx_system_notifications_priority ON system_notifications(priority)',
      'CREATE INDEX idx_system_notifications_is_read ON system_notifications(is_read)',
      'CREATE INDEX idx_system_notifications_created_at ON system_notifications(created_at)'
    ];
    
    for (const sql of indexes) {
      try {
        await connection.execute(sql);
        console.log(`   ✅ Index created`);
      } catch (error) {
        console.log(`   ⚠️  Index creation failed: ${error.message}`);
      }
    }
    
    // Step 7: Insert default notification settings for existing users
    console.log('👥 Creating default notification settings for existing users...');
    const insertDefaultSettings = `
      INSERT INTO notification_settings (id, user_id)
      SELECT UUID(), id FROM users 
      WHERE id NOT IN (SELECT COALESCE(user_id, '') FROM notification_settings WHERE user_id IS NOT NULL)
    `;
    
    const result = await connection.execute(insertDefaultSettings);
    console.log(`   ✅ Created notification settings for ${result[0].affectedRows} users`);
    
    console.log('🎉 All schema updates completed successfully!');
    
  } catch (error) {
    console.error('❌ Error executing schema updates:', error.message);
    console.error('SQL Error Code:', error.code);
    console.error('SQL State:', error.sqlState);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

runNotificationSchema();