const db = require('../config');
(async () => {
  try {
    // 1. Escrow transactions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS escrow_transactions (
        id VARCHAR(36) PRIMARY KEY,
        transaction_id VARCHAR(36) NOT NULL,
        listing_id VARCHAR(36) NOT NULL,
        buyer_id VARCHAR(36) NOT NULL,
        seller_id VARCHAR(36) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        platform_fee_percent DECIMAL(5,2) NOT NULL DEFAULT 2.50,
        platform_fee_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        seller_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        status ENUM('held','released','refunded','disputed') NOT NULL DEFAULT 'held',
        released_at TIMESTAMP NULL,
        refunded_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE,
        FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('Created escrow_transactions table');

    // 2. Delivery confirmations table
    await db.query(`
      CREATE TABLE IF NOT EXISTS delivery_confirmations (
        id VARCHAR(36) PRIMARY KEY,
        escrow_id VARCHAR(36) NOT NULL,
        listing_id VARCHAR(36) NOT NULL,
        buyer_id VARCHAR(36) NOT NULL,
        seller_id VARCHAR(36) NOT NULL,
        status ENUM('pending','confirmed','disputed') NOT NULL DEFAULT 'pending',
        confirmed_at TIMESTAMP NULL,
        disputed_at TIMESTAMP NULL,
        dispute_reason TEXT,
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (escrow_id) REFERENCES escrow_transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE,
        FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('Created delivery_confirmations table');

    // 3. Seed default platform fee in system_settings if not exists
    const existing = await db.query("SELECT id FROM system_settings WHERE setting_key = 'platform_fee_percent'");
    if (existing.length === 0) {
      await db.query(
        "INSERT INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public) VALUES (UUID(), ?, ?, ?, ?, ?)",
        ['platform_fee_percent', '2.50', 'number', 'Platform fee percentage deducted from seller payout on each sale', false]
      );
      console.log('Seeded default platform_fee_percent = 2.50%');
    } else {
      console.log('platform_fee_percent already exists, skipping seed');
    }

    process.exit(0);
  } catch (e) {
    console.error('Migration error:', e.message);
    process.exit(1);
  }
})();
