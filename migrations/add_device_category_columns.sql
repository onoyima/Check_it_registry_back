-- Add device category support columns to devices table
-- Ensures devices can store category, category-specific data, and secondary identifiers

ALTER TABLE devices 
ADD COLUMN IF NOT EXISTS category VARCHAR(50) COMMENT 'Normalized device category key',
ADD COLUMN IF NOT EXISTS category_data JSON COMMENT 'Category-specific structured data',
ADD COLUMN IF NOT EXISTS secondary_identifiers JSON COMMENT 'Additional identifiers (e.g., IMEI2, MAC, VIN)';