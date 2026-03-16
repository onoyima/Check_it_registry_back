#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const Database = require('../config');

async function run() {
  try {
    const rows = await Database.query('SELECT COUNT(*) AS count FROM users');
    const count = rows[0]?.count ?? 0;
    console.log(`📊 Users in database: ${count}`);
  } catch (err) {
    console.error('❌ Error counting users:', err.message);
    process.exitCode = 1;
  } finally {
    await Database.close();
  }
}

run();