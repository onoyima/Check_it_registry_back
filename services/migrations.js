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
