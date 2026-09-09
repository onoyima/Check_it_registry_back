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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
    seed: async () => {
      // Add FK gracefully — some MySQL versions reject if users(id) lacks unique key
      await db.query(
        'ALTER TABLE email_verification_tokens ADD CONSTRAINT email_verif_fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'
      ).catch(() => {});
    }
  },
  {
    name: '013_add_device_nin_verification_and_free_reports',
    sql: [
      `CREATE TABLE IF NOT EXISTS device_nin_verification (
        id VARCHAR(36) PRIMARY KEY,
        device_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        nin_number VARCHAR(11) NOT NULL,
        nin_verified TINYINT(1) DEFAULT 0,
        verified_at TIMESTAMP NULL,
        verification_provider VARCHAR(50) DEFAULT NULL,
        verification_response JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_device_nin_device ON device_nin_verification(device_id)`,
      `CREATE INDEX IF NOT EXISTS idx_device_nin_user ON device_nin_verification(user_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_device_nin_unique ON device_nin_verification(device_id, user_id)`,
    ],
    seed: async () => {
      await db.query(
        'ALTER TABLE device_nin_verification ADD CONSTRAINT dnin_fk_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE'
      ).catch(() => {});
      await db.query(
        'ALTER TABLE device_nin_verification ADD CONSTRAINT dnin_fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'
      ).catch(() => {});

      const existing = await db.query("SELECT id FROM system_settings WHERE setting_key = 'free_reports_per_device'");
      if (existing.length === 0) {
        await db.query(
          `INSERT INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
           VALUES (UUID(), 'free_reports_per_device', '3', 'number', 'Number of free reports per device before payment required', false)`
        );
      }

      const existingNinFee = await db.query("SELECT id FROM system_settings WHERE setting_key = 'nin_verification_per_device_fee'");
      if (existingNinFee.length === 0) {
        await db.query(
          `INSERT INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
           VALUES (UUID(), 'nin_verification_per_device_fee', '500', 'number', 'Fee for per-device NIN verification', false)`
        );
      }
    }
  },
  {
    name: '014_add_active_payment_provider_setting',
    sql: [],
    seed: async () => {
      const existing = await db.query("SELECT id FROM system_settings WHERE setting_key = 'active_payment_provider'");
      if (existing.length === 0) {
        await db.query(
          `INSERT INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
           VALUES (UUID(), 'active_payment_provider', 'paystack', 'string', 'Active payment provider: paystack or monify', false)`
        );
      }
    }
  },
  {
    name: '015_business_verification_system',
    sql: [
      // Business profiles table
      `CREATE TABLE IF NOT EXISTS business_profiles (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        business_name VARCHAR(255) NOT NULL,
        business_type VARCHAR(64) DEFAULT 'other',
        business_registration_number VARCHAR(100) NOT NULL,
        tax_id VARCHAR(50) DEFAULT NULL,
        business_address TEXT DEFAULT NULL,
        business_phone VARCHAR(20) DEFAULT NULL,
        business_email VARCHAR(255) DEFAULT NULL,
        website VARCHAR(255) DEFAULT NULL,
        state VARCHAR(100) DEFAULT NULL,
        city VARCHAR(100) DEFAULT NULL,
        country VARCHAR(100) DEFAULT NULL,
        business_license_url TEXT DEFAULT NULL,
        tax_certificate_url TEXT DEFAULT NULL,
        expected_device_volume VARCHAR(20) DEFAULT NULL,
        business_description TEXT DEFAULT NULL,
        sector VARCHAR(64) DEFAULT NULL,
        verification_status ENUM('pending','verified','rejected') DEFAULT 'pending',
        verified_at TIMESTAMP NULL,
        verified_by VARCHAR(36) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX bp_user_id (user_id),
        INDEX bp_verification_status (verification_status),
        INDEX bp_reg_number (business_registration_number)
      )`,
      // Immutable verification attempt history
      `CREATE TABLE IF NOT EXISTS business_verification_attempts (
        id VARCHAR(36) PRIMARY KEY,
        business_profile_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        rc_number VARCHAR(100) NOT NULL,
        company_name_submitted VARCHAR(255) DEFAULT NULL,
        fee_amount DECIMAL(15,2) NOT NULL,
        fee_transaction_id VARCHAR(36) DEFAULT NULL,
        payment_reference VARCHAR(128) DEFAULT NULL,
        provider VARCHAR(50) NOT NULL DEFAULT 'prembly',
        platform_data_snapshot JSON DEFAULT NULL,
        provider_data_snapshot JSON DEFAULT NULL,
        comparison_result JSON DEFAULT NULL,
        status ENUM('pending','passed','failed','error') NOT NULL DEFAULT 'pending',
        status_reason TEXT DEFAULT NULL,
        admin_notified TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX bva_profile_id (business_profile_id),
        INDEX bva_user_id (user_id),
        INDEX bva_status (status)
      )`,
      // Admin verification queue
      `CREATE TABLE IF NOT EXISTS admin_verification_queue (
        id VARCHAR(36) PRIMARY KEY,
        item_type ENUM('device','user','business','report') NOT NULL,
        item_id VARCHAR(36) NOT NULL,
        submitted_by VARCHAR(36) NOT NULL,
        assigned_to VARCHAR(36) DEFAULT NULL,
        priority ENUM('low','medium','high','urgent') DEFAULT 'medium',
        status ENUM('pending','in_review','approved','rejected','requires_info') DEFAULT 'pending',
        notes TEXT DEFAULT NULL,
        admin_notes TEXT DEFAULT NULL,
        verification_data JSON DEFAULT NULL,
        reviewed_at TIMESTAMP NULL,
        reviewed_by VARCHAR(36) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX avq_item_type_id (item_type, item_id),
        INDEX avq_status (status),
        INDEX avq_priority (priority)
      )`,
      // User payout columns
      `ALTER TABLE users ADD COLUMN payout_bank_name VARCHAR(100) DEFAULT NULL`,
      `ALTER TABLE users ADD COLUMN payout_account_number VARCHAR(20) DEFAULT NULL`,
      `ALTER TABLE users ADD COLUMN payout_account_name VARCHAR(255) DEFAULT NULL`,
      // Business fee settings
      `INSERT IGNORE INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
       VALUES (UUID(), 'business_verification_fee', '2500', 'number', 'Fee for CAC business verification', false)`,
      `INSERT IGNORE INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
       VALUES (UUID(), 'business_onboarding_fee', '5000', 'number', 'Fee for business customer onboarding', false)`,
      `INSERT IGNORE INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
       VALUES (UUID(), 'business_onboarding_commission_percent', '30', 'number', 'Commission percent for business on each onboarding', false)`,
    ],
    seed: async () => {
      // Add FK constraints gracefully
      await db.query('ALTER TABLE business_profiles ADD CONSTRAINT bp_fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE').catch(() => {});
      await db.query('ALTER TABLE business_verification_attempts ADD CONSTRAINT bva_fk_profile FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE CASCADE').catch(() => {});
      await db.query('ALTER TABLE business_verification_attempts ADD CONSTRAINT bva_fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE').catch(() => {});
      await db.query('ALTER TABLE admin_verification_queue ADD CONSTRAINT avq_fk_submitted FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE').catch(() => {});

      console.log('  ✓ Business verification system tables created');
    }
  },
  {
    name: '016_archive_softdelete_security_questions',
    sql: [
      // Add soft-delete columns to users
      `ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE users ADD COLUMN deletion_reason TEXT DEFAULT NULL`,
      `ALTER TABLE users ADD COLUMN original_email VARCHAR(255) DEFAULT NULL`,
      // Add soft-delete columns to devices
      `ALTER TABLE devices ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE devices ADD COLUMN deletion_reason TEXT DEFAULT NULL`,
      `ALTER TABLE devices ADD COLUMN original_imei VARCHAR(15) DEFAULT NULL`,
      `ALTER TABLE devices ADD COLUMN original_serial VARCHAR(100) DEFAULT NULL`,
      // Security questions table
      `CREATE TABLE IF NOT EXISTS security_questions (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        question TEXT NOT NULL,
        answer_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX sq_user (user_id)
      )`,
      // Account deletions archive table
      `CREATE TABLE IF NOT EXISTS account_deletions (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        original_email VARCHAR(255) NOT NULL,
        original_name VARCHAR(255),
        role VARCHAR(20),
        deletion_reason TEXT,
        security_question_verified TINYINT(1) DEFAULT 0,
        otp_verified TINYINT(1) DEFAULT 0,
        final_confirmation TINYINT(1) DEFAULT 0,
        device_count INT DEFAULT 0,
        report_count INT DEFAULT 0,
        transfer_count INT DEFAULT 0,
        transaction_count INT DEFAULT 0,
        snapshot JSON,
        deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        restored_at TIMESTAMP NULL DEFAULT NULL,
        restored_by VARCHAR(36) DEFAULT NULL,
        status ENUM('deleted','restored') DEFAULT 'deleted',
        INDEX ad_user (user_id),
        INDEX ad_status (status),
        INDEX ad_deleted_at (deleted_at)
      )`,
      // Device deletions archive table
      `CREATE TABLE IF NOT EXISTS device_deletions (
        id VARCHAR(36) PRIMARY KEY,
        device_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        original_imei VARCHAR(15),
        original_serial VARCHAR(100),
        brand VARCHAR(100),
        model VARCHAR(100),
        category VARCHAR(50),
        status_before_delete VARCHAR(30),
        deletion_reason TEXT,
        report_count INT DEFAULT 0,
        transfer_count INT DEFAULT 0,
        snapshot JSON,
        deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        restored_at TIMESTAMP NULL DEFAULT NULL,
        restored_by VARCHAR(36) DEFAULT NULL,
        status ENUM('deleted','restored') DEFAULT 'deleted',
        INDEX dd_user (user_id),
        INDEX dd_device (device_id),
        INDEX dd_status (status)
      )`,
      // Data export audit table
      `CREATE TABLE IF NOT EXISTS data_export_audit (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        export_type VARCHAR(50) NOT NULL,
        status ENUM('requested','processing','completed','failed') DEFAULT 'requested',
        file_path VARCHAR(500),
        file_size BIGINT DEFAULT 0,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL DEFAULT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        INDEX dea_user (user_id),
        INDEX dea_status (status)
      )`,
      // Device ownership history table
      `CREATE TABLE IF NOT EXISTS device_ownership_history (
        id VARCHAR(36) PRIMARY KEY,
        device_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        action ENUM('registered','transferred_in','transferred_out','deleted','restored') NOT NULL,
        transfer_id VARCHAR(36) DEFAULT NULL,
        metadata JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX doh_device (device_id),
        INDEX doh_user (user_id)
      )`,
    ],
    seed: async () => {
      // Add FK constraints gracefully
      await db.query('ALTER TABLE security_questions ADD CONSTRAINT sq_fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE').catch(() => {});
      await db.query('ALTER TABLE account_deletions ADD CONSTRAINT ad_fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL').catch(() => {});
      await db.query('ALTER TABLE device_deletions ADD CONSTRAINT dd_fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL').catch(() => {});
      await db.query('ALTER TABLE data_export_audit ADD CONSTRAINT dea_fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE').catch(() => {});
      await db.query('ALTER TABLE device_ownership_history ADD CONSTRAINT doh_fk_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE').catch(() => {});
      await db.query('ALTER TABLE device_ownership_history ADD CONSTRAINT doh_fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL').catch(() => {});
      // Seed default security questions in system_settings
      const defaultQuestions = JSON.stringify([
        "What was the name of your first pet?",
        "What city were you born in?",
        "What is your mother's maiden name?",
        "What was the make of your first car?",
        "What was the name of your primary school?",
        "What is your favorite movie?",
        "What is the name of your best friend?",
        "What was your childhood nickname?"
      ]);
      await db.query(`INSERT IGNORE INTO system_settings (id, setting_key, setting_value, setting_type, description, is_public)
        VALUES (UUID(), 'security_questions', ?, 'json', 'Available security questions for account deletion', false)`, [defaultQuestions]);
      console.log('  ✓ Archive, soft-delete, security questions, and ownership history tables created');
    }
  },
  {
    // R2 fix — backfill split first/middle/last name fields from the legacy single 'name'
    // column for rows that only have the legacy name populated. This keeps the two data
    // models consistent so display-name helpers work everywhere.
    name: '017_backfill_split_name_fields',
    sql: [],
    seed: async () => {
      const rows = await db.query(
        "SELECT id, name, first_name, middle_name, last_name FROM users WHERE (first_name IS NULL OR first_name = '') AND (name IS NOT NULL AND name <> '')"
      );
      let updated = 0;
      for (const row of rows) {
        const parts = (row.name || '').trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) continue;
        const first = parts[0];
        let middle = null;
        let last = null;
        if (parts.length === 2) {
          last = parts[1];
        } else if (parts.length >= 3) {
          middle = parts.slice(1, -1).join(' ');
          last = parts[parts.length - 1];
        }
        await db.query(
          'UPDATE users SET first_name = ?, middle_name = ?, last_name = ? WHERE id = ?',
          [first, middle, last, row.id]
        );
        updated++;
      }
      console.log(`  ✓ Name backfill complete: ${updated} user(s) updated`);
    }
  },
  {
    // R3 fix — make soft-deleted / orphaned foreign-key references safe. Rather than
    // dropping rows, we ensure indexes exist that the audit/cleanup jobs and queries
    // rely on, and index the commonly-joined columns to avoid slow full scans on joins.
    name: '018_orphan_safety_indexes',
    // NOTE: MySQL does NOT support "CREATE INDEX IF NOT EXISTS" (MariaDB only),
    // so we check information_schema.statistics first and create each index only
    // if missing. This is registered as a seed (not sql) so each statement is
    // guarded and the whole migration is idempotent.
    sql: [],
    seed: async () => {
      // NOTE: verify actual column names — the live schema uses `reporter_id`
      // on reports and `from_user_id`/`to_user_id` on device_transfers (not
      // user_id / buyer_id / seller_id). Migration 007 already added composite
      // indexes whose leading columns cover most FK joins; the entries below
      // that are NOT redundant with 007 are reports(assigned_lea_id) and
      // device_transfers(device_id). Each is created only if the exact index
      // name is absent and the column exists, so this is idempotent on any DB.
      const toCreate = [
        ['reports', 'assigned_lea_id', 'idx_reports_assigned_lea'],
        ['device_transfers', 'device_id', 'idx_transfer_device'],
        ['devices', 'user_id', 'idx_devices_user_id'],
        ['reports', 'reporter_id', 'idx_reports_reporter'],
        ['reports', 'device_id', 'idx_reports_device_id'],
        ['device_transfers', 'from_user_id', 'idx_transfer_from_user'],
        ['device_transfers', 'to_user_id', 'idx_transfer_to_user'],
        ['notifications', 'user_id', 'idx_notifications_user'],
      ];
      for (const [table, column, indexName] of toCreate) {
        try {
          const existing = await db.query(
            'SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
            [table, indexName]
          );
          if (existing[0].c > 0) {
            continue; // already present
          }
          const canIndex = await db.query(
            'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
            [table, column]
          );
          if (canIndex[0].c === 0) {
            console.warn(`  ⚠ Cannot index ${table}.${column} — column does not exist (skipping)`);
            continue;
          }
          await db.query(`CREATE INDEX ${indexName} ON ${table} (${column})`);
          console.log(`  ✓ index ${indexName} created on ${table}(${column})`);
        } catch (err) {
          console.error(`  ✗ Failed to create index ${indexName} on ${table}:`, err.message);
        }
      }
    },
  },
  {
    // PII-at-rest support — adds deterministic SHA-256 lookup columns so identity
    // lookups (login, dedupe, transfers, reset-password) keep working after
    // users.email / users.phone are stored encrypted. Runs before encryption is
    // applied, so the plaintext backfill below computes hashes of readable values.
    // Re-runs against an already-encrypted DB are safe: hashes are only written
    // where still NULL (encryption sets them explicitly).
    name: '019_pii_lookup_hash_columns',
    sql: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hash CHAR(64) NULL`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash CHAR(64) NULL`,
      `CREATE INDEX IF NOT EXISTS idx_users_email_hash ON users (email_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_users_phone_hash ON users (phone_hash)`,
    ],
    seed: async () => {
      // This MySQL does not support "IF NOT EXISTS" on ALTER/CREATE INDEX, so guard
      // each column/index with information_schema lookups and skip what exists.
      const hasColumn = async (column) => {
        const res = await db.query(
          'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
          ['users', column]
        );
        return res[0].c > 0;
      };
      const addColumn = async (column, definition) => {
        if (await hasColumn(column)) return false;
        await db.query(`ALTER TABLE users ADD COLUMN ${definition}`);
        return true;
      };
      const addIndex = async (indexName, column) => {
        if (!(await hasColumn(column))) return false;
        const res = await db.query(
          'SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
          ['users', indexName]
        );
        if (res[0].c > 0) return false;
        await db.query(`CREATE INDEX ${indexName} ON users (${column})`);
        return true;
      };

      if (await addColumn('email_hash', 'email_hash CHAR(64) NULL')) console.log('  ✓ users.email_hash added');
      if (await addColumn('phone_hash', 'phone_hash CHAR(64) NULL')) console.log('  ✓ users.phone_hash added');
      if (await addIndex('idx_users_email_hash', 'email_hash')) console.log('  ✓ idx_users_email_hash created');
      if (await addIndex('idx_users_phone_hash', 'phone_hash')) console.log('  ✓ idx_users_phone_hash created');

      // Backfill hashes from the still-plaintext columns (runs before encryption).
      const result = await db.query(
        `UPDATE users SET
           email_hash = COALESCE(email_hash, SHA2(LOWER(TRIM(email)), 256))
         WHERE email_hash IS NULL AND email IS NOT NULL AND email <> ''`
      );
      await db.query(
        `UPDATE users SET
           phone_hash = COALESCE(phone_hash, SHA2(TRIM(phone), 256))
         WHERE phone_hash IS NULL AND phone IS NOT NULL AND phone <> ''`
      );
      console.log(`  ✓ hash backfill complete (${JSON.stringify(result[0])})`);
    },
  },
  {
    // Deleted-account PII at rest: users.original_email (set only for deleted
    // accounts) is encrypted like email, so admin restore/listing needed a
    // lookup hash too. The hash backfill only touches still-plaintext values —
    // already-encrypted blobs (newer deletions) are skipped so a hash of the
    // ciphertext is never stored.
    name: '020_pii_deletion_fields',
    sql: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS original_email_hash CHAR(64) NULL`,
      `CREATE INDEX IF NOT EXISTS idx_users_original_email_hash ON users (original_email_hash)`,
    ],
    seed: async () => {
      const hasColumn = async (column) => {
        const res = await db.query(
          'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
          ['users', column]
        );
        return res[0].c > 0;
      };
      const addColumn = async (column, definition) => {
        if (await hasColumn(column)) return false;
        await db.query(`ALTER TABLE users ADD COLUMN ${definition}`);
        return true;
      };
      const addIndex = async (indexName, column) => {
        if (!(await hasColumn(column))) return false;
        const res = await db.query(
          'SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
          ['users', indexName]
        );
        if (res[0].c > 0) return false;
        await db.query(`CREATE INDEX ${indexName} ON users (${column})`);
        return true;
      };

      if (await addColumn('original_email_hash', 'original_email_hash CHAR(64) NULL')) console.log('  ✓ users.original_email_hash added');
      if (await addIndex('idx_users_original_email_hash', 'original_email_hash')) console.log('  ✓ idx_users_original_email_hash created');

      const result = await db.query(
        `UPDATE users SET
           original_email_hash = COALESCE(original_email_hash, SHA2(LOWER(TRIM(original_email)), 256))
         WHERE original_email_hash IS NULL
           AND original_email IS NOT NULL AND original_email <> ''
           AND original_email NOT REGEXP '^[0-9a-f]{32}:[0-9a-f]+$'`
      );
      console.log(`  ✓ original_email hash backfill complete (${JSON.stringify(result[0])})`);
    },
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
