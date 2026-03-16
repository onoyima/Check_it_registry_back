-- Enhanced Security Features Database Schema

-- Device Check Logs Table
CREATE TABLE device_check_logs (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  device_id VARCHAR(36) NOT NULL,
  checker_user_id VARCHAR(36),
  check_type ENUM('public_check', 'ownership_verification', 'purchase_check') NOT NULL,
  
  -- Location Data
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  location_accuracy FLOAT,
  location_source ENUM('gps', 'network', 'passive'),
  
  -- Network Data
  ip_address VARCHAR(45),
  mac_address VARCHAR(17),
  user_agent TEXT,
  browser_fingerprint TEXT,
  
  -- Security Data
  device_fingerprint TEXT,
  session_id VARCHAR(255),
  risk_score INT DEFAULT 0,
  suspicious_flags JSON,
  
  -- Results
  check_result ENUM('legitimate', 'stolen', 'suspicious', 'unknown'),
  warnings_shown JSON,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (checker_user_id) REFERENCES users(id) ON DELETE SET NULL,
  
  INDEX idx_device_checks (device_id, created_at),
  INDEX idx_location (latitude, longitude),
  INDEX idx_ip_address (ip_address),
  INDEX idx_mac_address (mac_address)
);

-- Ownership Transfers Table
CREATE TABLE ownership_transfers (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  device_id VARCHAR(36) NOT NULL,
  from_user_id VARCHAR(36) NOT NULL,
  to_user_id VARCHAR(36),
  transfer_code VARCHAR(20) UNIQUE NOT NULL,
  otp_code VARCHAR(6),
  status ENUM('initiated', 'otp_verified', 'active', 'completed', 'expired', 'cancelled') DEFAULT 'initiated',
  
  -- Transfer Details
  sale_price DECIMAL(10, 2),
  transfer_reason TEXT,
  buyer_email VARCHAR(255),
  agreement_terms JSON,
  
  -- Location Data
  transfer_location JSON,
  
  -- Timestamps
  expires_at TIMESTAMP NOT NULL,
  otp_expires_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE SET NULL,
  
  INDEX idx_transfer_code (transfer_code),
  INDEX idx_device_transfers (device_id),
  INDEX idx_expires_at (expires_at)
);

-- Recovery Services Table
CREATE TABLE recovery_services (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  device_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  service_package ENUM('basic', 'standard', 'premium') NOT NULL,
  
  -- Payment Info
  payment_intent_id VARCHAR(255),
  payment_status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
  amount_paid DECIMAL(10, 2),
  currency VARCHAR(3) DEFAULT 'USD',
  
  -- Service Details
  assigned_agent_id VARCHAR(36),
  status ENUM('payment_pending', 'active', 'investigating', 'leads_found', 'recovered', 'unsuccessful', 'refunded') DEFAULT 'payment_pending',
  service_notes TEXT,
  
  -- Timestamps
  expires_at TIMESTAMP NULL,
  activated_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  
  INDEX idx_device_recovery (device_id),
  INDEX idx_user_recovery (user_id),
  INDEX idx_payment_status (payment_status),
  INDEX idx_service_status (status)
);

-- Recovery Agents Table
CREATE TABLE recovery_agents (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  specialization JSON, -- Array of device categories
  region VARCHAR(100),
  active_cases INT DEFAULT 0,
  max_cases INT DEFAULT 10,
  success_rate DECIMAL(5, 2) DEFAULT 0.00,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Add recovery agent foreign key to recovery services
ALTER TABLE recovery_services ADD FOREIGN KEY (assigned_agent_id) REFERENCES recovery_agents(id) ON DELETE SET NULL;