// Auto-run all pending migrations on server startup
const db = require('../config');

const MIGRATIONS = [
  {
    name: '001_create_escrow_tables',
    sql: [
      `CREATE TABLE IF NOT EXISTS escrow_transactions (
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS delivery_confirmations (
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
    ],
    seed: async () => {
      // Add FK constraints gracefully — some MySQL versions reject FK on VARCHAR PK
      await db.query(`ALTER TABLE escrow_transactions ADD CONSTRAINT escrow_fk_txn FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE`).catch(() => {});
      await db.query(`ALTER TABLE escrow_transactions ADD CONSTRAINT escrow_fk_list FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE`).catch(() => {});
      await db.query(`ALTER TABLE escrow_transactions ADD CONSTRAINT escrow_fk_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE`).catch(() => {});
      await db.query(`ALTER TABLE escrow_transactions ADD CONSTRAINT escrow_fk_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE`).catch(() => {});
      await db.query(`ALTER TABLE delivery_confirmations ADD CONSTRAINT delconf_fk_escrow FOREIGN KEY (escrow_id) REFERENCES escrow_transactions(id) ON DELETE CASCADE`).catch(() => {});
      await db.query(`ALTER TABLE delivery_confirmations ADD CONSTRAINT delconf_fk_list FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE`).catch(() => {});
      await db.query(`ALTER TABLE delivery_confirmations ADD CONSTRAINT delconf_fk_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE`).catch(() => {});
      await db.query(`ALTER TABLE delivery_confirmations ADD CONSTRAINT delconf_fk_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE`).catch(() => {});

      const existing = await db.query("SELECT id FROM system_settings WHERE setting_key = 'platform_fee_percent'");
      if (existing.length === 0) {
        await db.query(
          "INSERT INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public) VALUES (UUID(), ?, ?, ?, ?, ?)",
          ['platform_fee_percent', '2.50', 'number', 'Platform fee percentage deducted from seller payout on each sale', false]
        );
      }
    }
  },
  {
    name: '002_add_buyer_id_to_listings',
    sql: [],
    seed: async () => {
      const cols = await db.query("SHOW COLUMNS FROM marketplace_listings LIKE 'buyer_id'");
      if (cols.length === 0) {
        await db.query('ALTER TABLE marketplace_listings ADD COLUMN buyer_id VARCHAR(36) DEFAULT NULL AFTER seller_id');
      }
      const cols2 = await db.query("SHOW COLUMNS FROM marketplace_listings LIKE 'sold_at'");
      if (cols2.length === 0) {
        await db.query('ALTER TABLE marketplace_listings ADD COLUMN sold_at TIMESTAMP NULL AFTER buyer_id');
      }
    }
  },
  {
    name: '003_add_read_column_to_notifications',
    sql: [],
    seed: async () => {
      const cols = await db.query("SHOW COLUMNS FROM notifications LIKE 'is_read'");
      if (cols.length === 0) {
        await db.query('ALTER TABLE notifications ADD COLUMN is_read TINYINT(1) DEFAULT 0 AFTER payload');
      }
    }
  },
  {
    name: '004_fix_transaction_enums',
    sql: [
      `ALTER TABLE transactions MODIFY COLUMN type ENUM('marketplace_purchase','marketplace_sale','subscription','service_fee','recovery_service') NOT NULL`,
      `ALTER TABLE transactions MODIFY COLUMN related_entity_type ENUM('marketplace_listing','listing','recovery','subscription') DEFAULT NULL`,
    ]
  },
  {
    name: '005_create_seller_bank_accounts',
    sql: [
      `CREATE TABLE IF NOT EXISTS seller_bank_accounts (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL UNIQUE,
        bank_name VARCHAR(255) NOT NULL,
        bank_code VARCHAR(10) NOT NULL,
        account_number VARCHAR(20) NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        recipient_code VARCHAR(255),
        is_verified TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
    ],
    seed: async () => {
      // Graceful FK — may fail depending on MySQL version
      await db.query('ALTER TABLE seller_bank_accounts ADD CONSTRAINT sba_fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE').catch(() => {});
    }
  },
  {
    name: '006_add_audit_tracking_columns',
    sql: [],
    seed: async () => {
      // audit_logs
      const auditCols = [
        'mac_address VARCHAR(255) DEFAULT NULL AFTER ip_address',
        'session_id VARCHAR(255) DEFAULT NULL AFTER user_agent',
        'request_method VARCHAR(10) DEFAULT NULL AFTER session_id',
        'request_url TEXT DEFAULT NULL AFTER request_method',
        'response_status INT DEFAULT NULL AFTER request_url',
        'execution_time_ms INT DEFAULT NULL AFTER response_status',
      ];
      const existingAudit = (await db.query("SHOW COLUMNS FROM audit_logs")).map(r => r.Field);
      for (const def of auditCols) {
        const colName = def.split(' ')[0];
        if (!existingAudit.includes(colName)) {
          await db.query(`ALTER TABLE audit_logs ADD COLUMN ${def}`);
        }
      }
      // Add user_name if missing
      if (!existingAudit.includes('user_name')) {
        await db.query('ALTER TABLE audit_logs ADD COLUMN user_name VARCHAR(255) DEFAULT NULL AFTER user_id');
      }

      // device_access_logs
      const daCols = [
        'access_type VARCHAR(64) DEFAULT NULL AFTER user_id',
        'mac_address VARCHAR(255) DEFAULT NULL AFTER ip_address',
        'session_id VARCHAR(255) DEFAULT NULL AFTER user_agent',
        'result VARCHAR(16) DEFAULT NULL AFTER session_id',
        'details TEXT DEFAULT NULL AFTER result',
      ];
      const existingDA = (await db.query("SHOW COLUMNS FROM device_access_logs")).map(r => r.Field);
      for (const def of daCols) {
        const colName = def.split(' ')[0];
        if (!existingDA.includes(colName)) {
          await db.query(`ALTER TABLE device_access_logs ADD COLUMN ${def}`);
        }
      }

      // user_sessions
      const usCols = [
        'session_token VARCHAR(512) DEFAULT NULL AFTER user_id',
        'mac_address VARCHAR(255) DEFAULT NULL AFTER ip_address',
      ];
      const existingUS = (await db.query("SHOW COLUMNS FROM user_sessions")).map(r => r.Field);
      for (const def of usCols) {
        const colName = def.split(' ')[0];
        if (!existingUS.includes(colName)) {
          await db.query(`ALTER TABLE user_sessions ADD COLUMN ${def}`);
        }
      }
    }
  },
  {
    name: '007_add_performance_indexes',
    sql: [],
    seed: async () => {
      const indexes = [
        { table: 'devices', cols: '(user_id, created_at)', name: 'idx_devices_user_created' },
        { table: 'devices', cols: '(status, created_at)', name: 'idx_devices_status_created' },
        { table: 'devices', cols: '(imei)', name: 'idx_devices_imei_status' },
        { table: 'reports', cols: '(reporter_id, created_at)', name: 'idx_reports_reporter_created' },
        { table: 'reports', cols: '(device_id, report_type)', name: 'idx_reports_device_type' },
        { table: 'marketplace_listings', cols: '(status, created_at)', name: 'idx_listings_status_created' },
        { table: 'marketplace_listings', cols: '(seller_id, created_at)', name: 'idx_listings_seller_created' },
        { table: 'users', cols: '(role)', name: 'idx_users_role' },
        { table: 'users', cols: '(region)', name: 'idx_users_region' },
        { table: 'audit_logs', cols: '(created_at)', name: 'idx_audit_created' },
        { table: 'audit_logs', cols: '(resource_type, created_at)', name: 'idx_audit_resource_created' },
        { table: 'device_transfers', cols: '(from_user_id, created_at)', name: 'idx_transfers_from_created' },
        { table: 'device_transfers', cols: '(to_user_id, created_at)', name: 'idx_transfers_to_created' },
        { table: 'notifications', cols: '(user_id, created_at)', name: 'idx_notifications_user_created' },
        { table: 'security_events', cols: '(created_at)', name: 'idx_security_created' },
        { table: 'security_events', cols: '(severity, created_at)', name: 'idx_security_severity_created' },
        { table: 'escrow_transactions', cols: '(buyer_id, created_at)', name: 'idx_escrow_buyer_created' },
        { table: 'escrow_transactions', cols: '(seller_id, created_at)', name: 'idx_escrow_seller_created' },
      ];

      for (const idx of indexes) {
        try {
          const existing = await db.query(
            `SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
            [idx.table, idx.name]
          );
          if (existing.length === 0) {
            await db.query(`CREATE INDEX ${idx.name} ON ${idx.table} ${idx.cols}`);
            console.log(`    ✓ Created index ${idx.name} on ${idx.table}`);
          }
        } catch (err) {
          console.warn(`    ⚠ Index ${idx.name} on ${idx.table}: ${err.message}`);
        }
      }

      // Add FULLTEXT index for marketplace search
      try {
        const existing = await db.query(
          `SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'marketplace_listings' AND index_name = 'idx_listings_search'`
        );
        if (existing.length === 0) {
          await db.query(`CREATE FULLTEXT INDEX idx_listings_search ON marketplace_listings(title, description)`);
          console.log('    ✓ Created FULLTEXT index idx_listings_search on marketplace_listings');
        }
      } catch (err) {
        console.warn(`    ⚠ FULLTEXT index: ${err.message}`);
      }
    }
  },
  {
    name: '008_revenue_and_security_tables',
    sql: [
      `CREATE TABLE IF NOT EXISTS payment_invoices (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        purpose VARCHAR(64) NOT NULL,
        reference VARCHAR(128) NOT NULL,
        status ENUM('pending','completed','failed','refunded') DEFAULT 'pending',
        metadata JSON DEFAULT NULL,
        paid_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS verification_type VARCHAR(32) DEFAULT 'nin' AFTER user_id`,
      `ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(255) DEFAULT NULL AFTER nin_status`,
      `ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS fee_transaction_id VARCHAR(36) DEFAULT NULL AFTER provider_reference`,
      `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS mac_address VARCHAR(255) DEFAULT NULL AFTER ip_address`,
      `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS session_id VARCHAR(255) DEFAULT NULL AFTER user_agent`,
      `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_method VARCHAR(10) DEFAULT NULL AFTER session_id`,
      `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_url TEXT DEFAULT NULL AFTER request_method`,
      `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS response_status INT DEFAULT NULL AFTER request_url`,
      `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS execution_time_ms INT DEFAULT NULL AFTER response_status`,
      `ALTER TABLE transactions MODIFY COLUMN type ENUM('marketplace_purchase','marketplace_sale','subscription','service_fee','recovery_service','device_check_fee','report_verification_fee','marketplace_commission','nin_verification_fee','device_recovery_fee','business_verification_fee') NOT NULL`,
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference VARCHAR(128) DEFAULT NULL AFTER type`,
      `ALTER TABLE device_check_logs ADD COLUMN IF NOT EXISTS is_paid TINYINT(1) DEFAULT 0 AFTER risk_score`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS verification_fee_paid TINYINT(1) DEFAULT 0 AFTER evidence_url`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS fee_transaction_id VARCHAR(36) DEFAULT NULL AFTER verification_fee_paid`,
    ],
    seed: async () => {
      const feeSettings = [
        { key: 'nin_verification_fee', value: '500', description: 'Fee for NIN identity verification' },
        { key: 'report_verification_fee', value: '300', description: 'Fee for each device report after the first' },
        { key: 'device_check_free_tier', value: '3', description: 'Free device checks per user' },
        { key: 'device_check_fee', value: '100', description: 'Fee per device check after free tier' },
        { key: 'business_verification_fee', value: '2500', description: 'Fee for CAC business verification' },
        { key: 'marketplace_commission_percent', value: '5.00', description: 'Commission percentage on marketplace sales' },
        { key: 'device_recovery_fee', value: '2000', description: 'Fee for device recovery process' },
        { key: 'nin_verification_provider', value: 'prembly', description: 'Active NIN verification provider' },
        { key: 'cac_verification_provider', value: 'cac_ng', description: 'Active CAC verification provider' },
      ];

      for (const setting of feeSettings) {
        const existing = await db.query(
          'SELECT id FROM system_settings WHERE setting_key = ?', [setting.key]
        );
        if (existing.length === 0) {
          await db.query(
            `INSERT INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
             VALUES (UUID(), ?, ?, 'string', ?, false)`,
            [setting.key, setting.value, setting.description]
          );
        }
      }
    }
  },
  {
    name: '009_nin_verification_columns',
    sql: [
      `ALTER TABLE users ADD COLUMN nin_verified_at TIMESTAMP NULL AFTER is_verified`,
      `ALTER TABLE users ADD COLUMN nin_last_digits VARCHAR(4) DEFAULT NULL AFTER nin_verified_at`,
    ],
  },
  {
    name: '010_business_onboarding',
    sql: [
      `CREATE TABLE IF NOT EXISTS business_onboardings (
        id VARCHAR(36) PRIMARY KEY,
        business_id VARCHAR(36) NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255) DEFAULT NULL,
        customer_phone VARCHAR(32) DEFAULT NULL,
        device_brand VARCHAR(64) DEFAULT NULL,
        device_model VARCHAR(64) DEFAULT NULL,
        device_imei VARCHAR(32) DEFAULT NULL,
        fee_amount DECIMAL(15,2) NOT NULL,
        commission_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
        status ENUM('pending','completed','cancelled') DEFAULT 'pending',
        fee_transaction_id VARCHAR(36) DEFAULT NULL,
        commission_transaction_id VARCHAR(36) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `ALTER TABLE transactions MODIFY COLUMN type ENUM('marketplace_purchase','marketplace_sale','subscription','service_fee','recovery_service','device_check_fee','report_verification_fee','marketplace_commission','nin_verification_fee','device_recovery_fee','business_verification_fee','business_onboarding_commission') NOT NULL`,
    ],
    seed: async () => {
      const extras = [
        { key: 'business_onboarding_fee', value: '5000', description: 'Fee for business customer onboarding' },
        { key: 'business_onboarding_commission_percent', value: '30', description: 'Commission percent for business on each onboarding' },
      ];
      for (const s of extras) {
        const existing = await db.query('SELECT id FROM system_settings WHERE setting_key = ?', [s.key]);
        if (existing.length === 0) {
          await db.query(
            `INSERT INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
             VALUES (UUID(), ?, ?, 'string', ?, false)`,
            [s.key, s.value, s.description]
          );
        }
      }
    }
  },
  {
    name: '011_add_released_at_to_devices',
    sql: [
      `ALTER TABLE devices ADD COLUMN released_at TIMESTAMP NULL AFTER updated_at`,
    ],
  },
  {
    name: '012_create_email_verification_tokens',
    sql: [
      `CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
    ],
  },
];

async function runMigrations() {
  console.log('Running database migrations...');

  // Ensure migrations tracking table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const migration of MIGRATIONS) {
    try {
      // Check if already run
      const existing = await db.query('SELECT id FROM _migrations WHERE name = ?', [migration.name]);
      if (existing.length > 0) {
        continue;
      }

      console.log(`  Running migration: ${migration.name}...`);
      for (const sql of migration.sql) {
        try {
          await db.query(sql);
        } catch (err) {
          // Gracefully skip FK/syntax errors on CREATE/ALTER — MySQL 5.x may not support IF NOT EXISTS
          if (!err.message.includes('Duplicate column') && !err.message.includes('Duplicate key')) {
            console.warn(`    ⚠ SQL warning (non-fatal): ${err.message}`);
          }
        }
      }

      if (migration.seed) {
        await migration.seed();
      }

      await db.query('INSERT INTO _migrations (name) VALUES (?)', [migration.name]);
      console.log(`  ✓ ${migration.name} complete`);
    } catch (err) {
      console.error(`  ✗ Migration ${migration.name} failed:`, err.message);
    }
  }

  console.log('Migrations complete.');
}

module.exports = { runMigrations };
