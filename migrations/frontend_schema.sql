-- Check It - Smart Device Registry & Recovery System
-- MySQL Database Schema
-- Compatible with phpMyAdmin and MySQL 8.0+

-- Create database (uncomment if needed)
-- CREATE DATABASE check_it_registry CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE check_it_registry;

-- Enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;

-- Users table
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(20) UNIQUE NULL,
    role ENUM('user', 'business', 'admin', 'lea') DEFAULT 'user',
    verified_at TIMESTAMP NULL,
    id_document_url TEXT NULL,
    region VARCHAR(100) NULL COMMENT 'For LEA mapping',
    two_fa_enabled BOOLEAN DEFAULT FALSE,
    two_fa_secret VARCHAR(255) NULL COMMENT 'Encrypted 2FA secret',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_region (region)
) ENGINE=InnoDB COMMENT='User accounts with roles and regions';

-- Law enforcement agencies table
CREATE TABLE law_enforcement_agencies (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    agency_name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NOT NULL DEFAULT 'clintonfaze@gmail.com',
    contact_phone VARCHAR(20) NULL,
    region VARCHAR(100) NOT NULL,
    address TEXT NULL,
    jurisdiction_type ENUM('local', 'state', 'federal') DEFAULT 'local',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_region (region),
    INDEX idx_active (active)
) ENGINE=InnoDB COMMENT='Law enforcement agencies by region';

-- Devices table
CREATE TABLE devices (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    imei VARCHAR(15) UNIQUE NULL COMMENT 'International Mobile Equipment Identity',
    serial VARCHAR(100) UNIQUE NULL COMMENT 'Device serial number',
    category VARCHAR(50) NOT NULL DEFAULT 'others' COMMENT 'Normalized device category',
    brand VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    color VARCHAR(50) NULL,
    device_image_url TEXT NULL,
    proof_url TEXT NULL COMMENT 'Receipt/invoice URL',
    -- Blob storage for images/documents
    device_image_blob LONGBLOB NULL,
    device_image_mime VARCHAR(100) NULL,
    device_image_filename VARCHAR(255) NULL,
    proof_blob LONGBLOB NULL,
    proof_mime VARCHAR(100) NULL,
    proof_filename VARCHAR(255) NULL,
    -- Category-specific explicit fields (no JSON)
    imei2 VARCHAR(15) NULL,
    network_carrier VARCHAR(100) NULL,
    operating_system VARCHAR(100) NULL,
    storage_capacity VARCHAR(50) NULL,
    mac_address VARCHAR(17) NULL,
    processor_type VARCHAR(100) NULL,
    ram_size VARCHAR(50) NULL,
    bluetooth_mac VARCHAR(17) NULL,
    vin VARCHAR(17) NULL,
    license_plate VARCHAR(20) NULL,
    year VARCHAR(4) NULL,
    engine_number VARCHAR(50) NULL,
    registration_state VARCHAR(100) NULL,
    description TEXT NULL,
    notes TEXT NULL,
    estimated_value DECIMAL(12,2) NULL,
    certificate_number VARCHAR(100) NULL,
    status ENUM('verified', 'unverified', 'stolen', 'lost', 'found', 'pending_transfer') DEFAULT 'unverified',
    verified_by VARCHAR(36) NULL COMMENT 'Admin who verified',
    verified_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_user_id (user_id),
    INDEX idx_imei (imei),
    INDEX idx_serial (serial),
    INDEX idx_category (category),
    INDEX idx_vin (vin),
    INDEX idx_license_plate (license_plate),
    INDEX idx_mac_address (mac_address),
    INDEX idx_bluetooth_mac (bluetooth_mac),
    INDEX idx_status (status),
    INDEX idx_brand_model (brand, model),
    
    CONSTRAINT chk_imei_or_serial CHECK (imei IS NOT NULL OR serial IS NOT NULL)
) ENGINE=InnoDB COMMENT='Registered devices with IMEI/serial and proof';

