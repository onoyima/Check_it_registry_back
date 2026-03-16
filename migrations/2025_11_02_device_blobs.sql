-- Migration: Add blob columns for device images and proofs
-- Date: 2025-11-02

ALTER TABLE devices
  ADD COLUMN device_image_blob LONGBLOB NULL,
  ADD COLUMN device_image_mime VARCHAR(100) NULL,
  ADD COLUMN device_image_filename VARCHAR(255) NULL,
  ADD COLUMN proof_blob LONGBLOB NULL,
  ADD COLUMN proof_mime VARCHAR(100) NULL,
  ADD COLUMN proof_filename VARCHAR(255) NULL;

-- Indexes are not typically added for BLOB columns; metadata columns can be indexed if needed.