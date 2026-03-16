-- Enhanced Features Migration Script (Fixed)
-- Add new tables and columns for profile management, settings, audit trail, etc.
-- Compatible with existing schema structure

-- Add new columns to users table for enhanced profile and settings
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS profile_image_url VARCHAR(255),
ADD COLUMN IF NOT EXISTS theme_preference ENUM('light', 'dark', 'auto') DEFAULT 'light',
ADD COLUMN IF NOT EXISTS language_preference VARCHAR(5) DEFAULT 'en',
ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Africa/Lagos',
ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS sms_notifications BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS push_notifications BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS device_alerts BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS transfer_notifications BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS verification_notifications BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS report_updates BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS marketing_emails BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS profile_visibility ENUM('public', 'private', 'contacts') DEFAULT 'private',
ADD COLUMN IF NOT EXISTS show_online_status BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS allow_contact_from_strangers BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS data_sharing_consent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS analytics_consent BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS session_timeout INT DEFAULT 60,
ADD COLUMN IF NOT EXISTS auto_logout_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS require_password_change BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS login_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL;

-- Update existing audit_logs table to match enhanced structure
ALTER TABLE audit_logs 
ADD COLUMN IF NOT EXISTS resource_type ENUM('user', 'device', 'report', 'auth', 'system', 'api') DEFAULT 'system',
ADD COLUMN IF NOT EXISTS resource_id VARCHAR(36),
ADD COLUMN IF NOT EXISTS details TEXT,
ADD COLUMN IF NOT EXISTS severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'low',
ADD COLUMN IF NOT EXISTS status ENUM('success', 'failed', 'warning') DEFAULT 'success';

-- Update audit_logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_resource_type ON audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_logs(status);
CREATE INDEX IF NOT EXISTS idx_audit_composite ON audit_logs(user_id, created_at, action);

-- Create user_sessions table for session management
CREATE TABLE IF NOT EXISTS user_sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL 1 HOUR),
    is_current BOOLEAN DEFAULT FALSE,
    INDEX idx_user_id (user_id),
    INDEX idx_expires_at (expires_at),
    INDEX idx_last_activity (last_activity),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create api_keys table for API access management
CREATE TABLE IF NOT EXISTS api_keys (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    key_hash VARCHAR(64) NOT NULL,
    permissions JSON,
    last_used_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL 90 DAY),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_key_prefix (key_prefix),
    INDEX idx_expires_at (expires_at),
    INDEX idx_is_active (is_active),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create data_exports table for GDPR compliance
CREATE TABLE IF NOT EXISTS data_exports (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    export_type ENUM('full', 'profile', 'devices', 'reports', 'activity') NOT NULL,
    status ENUM('pending', 'processing', 'completed', 'failed', 'expired') DEFAULT 'pending',
    file_path VARCHAR(255),
    file_size BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL 7 DAY),
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_expires_at (expires_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create system_settings table for application configuration
CREATE TABLE IF NOT EXISTS system_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT,
    category VARCHAR(50) DEFAULT 'general',
    data_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_is_public (is_public)
);

