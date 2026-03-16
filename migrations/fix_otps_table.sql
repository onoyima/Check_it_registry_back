-- Fix OTPs table to support device login and proper reference_id length
-- 1) Add missing otp_type values: device_login, device_verification
-- 2) Widen reference_id to store SHA-256 device fingerprints (64 chars)

-- Modify ENUM to include new types
ALTER TABLE otps 
  MODIFY COLUMN otp_type ENUM('email_verification', 'device_transfer', 'password_reset', '2fa', 'device_login', 'device_verification') NOT NULL;

-- Widen reference_id column to avoid truncation of device fingerprint
ALTER TABLE otps 
  MODIFY COLUMN reference_id VARCHAR(128) NULL COMMENT 'Reference to related record (transfer_id, device_fingerprint, etc.)';

-- Optional: ensure attempts/max_attempts columns exist with defaults (safe reapply)
ALTER TABLE otps 
  MODIFY COLUMN attempts INT DEFAULT 0,
  MODIFY COLUMN max_attempts INT DEFAULT 3;

-- Note: Existing OTPs created with truncated reference_id will not match verification.
-- Users should request a new OTP after this migration.