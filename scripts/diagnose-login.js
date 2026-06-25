#!/usr/bin/env node
const Database = require('../config');

async function run() {
  try {
    const userId = '9fcb77ae-4585-4f62-b01d-11979c33f6a7';
    const email = 'clintonfaze@gmail.com';

    // 1. User details
    console.log('=== USER INFO ===');
    const user = await Database.selectOne('users', '*', 'email = ?', [email]);
    if (user) {
      console.log('ID:', user.id);
      console.log('Name:', user.name);
      console.log('Email:', user.email);
      console.log('Role:', user.role);
      console.log('Login count:', user.login_count);
      console.log('2FA enabled:', user.two_factor_enabled);
      console.log('Verified at:', user.verified_at);
      console.log('KYC status:', user.kyc_status);
      console.log('Is verified:', user.is_verified);
      console.log('Password hash prefix:', user.password_hash ? user.password_hash.substring(0, 30) : 'MISSING');
    } else {
      console.log('USER NOT FOUND');
    }

    // 2. OTP table
    console.log('\n=== OTPS TABLE ===');
    try {
      const otpCount = await Database.queryOne('SELECT COUNT(*) as cnt FROM otps WHERE user_id = ?', [userId]);
      console.log('OTP count:', otpCount?.cnt || 0);
      const otpRows = await Database.query('SELECT id, user_id, otp_code, otp_type, reference_id, expires_at, used_at, attempts FROM otps WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [userId]);
      console.log('Recent OTPs:', JSON.stringify(otpRows, null, 2));
    } catch(e) {
      console.error('OTP query failed:', e.message);
    }

    // 3. Trusted sessions
    console.log('\n=== TRUSTED SESSIONS ===');
    try {
      const trusted = await Database.query('SELECT id, user_id, device_fingerprint, is_trusted, is_active, last_activity, expires_at FROM user_sessions WHERE user_id = ? AND is_trusted = 1', [userId]);
      console.log('Trusted sessions:', JSON.stringify(trusted, null, 2));
      if (trusted.length > 0) {
        const session = trusted[0];
        const now = new Date();
        const lastActivity = new Date(session.last_activity);
        const trustDays = parseInt(process.env.TRUSTED_DEVICE_DAYS || '30');
        const cutoffDate = new Date(now - trustDays * 24 * 60 * 60 * 1000);
        console.log('Current time:', now.toISOString());
        console.log('Last activity:', lastActivity.toISOString());
        console.log('Trust days:', trustDays);
        console.log('Cutoff date:', cutoffDate.toISOString());
        console.log('Is within trust window:', lastActivity >= cutoffDate);
        console.log('Is expired:', session.expires_at ? new Date(session.expires_at) < now : 'N/A');
      }
    } catch(e) {
      console.error('Session query failed:', e.message);
    }

    // 4. Recent sessions
    console.log('\n=== RECENT SESSIONS ===');
    try {
      const recentSessions = await Database.query(
        'SELECT id, device_fingerprint, is_trusted, is_active, last_activity, expires_at, user_agent FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
        [userId]
      );
      console.log('Recent sessions:', JSON.stringify(recentSessions, null, 2));
    } catch(e) {
      console.error('Recent sessions query failed:', e.message);
    }

    // 5. Audit logs
    console.log('\n=== RECENT AUDIT LOGS ===');
    try {
      const audits = await Database.query(
        'SELECT id, action, resource_type, details, status, severity, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
        [userId]
      );
      console.log('Audit logs:', JSON.stringify(audits, null, 2));
    } catch(e) {
      console.error('Audit query failed:', e.message);
    }

    // 6. Notifications
    console.log('\n=== NOTIFICATIONS ===');
    try {
      const notifs = await Database.query(
        'SELECT id, channel, recipient, subject, status, error_message, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
        [userId]
      );
      console.log('Notifications:', JSON.stringify(notifs, null, 2));
    } catch(e) {
      console.error('Notifications query failed:', e.message);
    }

  } catch(e) {
    console.error('Fatal error:', e);
  } finally {
    await Database.close();
  }
}

run();
