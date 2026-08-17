-- Migration: Add first_name, middle_name, last_name to users table
-- Also make phone a unique identifier
-- Backward compatible: existing users with just 'name' will not break

-- Add new name columns
ALTER TABLE users ADD COLUMN first_name VARCHAR(50) DEFAULT NULL AFTER name;
ALTER TABLE users ADD COLUMN middle_name VARCHAR(50) DEFAULT NULL AFTER first_name;
ALTER TABLE users ADD COLUMN last_name VARCHAR(50) DEFAULT NULL AFTER middle_name;

-- Make phone unique (unique identifier)
-- First, find and remove duplicate phone numbers (keep the earliest registration)
DELETE u1 FROM users u1
INNER JOIN users u2
WHERE u1.phone = u2.phone
  AND u1.phone IS NOT NULL
  AND u1.phone != ''
  AND u1.id > u2.id;

-- Add unique constraint on phone (allowing NULLs)
ALTER TABLE users ADD CONSTRAINT uq_users_phone UNIQUE (phone);

-- Migrate existing 'name' data to first_name/last_name for users who don't have the new fields yet
-- Split "First Last" → first_name="First", last_name="Last"
-- Split "First Middle Last" → first_name="First", middle_name="Middle", last_name="Last"
-- Single word → first_name=that word

UPDATE users
SET
  first_name = CASE
    WHEN name IS NOT NULL AND TRIM(name) != '' THEN
      TRIM(SUBSTRING_INDEX(TRIM(name), ' ', 1))
    ELSE NULL
  END,
  middle_name = CASE
    WHEN name IS NOT NULL AND
      (LENGTH(TRIM(name)) - LENGTH(REPLACE(TRIM(name), ' ', ''))) >= 2 THEN
      TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(TRIM(name), ' ', 2), ' ', -1))
    ELSE NULL
  END,
  last_name = CASE
    WHEN name IS NOT NULL AND
      (LENGTH(TRIM(name)) - LENGTH(REPLACE(TRIM(name), ' ', ''))) >= 2 THEN
      TRIM(SUBSTRING_INDEX(TRIM(name), ' ', -1))
    WHEN name IS NOT NULL AND
      (LENGTH(TRIM(name)) - LENGTH(REPLACE(TRIM(name), ' ', ''))) = 1 THEN
      TRIM(SUBSTRING_INDEX(TRIM(name), ' ', -1))
    ELSE NULL
  END
WHERE first_name IS NULL;
