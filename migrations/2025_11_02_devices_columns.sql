-- Migration: Replace JSON fields with explicit device columns
USE check_it_registry;

-- Add category column if missing
ALTER TABLE devices ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'others' COMMENT 'Normalized device category';

-- Make proof_url optional
ALTER TABLE devices MODIFY COLUMN proof_url TEXT NULL COMMENT 'Receipt/invoice URL';

-- Drop JSON columns if they exist
ALTER TABLE devices DROP COLUMN IF EXISTS category_data;
ALTER TABLE devices DROP COLUMN IF EXISTS secondary_identifiers;

-- Add explicit identifier and category-specific columns
ALTER TABLE devices ADD COLUMN IF NOT EXISTS imei2 VARCHAR(15) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS network_carrier VARCHAR(100) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS operating_system VARCHAR(100) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS storage_capacity VARCHAR(50) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS mac_address VARCHAR(17) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS processor_type VARCHAR(100) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS ram_size VARCHAR(50) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS bluetooth_mac VARCHAR(17) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS vin VARCHAR(17) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS license_plate VARCHAR(20) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS year VARCHAR(4) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS engine_number VARCHAR(50) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS registration_state VARCHAR(100) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS description TEXT NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS notes TEXT NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS estimated_value DECIMAL(12,2) NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS certificate_number VARCHAR(100) NULL;

-- Add helpful indexes (may error if already exist; acceptable)
CREATE INDEX idx_category ON devices(category);
CREATE INDEX idx_vin ON devices(vin);
CREATE INDEX idx_license_plate ON devices(license_plate);
CREATE INDEX idx_mac_address ON devices(mac_address);
CREATE INDEX idx_bluetooth_mac ON devices(bluetooth_mac);