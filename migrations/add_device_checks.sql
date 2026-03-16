-- Create device_checks table for logging detailed device check events
-- This is a surgical migration: only creates the specific table needed
-- Safe: uses IF NOT EXISTS to avoid impacting existing data

CREATE TABLE IF NOT EXISTS device_checks (
  id VARCHAR(36) PRIMARY KEY,
  device_id VARCHAR(36) NULL,
  query VARCHAR(64) NOT NULL,
  checker_user_id VARCHAR(36) NULL,
  ip_address VARCHAR(64) NULL,
  mac_address VARCHAR(64) NULL,
  user_agent TEXT NULL,
  location_latitude DOUBLE NULL,
  location_longitude DOUBLE NULL,
  location_accuracy DOUBLE NULL,
  device_fingerprint JSON NULL,
  check_result ENUM('not_found','found','reported_stolen','reported_lost') NOT NULL,
  device_status_at_check ENUM('verified','unverified','stolen','lost','found') NULL,
  is_suspicious BOOLEAN DEFAULT FALSE,
  alert_sent BOOLEAN DEFAULT FALSE,
  notes VARCHAR(255) NULL,
  created_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_checks_device_id ON device_checks(device_id);
CREATE INDEX IF NOT EXISTS idx_device_checks_query ON device_checks(query);
CREATE INDEX IF NOT EXISTS idx_device_checks_created_at ON device_checks(created_at);