-- Create system_alerts table for admin notifications
CREATE TABLE IF NOT EXISTS system_alerts (
    id VARCHAR(36) PRIMARY KEY,
    alert_type VARCHAR(50) NOT NULL,
    severity ENUM('low', 'medium', 'high', 'critical') NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    status ENUM('active', 'acknowledged', 'resolved') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP NULL,
    acknowledged_by VARCHAR(36),
    resolved_at TIMESTAMP NULL,
    resolved_by VARCHAR(36),
    INDEX idx_status (status),
    INDEX idx_severity (severity),
    INDEX idx_alert_type (alert_type),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Create push_subscriptions table for web push notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_is_active (is_active),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create notification_queue table for queued notifications (extends existing notifications table concept)
CREATE TABLE IF NOT EXISTS notification_queue (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    notification_type ENUM('email', 'sms', 'push') NOT NULL,
    subject VARCHAR(200),
    message TEXT NOT NULL,
    html_content TEXT,
    recipient VARCHAR(255) NOT NULL,
    status ENUM('pending', 'sent', 'failed', 'cancelled') DEFAULT 'pending',
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    scheduled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP NULL,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_notification_type (notification_type),
    INDEX idx_scheduled_at (scheduled_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Add new columns to devices table for enhanced tracking
ALTER TABLE devices 
ADD COLUMN IF NOT EXISTS verification_notes TEXT,
ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS check_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS recovery_instructions TEXT;

-- Add new columns to reports table for enhanced reporting
ALTER TABLE reports 
ADD COLUMN IF NOT EXISTS police_report_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS evidence_url_additional TEXT,
ADD COLUMN IF NOT EXISTS circumstances TEXT,
ADD COLUMN IF NOT EXISTS witness_info TEXT,
ADD COLUMN IF NOT EXISTS recovery_instructions TEXT,
ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(36),
ADD COLUMN IF NOT EXISTS priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS resolved_by VARCHAR(36);

-- Add foreign key constraints for reports (separate statements to avoid syntax issues)
ALTER TABLE reports 
ADD CONSTRAINT fk_reports_assigned_to 
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE reports 
ADD CONSTRAINT fk_reports_resolved_by 
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;

-- Create device_checks table for tracking public checks (extends existing imei_checks)
CREATE TABLE IF NOT EXISTS device_checks (
    id VARCHAR(36) PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    checker_ip VARCHAR(45),
    checker_user_agent TEXT,
    checker_location VARCHAR(100),
    check_type ENUM('imei', 'serial', 'qr_code') NOT NULL,
    result ENUM('clean', 'stolen', 'lost', 'suspicious') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_device_id (device_id),
    INDEX idx_result (result),
    INDEX idx_created_at (created_at),
    INDEX idx_checker_ip (checker_ip),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- Create user_preferences table for additional user settings
CREATE TABLE IF NOT EXISTS user_preferences (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL UNIQUE,
    dashboard_layout JSON,
    notification_settings JSON,
    privacy_settings JSON,
    display_preferences JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Insert default system settings
INSERT IGNORE INTO system_settings (setting_key, setting_value, description, category, data_type) VALUES
('app_name', 'Check It Device Registry', 'Application name', 'general', 'string'),
('app_version', '1.0.0', 'Application version', 'general', 'string'),
('maintenance_mode', 'false', 'Enable maintenance mode', 'system', 'boolean'),
('registration_enabled', 'true', 'Allow new user registrations', 'auth', 'boolean'),
('email_verification_required', 'true', 'Require email verification for new accounts', 'auth', 'boolean'),
('max_devices_per_user', '10', 'Maximum devices per regular user', 'limits', 'number'),
('max_devices_per_business', '100', 'Maximum devices per business user', 'limits', 'number'),
('device_verification_required', 'true', 'Require admin verification for devices', 'devices', 'boolean'),
('public_check_enabled', 'true', 'Enable public device checking', 'features', 'boolean'),
('report_auto_assignment', 'true', 'Auto-assign reports to LEA users', 'reports', 'boolean'),
('notification_rate_limit', '10', 'Max notifications per user per hour', 'notifications', 'number'),
('session_timeout_minutes', '60', 'Default session timeout in minutes', 'security', 'number'),
('password_min_length', '8', 'Minimum password length', 'security', 'number'),
('failed_login_attempts', '5', 'Max failed login attempts before lockout', 'security', 'number'),
('account_lockout_minutes', '30', 'Account lockout duration in minutes', 'security', 'number'),
('api_rate_limit_per_minute', '100', 'API requests per minute per user', 'api', 'number'),
('backup_retention_days', '30', 'Database backup retention period', 'system', 'number'),
('log_retention_days', '90', 'Audit log retention period', 'system', 'number'),
('file_upload_max_size', '5242880', 'Maximum file upload size in bytes (5MB)', 'uploads', 'number'),
('allowed_file_types', 'jpg,jpeg,png,gif,pdf,doc,docx', 'Allowed file upload types', 'uploads', 'string');

-- Create additional indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_region ON users(region);
CREATE INDEX IF NOT EXISTS idx_devices_brand ON devices(brand);
CREATE INDEX IF NOT EXISTS idx_devices_imei ON devices(imei);
CREATE INDEX IF NOT EXISTS idx_devices_serial ON devices(serial);

-- Create views for common queries (fixed column references)
CREATE OR REPLACE VIEW v_user_stats AS
SELECT 
    u.id,
    u.name,
    u.email,
    u.role,
    u.created_at,
    u.verified_at,
    COUNT(DISTINCT d.id) as device_count,
    COUNT(DISTINCT CASE WHEN d.status = 'verified' THEN d.id END) as verified_devices,
    COUNT(DISTINCT r.id) as report_count,
    COUNT(DISTINCT CASE WHEN r.status = 'open' THEN r.id END) as open_reports,
    MAX(al.created_at) as last_activity
FROM users u
LEFT JOIN devices d ON u.id = d.user_id
LEFT JOIN reports r ON u.id = r.reporter_id
LEFT JOIN audit_logs al ON u.id = al.user_id
GROUP BY u.id, u.name, u.email, u.role, u.created_at, u.verified_at;

CREATE OR REPLACE VIEW v_device_summary AS
SELECT 
    d.id,
    d.brand,
    d.model,
    d.status,
    d.created_at,
    d.verified_at,
    u.name as owner_name,
    u.email as owner_email,
    COALESCE(d.check_count, 0) as check_count,
    d.last_checked_at
FROM devices d
JOIN users u ON d.user_id = u.id;

CREATE OR REPLACE VIEW v_security_events AS
SELECT 
    al.id,
    al.user_id,
    u.name as user_name,
    u.email as user_email,
    al.action,
    COALESCE(al.resource_type, 'system') as resource_type,
    al.details,
    al.ip_address,
    COALESCE(al.severity, 'low') as severity,
    COALESCE(al.status, 'success') as status,
    al.created_at
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
WHERE COALESCE(al.severity, 'low') IN ('high', 'critical') 
   OR al.action LIKE '%failed%' 
   OR al.action LIKE '%suspicious%'
   OR COALESCE(al.resource_type, 'system') = 'auth'
ORDER BY al.created_at DESC;

-- Add some sample system alerts
INSERT IGNORE INTO system_alerts (id, alert_type, severity, title, message, status) VALUES
(UUID(), 'system_startup', 'low', 'System Started', 'Check It Device Registry system has been started successfully.', 'acknowledged'),
(UUID(), 'database_migration', 'medium', 'Database Migration Complete', 'Enhanced features migration has been applied successfully.', 'active');

COMMIT;