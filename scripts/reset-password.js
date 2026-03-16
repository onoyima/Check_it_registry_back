#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Database = require('../config');

async function run() {
  const emailArg = process.argv[2];
  const passwordArg = process.argv[3];
  
  if (!emailArg || !passwordArg) {
    console.log('Usage: node scripts/reset-password.js <email> <new_password>');
    process.exit(0);
  }

  const email = emailArg.toLowerCase().trim();
  const newPassword = passwordArg;

  try {
    // Check if user exists
    const user = await Database.selectOne(
      'users',
      'id, name, email',
      'email = ?',
      [email]
    );
    
    if (!user) {
      console.log(`❌ No user found for email: ${email}`);
      process.exit(1);
    }

    // Hash the new password
    const passwordHash = await Database.hashPassword(newPassword);

    // Update the password
    await Database.update('users', {
      password_hash: passwordHash,
      updated_at: new Date()
    }, 'id = ?', [user.id]);

    console.log(`✅ Password reset successfully for ${user.name} (${user.email})`);
    console.log(`🔑 New password: ${newPassword}`);

  } catch (err) {
    console.error('❌ Error resetting password:', err.message);
    process.exitCode = 1;
  } finally {
    await Database.close();
  }
}

run();