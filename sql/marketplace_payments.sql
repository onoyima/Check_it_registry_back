-- Marketplace and Payments Schema

-- Marketplace Listings Table
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id VARCHAR(36) PRIMARY KEY,
  seller_id VARCHAR(36) NOT NULL,
  device_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(15, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'NGN',
  device_condition ENUM('new', 'used', 'refurbished') NOT NULL,
  status ENUM('active', 'sold', 'hidden', 'deleted') DEFAULT 'active',
  location VARCHAR(255),
  images JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  
  INDEX idx_listings_seller (seller_id),
  INDEX idx_listings_device (device_id),
  INDEX idx_listings_status (status),
  INDEX idx_listings_price (price)
);

-- Payment Methods Table
CREATE TABLE IF NOT EXISTS payment_methods (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type ENUM('card', 'bank_account') NOT NULL,
  provider VARCHAR(50) DEFAULT 'manual', -- 'paystack', 'stripe', 'manual'
  last4 VARCHAR(4),
  exp_month INT,
  exp_year INT,
  is_default BOOLEAN DEFAULT FALSE,
  details JSON, -- Encrypted token or safe details
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  
  INDEX idx_payment_user (user_id)
);

-- Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'NGN',
  type ENUM('marketplace_purchase', 'subscription', 'service_fee', 'recovery_service') NOT NULL,
  status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
  reference VARCHAR(255), -- External reference (e.g. Paystack ref)
  related_entity_type ENUM('listing', 'recovery', 'subscription'),
  related_entity_id VARCHAR(36),
  payment_method_id VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL,
  
  INDEX idx_transactions_user (user_id),
  INDEX idx_transactions_status (status),
  INDEX idx_transactions_reference (reference)
);
