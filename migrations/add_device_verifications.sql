-- Create device_verifications table to track verification actions
CREATE TABLE IF NOT EXISTS device_verifications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  device_id VARCHAR(36) NOT NULL,
  verified_by VARCHAR(36) NULL,
  action VARCHAR(50) NOT NULL DEFAULT 'verified',
  status VARCHAR(50) NOT NULL DEFAULT 'approved',
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_device_verifications_device_id (device_id),
  INDEX idx_verified_by (verified_by),

  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Device verification history with actor and status';