#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Database = require('../config');

async function run() {
  const emailArg = process.argv[2];
  if (!emailArg) {
    console.log('Usage: node scripts/check-user.js <email>');
    process.exit(0);
  }

  const email = emailArg.toLowerCase().trim();

  try {
    const user = await Database.selectOne(
      'users',
      'id, name, email, role, created_at',
      'email = ?',
      [email]
    );
    if (!user) {
      console.log(`🔎 No user found for email: ${email}`);
    } else {
      console.log('✅ User found:', user);
    }
  } catch (err) {
    console.error('❌ Error checking user:', err.message);
    process.exitCode = 1;
  } finally {
    await Database.close();
  }
}

run();