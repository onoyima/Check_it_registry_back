-- Check It - Notification and Device Tracking Enhancements
-- This file adds comprehensive device check tracking, notification settings, and security features
-- Run this after the main schema.sql

-- Disable foreign key checks temporarily
SET FOREIGN_KEY_CHECKS = 0;

-- Drop existing tables in correct order (child tables first)
DROP TABLE IF EXISTS device_check_patterns;
DROP TABLE IF EXISTS system_notifications;
DROP TABLE IF EXISTS suspicious_activity_alerts;
DROP TABLE IF EXISTS notification_settings;
DROP TABLE IF EXISTS device_checks;

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;

-- Device checks table - comprehensive tracking of all device checks
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
    FOREIGN KEY (checker_user_id) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_device_id (device_id),
    INDEX idx_checker_user_id (checker_user_id),
    INDEX idx_query (query),
    INDEX idx_ip_address (ip_address),
    INDEX idx_mac_address (mac_address),
    INDEX idx_location (location_latitude, location_longitude),
    INDEX idx_check_result (check_result),
    INDEX idx_is_suspicious (is_suspicious),
    INDEX idx_created_at (created_at),
    INDEX idx_device_status (device_status_at_check)
) ENGINE=InnoDB COMMENT='Comprehensive device check tracking with location and user data';

-- Notification settings table (enhanced from user_preferences)
CREATE TABLE notification_settings (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    -- Email notifications
    email_enabled BOOLEAN DEFAULT TRUE,
    email_device_checks BOOLEAN DEFAULT TRUE COMMENT 'Notify when device is checked',
    email_device_reports BOOLEAN DEFAULT TRUE COMMENT 'Notify when device is reported',
    email_device_transfers BOOLEAN DEFAULT TRUE COMMENT 'Notify about transfer requests',
    email_device_verification BOOLEAN DEFAULT TRUE COMMENT 'Notify about verification status',
    email_suspicious_activity BOOLEAN DEFAULT TRUE COMMENT 'Notify about suspicious checks',
    email_lea_updates BOOLEAN DEFAULT TRUE COMMENT 'Notify about LEA case updates',
    email_marketing BOOLEAN DEFAULT FALSE,
    -- SMS notifications
    sms_enabled BOOLEAN DEFAULT FALSE,
    sms_device_checks BOOLEAN DEFAULT FALSE,
    sms_device_reports BOOLEAN DEFAULT TRUE COMMENT 'SMS for critical reports',
    sms_suspicious_activity BOOLEAN DEFAULT TRUE COMMENT 'SMS for suspicious activity',
    sms_emergency_alerts BOOLEAN DEFAULT TRUE COMMENT 'SMS for emergency alerts',
    -- Push notifications
    push_enabled BOOLEAN DEFAULT TRUE,
    push_device_checks BOOLEAN DEFAULT TRUE,
    push_device_reports BOOLEAN DEFAULT TRUE,
    push_device_transfers BOOLEAN DEFAULT TRUE,
    push_suspicious_activity BOOLEAN DEFAULT TRUE,
    -- Frequency settings
    digest_frequency ENUM('immediate', 'hourly', 'daily', 'weekly', 'never') DEFAULT 'immediate',
    quiet_hours_start TIME NULL COMMENT 'Start of quiet hours (no notifications)',
    quiet_hours_end TIME NULL COMMENT 'End of quiet hours',
    timezone VARCHAR(50) DEFAULT 'UTC',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_notification_settings (user_id)
) ENGINE=InnoDB COMMENT='Comprehensive notification preferences for users';

-- Suspicious activity alerts table
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
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_device_check_id (device_check_id),
    INDEX idx_device_id (device_id),
    INDEX idx_alert_type (alert_type),
    INDEX idx_severity (severity),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB COMMENT='Suspicious activity alerts generated from device checks';

-- Enhanced notifications table for system-generated alerts
CREATE TABLE system_notifications (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    recipient_user_id VARCHAR(36) NULL COMMENT 'User recipient (NULL for LEA/admin broadcasts)',
    recipient_role ENUM('user', 'admin', 'lea', 'business') NULL COMMENT 'Role-based notifications',
    recipient_region VARCHAR(100) NULL COMMENT 'Region-based notifications for LEAs',
    notification_type ENUM('device_check', 'device_report', 'suspicious_activity', 'transfer_request', 'verification_update', 'lea_case_update', 'system_alert') NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    -- Related entities
    device_id VARCHAR(36) NULL,
    report_id VARCHAR(36) NULL,
    device_check_id VARCHAR(36) NULL,
    suspicious_alert_id VARCHAR(36) NULL,
    -- Delivery channels
    send_email BOOLEAN DEFAULT TRUE,
    send_sms BOOLEAN DEFAULT FALSE,
    send_push BOOLEAN DEFAULT TRUE,
    -- Status tracking
    email_sent BOOLEAN DEFAULT FALSE,
    email_sent_at TIMESTAMP NULL,
    sms_sent BOOLEAN DEFAULT FALSE,
    sms_sent_at TIMESTAMP NULL,
    push_sent BOOLEAN DEFAULT FALSE,
    push_sent_at TIMESTAMP NULL,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP NULL,
    -- Metadata
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
    FOREIGN KEY (suspicious_alert_id) REFERENCES suspicious_activity_alerts(id) ON DELETE SET NULL,
    
    INDEX idx_recipient_user_id (recipient_user_id),
    INDEX idx_recipient_role (recipient_role),
    INDEX idx_recipient_region (recipient_region),
    INDEX idx_notification_type (notification_type),
    INDEX idx_priority (priority),
    INDEX idx_is_read (is_read),
    INDEX idx_created_at (created_at),
    INDEX idx_device_id (device_id),
    INDEX idx_report_id (report_id)
) ENGINE=InnoDB COMMENT='System-generated notifications with multi-channel delivery';

-- Device check patterns table for analytics and fraud detection
CREATE TABLE device_check_patterns (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    pattern_type ENUM('ip_frequency', 'location_clustering', 'time_pattern', 'device_pattern', 'user_pattern') NOT NULL,
    pattern_key VARCHAR(255) NOT NULL COMMENT 'IP address, location hash, user ID, etc.',
    check_count INT DEFAULT 1,
    unique_devices_checked INT DEFAULT 1,
    suspicious_checks INT DEFAULT 0,
    first_check_at TIMESTAMP NOT NULL,
    last_check_at TIMESTAMP NOT NULL,
    risk_score DECIMAL(5,2) DEFAULT 0.00 COMMENT 'Calculated risk score 0-100',
    is_flagged BOOLEAN DEFAULT FALSE,
    flagged_reason TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_pattern_type (pattern_type),
    INDEX idx_pattern_key (pattern_key),
    INDEX idx_risk_score (risk_score),
    INDEX idx_is_flagged (is_flagged),
    INDEX idx_last_check_at (last_check_at),
    UNIQUE KEY unique_pattern (pattern_type, pattern_key)
) ENGINE=InnoDB COMMENT='Device check patterns for fraud detection and analytics';

-- Insert default notification settings for existing users
INSERT INTO notification_settings (id, user_id)
SELECT UUID(), id FROM users 
WHERE id NOT IN (SELECT COALESCE(user_id, '') FROM notification_settings WHERE user_id IS NOT NULL);

-- Show completion message
SELECT 'Notification and tracking enhancements schema created successfully!' as status;