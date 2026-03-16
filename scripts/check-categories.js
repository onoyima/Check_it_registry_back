// Simple script to print device categories from the database
const db = require('../config');

(async () => {
  try {
    console.log('✅ Checking device categories...');
    const rows = await db.query('SELECT * FROM device_categories');
    if (!rows || rows.length === 0) {
      console.log('⚠️  No categories found in device_categories table.');
    } else {
      console.log(`📚 Categories count: ${rows.length}`);
      for (const r of rows) {
        const label = r.label || r.name || r.title || 'Unknown';
        const key = r.category_key || r.key || 'n/a';
        console.log(`- ${label} (${key})`);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Error querying categories:', err.message || err);
    process.exit(1);
  } finally {
    try { await db.close(); } catch (e) {}
  }
})();