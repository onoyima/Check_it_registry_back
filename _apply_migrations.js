const db = require('./config');
const { runMigrations } = require('./services/migrations');

(async () => {
  try {
    // Ensure _migrations table exists (re-create if needed)
    await db.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ _migrations table ready');

    // Check what's already recorded
    const done = await db.query('SELECT name FROM _migrations');
    const doneNames = done.map(r => r.name);
    console.log('Already applied:', doneNames.length ? doneNames.join(', ') : 'none');

    // Run the migration system
    await runMigrations();

    // Verify
    const final = await db.query('SELECT name FROM _migrations');
    console.log('Now applied:', final.map(r => r.name).join(', '));
  } catch (e) {
    console.error('ERROR:', e.message);
  }
  process.exit();
})();
