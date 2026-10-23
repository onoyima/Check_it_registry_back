// Runs once before all system tests:
//  1. drops and re-creates the test database from tests/fixtures/schema.sql
//  2. runs every migration exactly like the server does on startup
//  3. creates one account per role through the real API and saves tokens
const fs = require('fs');
const { STATE_FILE, FIXTURE_SCHEMA } = require('./env');
const mysql = require('mysql2/promise');

// Split a mysqldump file into statements, honouring DELIMITER changes
// (used by the trigger definitions) and dropping DEFINER clauses.
function splitSql(text) {
  const out = [];
  let delim = ';';
  let buf = '';
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\/\*!50017 DEFINER=[^*]*\*\/ ?/g, '');
    const m = line.match(/^DELIMITER\s+(\S+)/);
    if (m) { delim = m[1]; continue; }
    if (!buf && (line.startsWith('--') || !line.trim())) continue;
    buf += line + '\n';
    if (line.trimEnd().endsWith(delim)) {
      const stmt = buf.trimEnd().slice(0, -delim.length).trim();
      if (stmt) out.push(stmt);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

module.exports = async () => {
  const name = process.env.TEST_DB_NAME;
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', multipleStatements: true,
  });
  await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
  await conn.query(`USE \`${name}\``);
  for (const stmt of splitSql(fs.readFileSync(FIXTURE_SCHEMA, 'utf8'))) await conn.query(stmt);
  await conn.end();

  const { runMigrations } = require('../../services/migrations');
  // Keep the output readable: migration progress is printed by the server
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = () => {};
  try { await runMigrations(); } finally { [console.log, console.warn, console.error] = saved; }

  // A police agency for the test region (admins set these up in real use)
  const Database = require('../../config');
  await Database.query("INSERT INTO law_enforcement_agencies (id, agency_name, contact_email, region, active) VALUES (UUID(), 'Lagos State Police Command', 'police@test.proveownership.local', 'Lagos', 1)");
  const h = require('./helpers');
  const state = { users: {} };
  for (const role of ['user', 'user2', 'business', 'admin', 'lea']) {
    state.users[role] = await h.createAccount(role);
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  await (Database.pool?.end?.() || Promise.resolve()).catch(() => {});
};
