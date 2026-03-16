const Database = require('../config');

(async () => {
    try {
        console.log('Adding admin columns to Marketplace Listings table...');
        try {
            await Database.query(`
                ALTER TABLE marketplace_listings 
                ADD COLUMN featured BOOLEAN DEFAULT FALSE
            `);
            console.log('✅ Added featured column');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log('⚠️ featured column already exists');
            } else {
                throw err;
            }
        }

        // We can reuse 'status' for 'blocked' or add 'admin_status'.
        // For now, assume expanding status enum or check constraints on ENUM is handled by MySQL automatically if it's VARCHAR.
        // Assuming status is VARCHAR(20) or similar, we can accept 'blocked'.
        
        process.exit(0);
    } catch (err) {
        console.error('❌ Failed to update table:', err);
        process.exit(1);
    }
})();
