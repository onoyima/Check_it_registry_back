#!/usr/bin/env node
// Repairs the one corrupt kyc_verifications.nin value (732be63f-44d3-40c6-a95f-7275aaa75ec0)
// whose ciphertext cannot be decrypted with the current KYC_ENCRYPTION_KEY.
// The row's verification_response blob still holds the originally submitted NIN in
// plaintext JSON, so we re-encrypt that same value with the current key. Non-destructive.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Database = require('../config');
const PIIEncryptionService = require('../services/PIIEncryptionService');

const KYC_ROW_ID = '732be63f-44d3-40c6-a95f-7275aaa75ec0';

async function run() {
  const rows = await Database.query('SELECT * FROM kyc_verifications WHERE id = ?', [KYC_ROW_ID]);
  if (!rows.length) {
    console.log('KYC row not found — already handled?');
    return;
  }
  const row = rows[0];

  let plaintextNin = null;
  try {
    const response = typeof row.verification_response === 'string' ? JSON.parse(row.verification_response) : row.verification_response;
    plaintextNin = response && response.nin ? String(response.nin) : null;
  } catch (e) {
    console.error('Could not parse verification_response:', e.message);
  }
  if (!plaintextNin) {
    console.error('Plaintext NIN not recoverable from verification_response — manual re-KYC required.');
    process.exit(2);
  }

  // Verify the stored ciphertext is indeed broken with the current key.
  const oldDecrypt = PIIEncryptionService.isEncrypted(row.nin) ? PIIEncryptionService.decrypt(row.nin) : row.nin;

  const newCipher = PIIEncryptionService.encrypt(plaintextNin);
  const roundTrip = PIIEncryptionService.decrypt(newCipher);
  if (roundTrip !== plaintextNin) {
    console.error('Encryption round-trip failed — aborting.');
    process.exit(3);
  }

  await Database.query('UPDATE kyc_verifications SET nin = ?, updated_at = NOW() WHERE id = ?', [newCipher, KYC_ROW_ID]);

  console.log(JSON.stringify({
    kyc_id: KYC_ROW_ID,
    user_id: row.user_id,
    previous_nin_was_decryptable: oldDecrypt !== null,
    recovered_plaintext_nin: plaintextNin,
    re_encrypted: true,
    new_nin_ciphertext: newCipher
  }, null, 2));
  await Database.close();
}

run().catch((e) => { console.error(e); process.exit(1); });