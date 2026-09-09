// R1: Encrypted-data re-encryption migration.
//
// Ensures every stored encrypted value (users PII fields and NIN rows) is
// decryptable with the CURRENT key derivation (sha256(KYC_ENCRYPTION_KEY)).
//
// Background: older rows may have been encrypted under a *legacy* key scheme
// (raw key bytes / different derivation). Those rows would fail to decrypt
// with the unified pipeline (PIIEncryptionService.getKey()), which surfaced as
// a data-integrity risk. This script:
//   1. reads each candidate encrypted value,
//   2. tries current-scheme decryption first,
//   3. falls back to legacy-scheme decryption,
//   4. re-encrypts with the current scheme and writes it back,
// so every stored ciphertext is consistent with the pipeline going forward.
//
// Usage:
//   node scripts/migrate-encryption-key.js            # real run
//   node scripts/migrate-encryption-key.js --dry-run  # report only, no writes

require('dotenv').config();
const crypto = require('crypto');
const Database = require('../config');

const ALG = 'aes-256-cbc';
const IV_LENGTH = 16;
const keySource = process.env.KYC_ENCRYPTION_KEY;
if (!keySource || keySource.length < 32) {
  console.error('KYC_ENCRYPTION_KEY is required (min 32 chars). Aborting.');
  process.exit(1);
}

// CURRENT key: sha256-derived, matches PIIEncryptionService.getKey()
const currentKey = crypto.createHash('sha256').update(keySource).digest();

// LEGACY key candidates, older derivation schemes that may have been used.
// Try the raw (>=32 byte) source as a 32-byte buffer, and a raw fallback.
const legacyKeys = [];
const rawBuf = Buffer.from(keySource, 'utf8');
if (rawBuf.length >= 32) {
  legacyKeys.push(rawBuf.subarray(0, 32));
}

function decryptWithKey(value, key) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length !== 2) return null;
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    if (iv.length !== IV_LENGTH) return null;
    const decipher = crypto.createDecipheriv(ALG, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (_) {
    return null;
  }
}

function decryptBestEffort(value) {
  const current = decryptWithKey(value, currentKey);
  if (current !== null) return { plain: current, kind: 'current' };
  for (const key of legacyKeys) {
    const legacy = decryptWithKey(value, key);
    if (legacy !== null) return { plain: legacy, kind: 'legacy' };
  }
  return null;
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALG, currentKey, iv);
  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function isEncrypted(value) {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 2 && /^[0-9a-f]{32}$/.test(parts[0]) && /^[0-9a-f]+$/.test(parts[1]);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? 'DRY RUN — no writes will be performed.' : 'REAL RUN — will write re-encrypted values.');

  const stats = { scanned: 0, migrated: 0, legacyFound: 0, unchanged: 0, corrupt: 0 };

  // 1) users PII fields
  const users = await Database.select('users', 'id, email, phone, name');
  stats.scanned += users.length;
  for (const u of users) {
    const updates = {};
    for (const field of ['email', 'phone', 'name']) {
      const val = u[field];
      if (!isEncrypted(val)) continue;
      const result = decryptBestEffort(val);
      if (result === null) {
        // Could not decrypt with any known scheme -> corrupt or unknown key
        stats.corrupt++;
        console.warn('  [corrupt] users.' + field + ' id=' + u.id);
        continue;
      }
      if (result.kind === 'legacy') stats.legacyFound++;
      const re = encrypt(result.plain);
      if (re !== val) {
        updates[field] = re;
        stats.migrated++;
      } else {
        stats.unchanged++;
      }
    }
    if (Object.keys(updates).length > 0 && !dryRun) {
      await Database.update('users', { ...updates, updated_at: new Date() }, 'id = ?', [u.id]);
    }
  }

  // 2) kyc_verifications.nin (may be encrypted for some rows)
  let kvTable = true;
  let kvs = [];
  try {
    kvs = await Database.select('kyc_verifications', 'id, nin');
    stats.scanned += kvs.length;
  } catch (e) {
    kvTable = false;
    console.warn('  kyc_verifications table not available, skipping: ' + e.message);
  }
  if (kvTable) {
    for (const row of kvs) {
      const val = row.nin;
      if (!isEncrypted(val)) continue;
      const result = decryptBestEffort(val);
      if (result === null) {
        stats.corrupt++;
        console.warn('  [corrupt] kyc_verifications.nin id=' + row.id);
        continue;
      }
      if (result.kind === 'legacy') stats.legacyFound++;
      const re = encrypt(result.plain);
      if (re !== val) {
        if (!dryRun) {
          await Database.update('kyc_verifications', { nin: re, updated_at: new Date() }, 'id = ?', [row.id]);
        }
        stats.migrated++;
      } else {
        stats.unchanged++;
      }
    }
  }

  console.log('\nEncryption migration summary:');
  console.table(stats);
  if (stats.corrupt > 0) {
    console.warn('WARNING: ' + stats.corrupt + ' value(s) could not be decrypted with any known key. These were left untouched; review them manually.');
  }
  if (!dryRun) {
    console.log('Done. Re-run with --dry-run after changing KYC_ENCRYPTION_KEY to verify consistency.');
  }

  // Close the DB pool so the process can exit (pool keepAlive otherwise holds
  // the event loop open).
  await Database.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
