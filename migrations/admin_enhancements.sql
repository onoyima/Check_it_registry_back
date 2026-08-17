-- Admin Enhancement Tables for Check It Device Registry
-- Run this to add admin management features

USE check_it_registry;

-- User suspensions table
CREATE TABLE IF NOT EXISTS user_suspensions (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    suspended_by VARCHAR(36) NOT NULL,
    reason TEXT NOT NULL,
    expires_at TIMESTAMP NULL COMMENT 'NULL for permanent suspension',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (suspended_by) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_user_id (user_id),
    INDEX idx_suspended_by (suspended_by),
    INDEX idx_expires_at (expires_at),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB COMMENT='User account suspensions';

-- System settings table
CREATE TABLE IF NOT EXISTS system_settings (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    setting_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE COMMENT 'Can be accessed by non-admin users',
    updated_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_setting_key (setting_key),
    INDEX idx_is_public (is_public)
) ENGINE=InnoDB COMMENT='System configuration settings';

-- Admin activity log (separate from audit_logs for admin-specific actions)
CREATE TABLE IF NOT EXISTS admin_activity_log (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    admin_id VARCHAR(36) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) COMMENT 'user, device, report, system',
    target_id VARCHAR(36) COMMENT 'ID of the target entity',
    details JSON COMMENT 'Additional action details',
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_admin_id (admin_id),
    INDEX idx_action (action),
    INDEX idx_target_type (target_type),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB COMMENT='Admin-specific activity logging';

-- Device verification history
CREATE TABLE IF NOT EXISTS device_verification_history (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    device_id VARCHAR(36) NOT NULL,
    verified_by VARCHAR(36) NOT NULL,
    action ENUM('approved', 'rejected', 'pending_review') NOT NULL,
    notes TEXT,
    proof_documents JSON COMMENT 'Array of document URLs reviewed',
    verification_score INT COMMENT '1-10 confidence score',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_device_id (device_id),
    INDEX idx_verified_by (verified_by),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB COMMENT='Device verification audit trail';

-- System alerts table
CREATE TABLE IF NOT EXISTS system_alerts (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    alert_type ENUM('security', 'system', 'user_activity', 'data_integrity') NOT NULL,
    severity ENUM('low', 'medium', 'high', 'critical') NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    details JSON,
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_by VARCHAR(36) NULL,
    resolved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_alert_type (alert_type),
    INDEX idx_severity (severity),
    INDEX idx_is_resolved (is_resolved),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB COMMENT='System alerts and notifications for admins';

-- Insert default system settings
INSERT INTO system_settings (setting_key, setting_value, setting_type, description, is_public) VALUES
('max_devices_per_user', '50', 'number', 'Maximum devices a user can register', FALSE),
('verification_timeout_days', '7', 'number', 'Days before unverified devices are flagged', FALSE),
('auto_assign_lea', 'true', 'boolean', 'Automatically assign LEA to new reports', FALSE),
('public_check_enabled', 'true', 'boolean', 'Enable public device checking', TRUE),
('notification_email_enabled', 'true', 'boolean', 'Enable email notifications', FALSE),
('notification_sms_enabled', 'false', 'boolean', 'Enable SMS notifications', FALSE),
('system_maintenance_mode', 'false', 'boolean', 'System maintenance mode', TRUE),
('registration_enabled', 'true', 'boolean', 'Allow new user registrations', TRUE),
('device_registration_enabled', 'true', 'boolean', 'Allow new device registrations', TRUE),
('transfer_enabled', 'true', 'boolean', 'Allow device transfers', TRUE)
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- Create view for active suspensions
CREATE OR REPLACE VIEW active_suspensions AS
SELECT 
    us.*,
    u.name as user_name,
    u.email as user_email,
    admin.name as suspended_by_name
FROM user_suspensions us
JOIN users u ON us.user_id = u.id
JOIN users admin ON us.suspended_by = admin.id
WHERE us.is_active = TRUE 
AND (us.expires_at IS NULL OR us.expires_at > NOW());

-- Create view for admin dashboard summary
CREATE OR REPLACE VIEW admin_dashboard_summary AS
SELECT 
    (SELECT COUNT(*) FROM users) as total_users,
    (SELECT COUNT(*) FROM users WHERE role = 'admin') as admin_users,
    (SELECT COUNT(*) FROM users WHERE role = 'lea') as lea_users,
    (SELECT COUNT(*) FROM devices) as total_devices,
    (SELECT COUNT(*) FROM devices WHERE status = 'unverified') as pending_verifications,
    (SELECT COUNT(*) FROM devices WHERE status = 'verified') as verified_devices,
    (SELECT COUNT(*) FROM devices WHERE status IN ('stolen', 'lost')) as stolen_lost_devices,
    (SELECT COUNT(*) FROM reports) as total_reports,
    (SELECT COUNT(*) FROM reports WHERE status = 'open') as open_reports,
    (SELECT COUNT(*) FROM reports WHERE status = 'resolved') as resolved_reports,
    (SELECT COUNT(*) FROM notifications WHERE status = 'pending') as pending_notifications,
    (SELECT COUNT(*) FROM notifications WHERE status = 'failed') as failed_notifications,
    (SELECT COUNT(*) FROM active_suspensions) as active_suspensions,
    (SELECT COUNT(*) FROM system_alerts WHERE is_resolved = FALSE) as unresolved_alerts;

-- Create indexes for better performance
CREATE INDEX idx_devices_status_created ON devices(status, created_at);
CREATE INDEX idx_reports_status_created ON reports(status, created_at);
CREATE INDEX idx_users_role_created ON users(role, created_at);
CREATE INDEX idx_notifications_status_created ON notifications(status, created_at);

-- Create function to check if user is suspended
DELIMITER //

CREATE FUNCTION is_user_suspended(user_id_param VARCHAR(36)) RETURNS BOOLEAN
READS SQL DATA
DETERMINISTIC
BEGIN
    DECLARE suspension_count INT DEFAULT 0;
    
    SELECT COUNT(*) INTO suspension_count
    FROM user_suspensions
    WHERE user_id = user_id_param
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW());
    
    RETURN suspension_count > 0;
END//

DELIMITER ;

-- Create trigger to automatically expire suspensions
DELIMITER //

CREATE EVENT IF NOT EXISTS expire_suspensions
ON SCHEDULE EVERY 1 HOUR
DO
BEGIN
    UPDATE user_suspensions 
    SET is_active = FALSE, updated_at = NOW()
    WHERE is_active = TRUE 
    AND expires_at IS NOT NULL 
    AND expires_at <= NOW();
END//

DELIMITER ;

-- Enable event scheduler
SET GLOBAL event_scheduler = ON;

-- Show completion message
SELECT 'Admin enhancement tables created successfully!' as status;