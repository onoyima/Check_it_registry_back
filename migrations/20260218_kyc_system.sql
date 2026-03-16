CREATE TABLE IF NOT EXISTS kyc_batches (
  id CHAR(36) PRIMARY KEY,
  batch_status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
  total_records INT DEFAULT 0,
  successful_verifications INT DEFAULT 0,
  failed_verifications INT DEFAULT 0,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kyc_verifications (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  nin TEXT NOT NULL,
  nin_status ENUM('pending', 'verified', 'failed') DEFAULT 'pending',
  face_match_score FLOAT,
  liveness_passed BOOLEAN,
  verification_batch_id CHAR(36),
  verification_response JSON,
  verified_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (verification_batch_id) REFERENCES kyc_batches(id) ON DELETE SET NULL
);

ALTER TABLE users
ADD COLUMN kyc_status ENUM('unverified', 'pending', 'verified', 'failed') DEFAULT 'unverified',
ADD COLUMN is_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN verification_badge_visible BOOLEAN DEFAULT FALSE,
ADD COLUMN caution_flag BOOLEAN DEFAULT FALSE,
ADD COLUMN verified_full_name VARCHAR(255),
ADD COLUMN verified_dob DATE,
ADD COLUMN verified_gender VARCHAR(50),
ADD COLUMN verified_photo_url TEXT;
