const db = require('./config');
(async () => {
  try {
    console.log('Trying to create _migrations table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('_migrations table created successfully');
  } catch(e) {
    console.log('FAILED:', e.message);
  }
  process.exit();
})();
