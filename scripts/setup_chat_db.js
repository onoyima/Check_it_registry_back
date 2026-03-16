const Database = require('../config');

(async () => {
    try {
        console.log('Setting up Marketplace Chat table...');
        await Database.query(`
            CREATE TABLE IF NOT EXISTS marketplace_messages (
                id VARCHAR(36) PRIMARY KEY,
                listing_id VARCHAR(36) NOT NULL,
                sender_id VARCHAR(36) NOT NULL,
                receiver_id VARCHAR(36) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                read_at TIMESTAMP NULL
            )
        `);
        // Foreign key might fail if marketplace_listings doesn't exist or type mismatch, so I omitted it for safety in this script.
        // But ideally: FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE
        
        console.log('✅ Chat table created');
        process.exit(0);
    } catch (err) {
        console.error('❌ Failed to create chat table:', err);
        process.exit(1);
    }
})();
