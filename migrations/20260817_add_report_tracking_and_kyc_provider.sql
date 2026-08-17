-- Migration: Add report tracking and KYC provider columns
-- Required for redesigned stolen/lost device reporting flow

-- 1. Add report tracking columns to reports table
ALTER TABLE reports ADD COLUMN payment_status ENUM('pending','completed','free','failed') DEFAULT 'free';
ALTER TABLE reports ADD COLUMN payment_reference VARCHAR(255) DEFAULT NULL;
ALTER TABLE reports ADD COLUMN payment_amount DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE reports ADD COLUMN report_number INT DEFAULT NULL;
ALTER TABLE reports ADD COLUMN kyc_performed BOOLEAN DEFAULT FALSE;
ALTER TABLE reports ADD COLUMN kyc_result ENUM('verified','failed','skipped') DEFAULT 'skipped';

-- 2. Add provider column to kyc_verifications
ALTER TABLE kyc_verifications ADD COLUMN provider VARCHAR(50) DEFAULT NULL;

-- 3. Ensure report_verification_fee exists in system_settings (reused, not new)
INSERT INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
VALUES (UUID(), 'report_verification_fee', '300', 'number', 'Amount charged for paid device reports in NGN', FALSE)
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- 4. Ensure free_reports_per_device exists (legacy, kept for backward compat)
INSERT INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
VALUES (UUID(), 'free_reports_per_device', '3', 'number', 'Legacy: free reports per device (now per user)', FALSE)
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- 5. Add new setting for first-report-paid + 2-free logic
INSERT INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
VALUES (UUID(), 'free_reports_after_first', '2', 'number', 'Number of free reports after the first paid report', FALSE)
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
