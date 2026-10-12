-- Fix OTPs table to support device login and proper reference_id length
-- 1) Add missing otp_type values: device_login, device_verification
-- 2) Widen reference_id to store SHA-256 device fingerprints (64 chars)

-- Convert ENUM to VARCHAR so any OTP type is accepted (device_login,
-- device_verification, account_deletion, reauthentication, and the
-- dynamically generated `<action>_email` / `<action>_sms` types)
ALTER TABLE otps 
  MODIFY COLUMN otp_type VARCHAR(50) NOT NULL;

-- Widen reference_id column to avoid truncation of device fingerprint
ALTER TABLE otps 
  MODIFY COLUMN reference_id VARCHAR(128) NULL COMMENT 'Reference to related record (transfer_id, device_fingerprint, etc.)';

-- Optional: ensure attempts/max_attempts columns exist with defaults (safe reapply)
ALTER TABLE otps 
  MODIFY COLUMN attempts INT DEFAULT 0,
  MODIFY COLUMN max_attempts INT DEFAULT 3;

-- Note: Existing OTPs created with truncated reference_id will not match verification.
-- Users should request a new OTP after this migration.