-- Reports table
CREATE TABLE reports (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    device_id VARCHAR(36) NOT NULL,
    report_type ENUM('stolen', 'lost', 'found') NOT NULL,
    reporter_id VARCHAR(36) NULL COMMENT 'User who filed report, NULL for anonymous',
    description TEXT NOT NULL,
    occurred_at TIMESTAMP NOT NULL COMMENT 'When incident occurred',
    location VARCHAR(255) NULL,
    evidence_url TEXT NULL,
    status ENUM('open', 'under_review', 'resolved', 'dismissed') DEFAULT 'open',
    case_id VARCHAR(20) UNIQUE NOT NULL COMMENT 'System-generated case ID',
    assigned_lea_id VARCHAR(36) NULL,
    lea_notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_lea_id) REFERENCES law_enforcement_agencies(id) ON DELETE SET NULL,
    
    INDEX idx_device_id (device_id),
    INDEX idx_reporter_id (reporter_id),
    INDEX idx_case_id (case_id),
    INDEX idx_status (status),
    INDEX idx_report_type (report_type),
    INDEX idx_assigned_lea (assigned_lea_id),
    INDEX idx_occurred_at (occurred_at)
) ENGINE=InnoDB COMMENT='Stolen/lost/found reports with case IDs';

-- Notifications table
CREATE TABLE notifications (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NULL,
    channel ENUM('email', 'sms', 'push') NOT NULL,
    recipient VARCHAR(255) NOT NULL COMMENT 'Email/phone/device_token',
    subject VARCHAR(255) NULL,
    message TEXT NOT NULL,
    payload JSON NULL COMMENT 'Additional data for notification',
    status ENUM('pending', 'sent', 'failed', 'delivered') DEFAULT 'pending',
    sent_at TIMESTAMP NULL,
    error_message TEXT NULL,
    retry_count INT DEFAULT 0 COMMENT 'Number of retry attempts',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_channel (channel),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB COMMENT='Email/SMS/push notification queue';

-- Audit logs table
CREATE TABLE audit_logs (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NULL,
    action VARCHAR(100) NOT NULL COMMENT 'Action performed',
    table_name VARCHAR(50) NULL COMMENT 'Table affected',
    record_id VARCHAR(36) NULL COMMENT 'Record ID affected',
    old_values JSON NULL COMMENT 'Previous values',
    new_values JSON NULL COMMENT 'New values',
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_user_id (user_id),
    INDEX idx_action (action),
    INDEX idx_table_name (table_name),
    INDEX idx_record_id (record_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB COMMENT='System audit trail';

-- Device transfers table
CREATE TABLE device_transfers (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    device_id VARCHAR(36) NOT NULL,
    from_user_id VARCHAR(36) NOT NULL,
    to_user_id VARCHAR(36) NOT NULL,
    transfer_code VARCHAR(10) NOT NULL COMMENT 'OTP for verification',
    status ENUM('pending', 'accepted', 'rejected', 'expired') DEFAULT 'pending',
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_device_id (device_id),
    INDEX idx_from_user (from_user_id),
    INDEX idx_to_user (to_user_id),
    INDEX idx_transfer_code (transfer_code),
    INDEX idx_status (status),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB COMMENT='Device ownership transfer requests';

-- IMEI checks table (for analytics, rate limiting removed)
CREATE TABLE imei_checks (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    query VARCHAR(100) NOT NULL COMMENT 'IMEI or serial searched',
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    result JSON NULL COMMENT 'Check result data',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_query (query),
    INDEX idx_ip_address (ip_address),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB COMMENT='Public device check logs for analytics';

-- Insert default LEA record
INSERT INTO law_enforcement_agencies (agency_name, contact_email, region, jurisdiction_type) 
VALUES ('Default Law Enforcement', 'clintonfaze@gmail.com', 'default', 'local');

-- Create triggers for audit logging
DELIMITER //

-- Audit trigger for devices table
CREATE TRIGGER devices_audit_insert 
AFTER INSERT ON devices 
FOR EACH ROW 
BEGIN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, ip_address)
    VALUES (NEW.user_id, 'INSERT', 'devices', NEW.id, JSON_OBJECT(
        'brand', NEW.brand,
        'model', NEW.model,
        'imei', NEW.imei,
        'serial', NEW.serial,
        'status', NEW.status
    ), @client_ip);
END//

CREATE TRIGGER devices_audit_update 
AFTER UPDATE ON devices 
FOR EACH ROW 
BEGIN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values, ip_address)
    VALUES (NEW.user_id, 'UPDATE', 'devices', NEW.id, 
        JSON_OBJECT('status', OLD.status, 'verified_at', OLD.verified_at),
        JSON_OBJECT('status', NEW.status, 'verified_at', NEW.verified_at),
        @client_ip);
END//

-- Audit trigger for reports table
CREATE TRIGGER reports_audit_insert 
AFTER INSERT ON reports 
FOR EACH ROW 
BEGIN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, ip_address)
    VALUES (NEW.reporter_id, 'INSERT', 'reports', NEW.id, JSON_OBJECT(
        'case_id', NEW.case_id,
        'report_type', NEW.report_type,
        'device_id', NEW.device_id,
        'status', NEW.status
    ), @client_ip);
END//

CREATE TRIGGER reports_audit_update 
AFTER UPDATE ON reports 
FOR EACH ROW 
BEGIN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values, ip_address)
    VALUES (NEW.reporter_id, 'UPDATE', 'reports', NEW.id,
        JSON_OBJECT('status', OLD.status, 'lea_notes', OLD.lea_notes),
        JSON_OBJECT('status', NEW.status, 'lea_notes', NEW.lea_notes),
        @client_ip);
END//

DELIMITER ;

-- Create function to generate case IDs
DELIMITER //

CREATE FUNCTION generate_case_id() RETURNS VARCHAR(20)
READS SQL DATA
DETERMINISTIC
BEGIN
    DECLARE case_id VARCHAR(20);
    DECLARE counter INT DEFAULT 0;
    
    REPEAT
        SET case_id = CONCAT('CASE-', YEAR(NOW()), '-', LPAD(FLOOR(RAND() * 999999), 6, '0'));
        SET counter = counter + 1;
    UNTIL NOT EXISTS (SELECT 1 FROM reports WHERE reports.case_id = case_id) OR counter > 100
    END REPEAT;
    
    RETURN case_id;
END//

DELIMITER ;

-- Create views for common queries
CREATE VIEW device_summary AS
SELECT 
    d.id,
    d.brand,
    d.model,
    d.imei,
    d.serial,
    d.status,
    u.name as owner_name,
    u.email as owner_email,
    d.created_at,
    d.verified_at,
    (SELECT COUNT(*) FROM reports r WHERE r.device_id = d.id AND r.status = 'open') as active_reports
FROM devices d
JOIN users u ON d.user_id = u.id;

CREATE VIEW report_summary AS
SELECT 
    r.id,
    r.case_id,
    r.report_type,
    r.status,
    r.occurred_at,
    r.location,
    d.brand,
    d.model,
    d.imei,
    d.serial,
    u.name as reporter_name,
    u.email as reporter_email,
    lea.agency_name,
    lea.contact_email as lea_email,
    r.created_at
FROM reports r
JOIN devices d ON r.device_id = d.id
LEFT JOIN users u ON r.reporter_id = u.id
LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id;

-- Create admin user (password: admin123 - change in production!)
INSERT INTO users (name, email, password_hash, role, verified_at) 
VALUES (
    'System Administrator', 
    'admin@proveownership.com', 
    '$2b$10$rQZ8kHWKQYQKQYQKQYQKQOeKQYQKQYQKQYQKQYQKQYQKQYQKQYQKQY', -- admin123
    'admin', 
    NOW()
);

-- Show table creation summary
SELECT 
    'Database schema created successfully!' as status,
    COUNT(*) as tables_created
FROM information_schema.tables 
WHERE table_schema = DATABASE() 
AND table_name IN ('users', 'devices', 'reports', 'law_enforcement_agencies', 'notifications', 'audit_logs', 'device_transfers', 'imei_checks');-- OTP 
(One-Time Password) table for secure operations
CREATE TABLE otps (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    otp_code VARCHAR(10) NOT NULL,
    otp_type ENUM('email_verification', 'device_transfer', 'password_reset', '2fa', 'device_login', 'device_verification') NOT NULL,
    reference_id VARCHAR(128) NULL COMMENT 'Reference to related record (transfer_id, device_fingerprint, etc.)',
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP NULL,
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_otp_code (otp_code),
    INDEX idx_expires_at (expires_at),
    INDEX idx_otp_type (otp_type)
) ENGINE=InnoDB COMMENT='One-time passwords for secure operations';

-- Email verification tokens table
CREATE TABLE email_verification_tokens (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    token VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_token (token),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB COMMENT='Email verification tokens';

-- SMS notifications table (for future SMS integration)
CREATE TABLE sms_notifications (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NULL,
    phone_number VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    notification_type ENUM('device_alert', 'transfer_otp', 'security_alert', 'case_update') NOT NULL,
    status ENUM('pending', 'sent', 'failed', 'delivered') DEFAULT 'pending',
    provider VARCHAR(50) NULL COMMENT 'SMS provider used',
    provider_message_id VARCHAR(255) NULL,
    sent_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_phone_number (phone_number),
    INDEX idx_status (status),
    INDEX idx_notification_type (notification_type)
) ENGINE=InnoDB COMMENT='SMS notification queue and history';-- Enhanc
ed audit logs table with MAC address and better tracking
ALTER TABLE audit_logs ADD COLUMN mac_address VARCHAR(17) NULL COMMENT 'MAC address of the device used';
ALTER TABLE audit_logs ADD COLUMN user_agent TEXT NULL COMMENT 'Browser/device user agent';
ALTER TABLE audit_logs ADD COLUMN session_id VARCHAR(255) NULL COMMENT 'User session identifier';
ALTER TABLE audit_logs ADD COLUMN request_method VARCHAR(10) NULL COMMENT 'HTTP method used';
ALTER TABLE audit_logs ADD COLUMN request_url TEXT NULL COMMENT 'Full request URL';
ALTER TABLE audit_logs ADD COLUMN response_status INT NULL COMMENT 'HTTP response status';
ALTER TABLE audit_logs ADD COLUMN execution_time_ms INT NULL COMMENT 'Request execution time in milliseconds';

-- Business users table for enhanced business information
CREATE TABLE business_profiles (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    business_name VARCHAR(255) NOT NULL,
    business_type ENUM('electronics_retailer', 'phone_shop', 'computer_store', 'repair_service', 'distributor', 'manufacturer', 'corporate', 'other') NOT NULL,
    business_registration_number VARCHAR(100) NOT NULL,
    tax_id VARCHAR(50) NULL,
    business_address TEXT NOT NULL,
    business_phone VARCHAR(20) NULL,
    business_email VARCHAR(255) NULL,
    website VARCHAR(255) NULL,
    state VARCHAR(100) NULL,
    city VARCHAR(100) NULL,
    business_license_url TEXT NULL,
    tax_certificate_url TEXT NULL,
    expected_device_volume ENUM('1-50', '51-200', '201-500', '501-1000', '1000+') NULL,
    business_description TEXT NULL,
    verification_status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending',
    verified_at TIMESTAMP NULL,
    verified_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_verification_status (verification_status),
    INDEX idx_business_type (business_type)
) ENGINE=InnoDB COMMENT='Business profile information for business users';

-- Device batches for bulk registration
CREATE TABLE device_batches (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    batch_name VARCHAR(255) NOT NULL,
    supplier VARCHAR(255) NULL,
    purchase_date DATE NULL,
    invoice_number VARCHAR(100) NULL,
    proof_url TEXT NULL,
    notes TEXT NULL,
    total_devices INT DEFAULT 0,
    verified_devices INT DEFAULT 0,
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_batch_name (batch_name)
) ENGINE=InnoDB COMMENT='Device registration batches for bulk operations';

-- Add batch_id to devices table
ALTER TABLE devices ADD COLUMN batch_id VARCHAR(36) NULL COMMENT 'Reference to device batch';
ALTER TABLE devices ADD FOREIGN KEY (batch_id) REFERENCES device_batches(id) ON DELETE SET NULL;
ALTER TABLE devices ADD INDEX idx_batch_id (batch_id);

-- Enhanced user tracking
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(45) NULL;
ALTER TABLE users ADD COLUMN last_login_mac VARCHAR(17) NULL;
ALTER TABLE users ADD COLUMN login_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN failed_login_attempts INT DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TIMESTAMP NULL;

-- Session tracking table
CREATE TABLE user_sessions (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    session_token VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    mac_address VARCHAR(17) NULL,
    user_agent TEXT NULL,
    device_fingerprint TEXT NULL,
    location_info JSON NULL COMMENT 'Geolocation data if available',
    is_active BOOLEAN DEFAULT TRUE,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_session_token (session_token),
    INDEX idx_is_active (is_active),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB COMMENT='User session tracking with device fingerprinting';

-- Device access logs for tracking who accessed what device info
CREATE TABLE device_access_logs (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    device_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NULL,
    access_type ENUM('view', 'edit', 'delete', 'public_check', 'report', 'transfer') NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    mac_address VARCHAR(17) NULL,
    user_agent TEXT NULL,
    session_id VARCHAR(36) NULL,
    result ENUM('success', 'denied', 'error') NOT NULL,
    details JSON NULL COMMENT 'Additional access details',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_device_id (device_id),
    INDEX idx_user_id (user_id),
    INDEX idx_access_type (access_type),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB COMMENT='Detailed device access logging';

-- Admin verification queue with better tracking
CREATE TABLE admin_verification_queue (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    item_type ENUM('device', 'user', 'business', 'report') NOT NULL,
    item_id VARCHAR(36) NOT NULL,
    submitted_by VARCHAR(36) NOT NULL,
    assigned_to VARCHAR(36) NULL,
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    status ENUM('pending', 'in_review', 'approved', 'rejected', 'requires_info') DEFAULT 'pending',
    notes TEXT NULL,
    admin_notes TEXT NULL,
    verification_data JSON NULL COMMENT 'Additional verification information',
    reviewed_at TIMESTAMP NULL,
    reviewed_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_item_type_id (item_type, item_id),
    INDEX idx_status (status),
    INDEX idx_priority (priority),
    INDEX idx_assigned_to (assigned_to)
) ENGINE=InnoDB COMMENT='Centralized verification queue for all admin tasks';

-- System activity dashboard data
CREATE TABLE system_metrics (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    metric_type VARCHAR(100) NOT NULL,
    metric_value DECIMAL(15,4) NOT NULL,
    metric_unit VARCHAR(50) NULL,
    tags JSON NULL COMMENT 'Additional metric tags',
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_metric_type (metric_type),
    INDEX idx_recorded_at (recorded_at)
) ENGINE=InnoDB COMMENT='System performance and usage metrics';

-- Insert initial system metrics
INSERT INTO system_metrics (id, metric_type, metric_value, metric_unit) VALUES
(UUID(), 'system_uptime', 100.0, 'percentage'),
(UUID(), 'api_response_time', 150.0, 'milliseconds'),
(UUID(), 'database_connections', 5.0, 'count'),
(UUID(), 'active_sessions', 0.0, 'count');

-- Create indexes for better performance
CREATE INDEX idx_devices_status_created ON devices(status, created_at);
CREATE INDEX idx_reports_status_created ON reports(status, created_at);
CREATE INDEX idx_users_role_created ON users(role, created_at);
CREATE INDEX idx_audit_logs_created_user ON audit_logs(created_at, user_id);

-- Update triggers to include MAC address tracking
DELIMITER //

CREATE TRIGGER update_user_login_stats
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
    IF NEW.last_login_at != OLD.last_login_at THEN
        SET NEW.login_count = OLD.login_count + 1;
    END IF;
END//

CREATE TRIGGER log_device_changes
AFTER UPDATE ON devices
FOR EACH ROW
BEGIN
    INSERT INTO audit_logs (id, user_id, action, table_name, record_id, old_values, new_values, created_at)
    VALUES (UUID(), NEW.user_id, 'DEVICE_UPDATED', 'devices', NEW.id, 
            JSON_OBJECT('status', OLD.status, 'updated_at', OLD.updated_at),
            JSON_OBJECT('status', NEW.status, 'updated_at', NEW.updated_at),
            NOW());
END//

DELIMITER ;

-- Add some sample LEA agencies for testing
INSERT INTO law_enforcement_agencies (id, agency_name, contact_email, contact_phone, region, address, jurisdiction_type, active) VALUES
(UUID(), 'Lagos State Police Command', 'clintonfaze@gmail.com', '+234-1-234-5678', 'Lagos', 'Lagos Island, Lagos State', 'state', TRUE),
(UUID(), 'FCT Police Command', 'clintonfaze@gmail.com', '+234-9-234-5678', 'Abuja', 'Central Business District, Abuja', 'federal', TRUE),
(UUID(), 'Rivers State Police Command', 'clintonfaze@gmail.com', '+234-84-234-567', 'Rivers', 'Port Harcourt, Rivers State', 'state', TRUE),
(UUID(), 'Kano State Police Command', 'clintonfaze@gmail.com', '+234-64-234-567', 'Kano', 'Kano City, Kano State', 'state', TRUE);-- 
Add profile image to users table
ALTER TABLE users ADD COLUMN profile_image_url TEXT NULL COMMENT 'User profile image URL';

-- Enhanced notifications table with better structure
DROP TABLE IF EXISTS notifications;
CREATE TABLE notifications (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type ENUM('info', 'success', 'warning', 'error', 'device_alert', 'transfer', 'verification', 'report_update') NOT NULL DEFAULT 'info',
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    is_read BOOLEAN DEFAULT FALSE,
    action_url VARCHAR(500) NULL COMMENT 'URL for notification action',
    action_text VARCHAR(100) NULL COMMENT 'Text for action button',
    metadata JSON NULL COMMENT 'Additional notification data',
    expires_at TIMESTAMP NULL COMMENT 'When notification expires',
    read_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_is_read (is_read),
    INDEX idx_type (type),
    INDEX idx_priority (priority),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB COMMENT='User notifications with enhanced features';

-- User preferences table for notification settings
CREATE TABLE user_preferences (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    email_notifications BOOLEAN DEFAULT TRUE,
    sms_notifications BOOLEAN DEFAULT TRUE,
    push_notifications BOOLEAN DEFAULT TRUE,
    device_alerts BOOLEAN DEFAULT TRUE,
    transfer_notifications BOOLEAN DEFAULT TRUE,
    verification_notifications BOOLEAN DEFAULT TRUE,
    report_updates BOOLEAN DEFAULT TRUE,
    marketing_emails BOOLEAN DEFAULT FALSE,
    theme ENUM('light', 'dark', 'auto') DEFAULT 'auto',
    language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'UTC',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_preferences (user_id)
) ENGINE=InnoDB COMMENT='User notification and app preferences';

-- Insert default preferences for existing users
INSERT INTO user_preferences (id, user_id)
SELECT UUID(), id FROM users WHERE id NOT IN (SELECT user_id FROM user_preferences);

-- Sample notifications for testing
INSERT INTO notifications (id, user_id, title, message, type, priority, action_url, action_text) 
SELECT 
    UUID(),
    u.id,
    'Welcome to Check It!',
    'Thank you for joining Check It Device Registry. Start by registering your first device to protect it from theft.',
    'info',
    'medium',
    '/register-device',
    'Register Device'
FROM users u 
WHERE u.role = 'user' 
LIMIT 5;

-- Create indexes for better notification performance
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, created_at);
CREATE INDEX idx_notifications_priority_created ON notifications(priority, created_at);

-- Trigger to create default preferences for new users
DELIMITER //
CREATE TRIGGER create_user_preferences
AFTER INSERT ON users
FOR EACH ROW
BEGIN
    INSERT INTO user_preferences (id, user_id) VALUES (UUID(), NEW.id);
END//
DELIMITER ;