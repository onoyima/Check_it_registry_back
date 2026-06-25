const db = require('./config');
(async () => {
  try {
    const r = await db.query('SELECT COUNT(*) as c FROM _migrations');
    console.log('_migrations has', r[0].c, 'rows');
    const rows = await db.query('SELECT * FROM _migrations');
    rows.forEach(r => console.log(' -', r.name, r.run_at));
  } catch(e) {
    console.log('_migrations table MISSING');
  }
  try {
    const r = await db.query('SHOW TABLES LIKE "seller_bank_accounts"');
    console.log('seller_bank_accounts:', r.length > 0 ? 'EXISTS' : 'MISSING');
  } catch(e) {
    console.log('seller_bank_accounts: ERROR');
  }
  process.exit();
})();
