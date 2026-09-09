// Jest setupFiles preflight: decides ONCE whether a test database is reachable and
// records the result on global.__DB_OK__ BEFORE test modules are loaded, so each
// DB-backed suite can synchronously choose describe vs describe.skip.
const mysql = require('mysql2/promise');

const cfg = {
  host: process.env.TEST_DB_HOST || process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.TEST_DB_PORT || process.env.DB_PORT || 3306, 10),
  user: process.env.TEST_DB_USER || process.env.DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.TEST_DB_NAME || 'check_it_registry_test',
};

(async () => {
  try {
    const conn = await mysql.createConnection({ ...cfg, connectTimeout: 5000 });
    await conn.query('SELECT 1');
    await conn.end();
    global.__DB_OK__ = true;
    console.log(`[tests] DB-backed suites ENABLED → ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);
  } catch (error) {
    global.__DB_OK__ = false;
    console.warn(
      `[tests] No test database reachable (${error.code || error.message}). DB-backed suites will SKIP. ` +
      `Provision one with \`docker compose --profile test up -d mysql\` (local MySQL on 127.0.0.1:3307) ` +
      `or set TEST_DB_HOST/TEST_DB_PORT/TEST_DB_USER/TEST_DB_PASSWORD/TEST_DB_NAME.`
    );
  }
})();