// One-off remediation for deleted-account PII that predates the encryption hooks:
//  1. users.original_email        → encrypted at rest + original_email_hash set
//  2. account_deletions.original_email → encrypted at rest (restore still works)
//  3. account_deletions.snapshot  → sensitive fields stripped from the JSON blob
//  4. device_archives.snapshot    → sensitive fields stripped from the JSON blob
//
// Reads go through a RAW connection (NOT Database.query) so already-encrypted
// values are never decrypted back to plaintext and re-encrypted (double-encrypt).
// Safe to run multiple times (idempotent). Run AFTER deploying the
// config.js/PIIEncryptionService changes so the write-hooks are active:
//
//   node scripts/encrypt-deletion-pii.js

require('dotenv').config();
const mysql = require('mysql2/promise');
const Database = require('../config');
const PIIEncryptionService = require('../services/PIIEncryptionService');

const isEncrypted = (v) => PIIEncryptionService.isEncrypted(v);

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
  });
  const raw = async (sql, params = []) => (await conn.query(sql, params))[0];

  // 1. users.original_email (only set on deleted accounts)
  const userRows = await raw(
    'SELECT id, original_email FROM users WHERE deleted_at IS NOT NULL AND original_email IS NOT NULL'
  );
  let uDone = 0, uSkip = 0;
  for (const r of userRows) {
    if (isEncrypted(r.original_email)) { uSkip++; continue; }
    // Write-hook encrypts original_email and attaches original_email_hash.
    await Database.update('users', { original_email: r.original_email, updated_at: new Date() }, 'id = ?', [r.id]);
    uDone++;
  }
  console.log(`users.original_email encrypted: ${uDone}, already-encrypted skipped: ${uSkip}`);

  // 2. account_deletions.original_email (restore reads it back via the decrypt
  //    read-hook, so it can be encrypted here safely).
  const archiveRows = await raw(
    'SELECT id, original_email FROM account_deletions WHERE original_email IS NOT NULL'
  );
  let aDone = 0, aSkip = 0;
  for (const r of archiveRows) {
    if (isEncrypted(r.original_email)) { aSkip++; continue; }
    await Database.update('account_deletions', { original_email: r.original_email }, 'id = ?', [r.id]);
    aDone++;
  }
  console.log(`account_deletions.original_email encrypted: ${aDone}, already-encrypted skipped: ${aSkip}`);

  // 3 + 4. redact JSON snapshots (parsed with a guard; unparseable rows left as-is)
  for (const table of ['account_deletions', 'device_archives']) {
    const rows = await raw(`SELECT id, snapshot FROM ${table} WHERE snapshot IS NOT NULL`);
    let done = 0, skip = 0;
    for (const r of rows) {
      if (typeof r.snapshot !== 'string') { skip++; continue; }
      let parsed;
      try { parsed = JSON.parse(r.snapshot); } catch { skip++; continue; }
      const redacted = JSON.stringify(PIIEncryptionService.redactSnapshot(parsed));
      if (redacted === r.snapshot) { skip++; continue; }
      await Database.update(table, { snapshot: redacted }, 'id = ?', [r.id]);
      done++;
    }
    console.log(`${table}.snapshot redacted: ${done}, already-clean/untouched skipped: ${skip}`);
  }

  await conn.end();
  console.log('Done.');
}

main()
  .then(() => Database.close())
  .catch(async (e) => {
    console.error('Failed:', e.message);
    await Database.close();
    process.exit(1);
  });