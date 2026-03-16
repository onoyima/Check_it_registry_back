// Helper script: fetch latest device_login OTP for a user by email
const Database = require('../config');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node server/scripts/get-otp.js <email>');
    process.exit(1);
  }

  try {
    console.log(`Fetching latest device_login OTP for ${email}...`);
    const user = await Database.selectOne('users', 'id, email, name', 'email = ?', [email]);
    if (!user) {
      console.error('User not found');
      process.exit(2);
    }

    const rows = await Database.query(`
      SELECT otp_code, created_at, expires_at
      FROM otps
      WHERE user_id = ? AND otp_type = 'device_login' AND used_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `, [user.id]);

    if (!rows || rows.length === 0) {
      console.error('No active device_login OTP found. Try initiating login or resending OTP.');
      process.exit(3);
    }

    const otp = rows[0];
    console.log(JSON.stringify({ user_id: user.id, email: user.email, otp_code: otp.otp_code, created_at: otp.created_at, expires_at: otp.expires_at }, null, 2));
  } catch (err) {
    console.error('Error fetching OTP:', err.message || err);
    process.exit(4);
  }
}

main();