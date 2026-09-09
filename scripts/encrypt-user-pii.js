#!/usr/bin/env node
// Encrypt users.email / users.phone at rest (production PII migration) and ensure
// email_hash / phone_hash are populated for hash-based identity lookups.
// Run AFTER migration 019 has been applied. Idempotent.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Database = require('../config');
const PIIEncryptionService = require('../services/PIIEncryptionService');

async function run() {
  const users = await Database.select('users', 'id, email, phone');
  console.log(`Processing ${users.length} user(s)...`);

  let encrypted = 0;
  let skipped = 0;
  for (const user of users) {
    try {
      const fields = {};
      if (typeof user.email === 'string' && user.email.length) fields.email = user.email;
      if (typeof user.phone === 'string' && user.phone.length) fields.phone = user.phone;
      if (fields.email || fields.phone) {
        // In production this goes through the write-hook that encrypts and sets
        // the lookup hash. Pass the plaintext values; the hook does the rest.
        await Database.update('users', { ...fields, updated_at: new Date() }, 'id = ?', [user.id]);
        encrypted++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.error(`Failed for user ${user.id}:`, e.message);
      skipped++;
    }
  }

  // Report: re-read two rows to confirm encryption applied
  const sample = await Database.select('users', 'id, email, phone, email_hash, phone_hash', '', '', '', '3');
  console.log('Sample rows (ciphertext + hashes):');
  for (const s of sample) {
    console.log(JSON.stringify({
      id: s.id,
      email_encrypted: PIIEncryptionService.isEncrypted(s.email),
      phone_encrypted: PIIEncryptionService.isEncrypted(s.phone),
      email_hash: s.email_hash,
      phone_hash: s.phone_hash
    }));
  }
  console.log(`Encrypted: ${encrypted}, skipped: ${skipped}`);
  await Database.close();
}

run().catch((e) => { console.error(e); process.exit(1); });