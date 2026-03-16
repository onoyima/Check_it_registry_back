const mysql = require('mysql2/promise');
const crypto = require('crypto');
const Database = require('../config');
const NotificationService = require('./NotificationService');

class OTPService {
  constructor() {
    // Use the same database connection as the main Database class
    this.pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'check_it_registry',
      charset: 'utf8mb4',
      timezone: '+00:00',
      connectionLimit: 10,
      queueLimit: 0
    });
  }

  // Generate a random OTP code
  generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * digits.length)];
    }
    return otp;
  }

  // Create and send OTP
  async createOTP(userId, otpType, referenceId = null, expiryMinutes = 10) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        // Clean up expired OTPs for this user and type
        await connection.execute(
          'DELETE FROM otps WHERE user_id = ? AND otp_type = ? AND expires_at < UTC_TIMESTAMP()',
          [userId, otpType]
        );

        // Generate new OTP
        const otpCode = this.generateOTP();
        const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

        // Insert new OTP
        const [result] = await connection.execute(
          `INSERT INTO otps (user_id, otp_code, otp_type, reference_id, expires_at) 
           VALUES (?, ?, ?, ?, ?)`,
          [userId, otpCode, otpType, referenceId, expiresAt]
        );

        // Get user details for notification
        const [userRows] = await connection.execute(
          'SELECT name, email, phone FROM users WHERE id = ?',
          [userId]
        );

        if (userRows.length === 0) {
          throw new Error('User not found');
        }

        const user = userRows[0];

        // Send OTP via email
        await this.sendOTPEmail(user, otpCode, otpType, expiryMinutes);

        // Send OTP via SMS if phone number exists
        if (user.phone) {
          await this.sendOTPSMS(user.phone, otpCode, otpType, expiryMinutes);
        }

        return {
          success: true,
          otpId: result.insertId,
          expiresAt,
          message: 'OTP sent successfully'
        };

      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error creating OTP:', error);
      throw error;
    }
  }

  // Verify OTP
  async verifyOTP(userId, otpCode, otpType, referenceId = null) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        // Find valid OTP
        const [otpRows] = await connection.execute(
          `SELECT id, attempts, max_attempts, expires_at, used_at 
           FROM otps 
           WHERE user_id = ? AND otp_code = ? AND otp_type = ? 
           AND (reference_id = ? OR reference_id IS NULL)
           AND expires_at >= UTC_TIMESTAMP() AND used_at IS NULL`,
          [userId, otpCode, otpType, referenceId]
        );

        if (otpRows.length === 0) {
          // Increment attempts for any matching OTP
          await connection.execute(
            `UPDATE otps SET attempts = attempts + 1 
             WHERE user_id = ? AND otp_type = ? 
             AND (reference_id = ? OR reference_id IS NULL)
             AND expires_at >= UTC_TIMESTAMP() AND used_at IS NULL`,
            [userId, otpType, referenceId]
          );

          return {
            success: false,
            message: 'Invalid or expired OTP'
          };
        }

        const otp = otpRows[0];

        // Check if max attempts exceeded
        if (otp.attempts >= otp.max_attempts) {
          return {
            success: false,
            message: 'Maximum OTP attempts exceeded. Please request a new OTP.'
          };
        }

        // Mark OTP as used
        await connection.execute(
          'UPDATE otps SET used_at = NOW() WHERE id = ?',
          [otp.id]
        );

        return {
          success: true,
          message: 'OTP verified successfully'
        };

      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error verifying OTP:', error);
      throw error;
    }
  }

  // Send OTP via email
  async sendOTPEmail(user, otpCode, otpType, expiryMinutes) {
    const templates = {
      email_verification: {
        subject: 'Verify Your Email - Check It Registry',
        template: `
          <h2>Email Verification</h2>
          <p>Hello ${user.name},</p>
          <p>Your email verification code is:</p>
          <h1 style="color: #646cff; font-size: 2em; letter-spacing: 0.2em;">${otpCode}</h1>
          <p>This code will expire in ${expiryMinutes} minutes.</p>
          <p>If you didn't request this verification, please ignore this email.</p>
        `
      },
      device_transfer: {
        subject: 'Device Transfer Verification - Check It Registry',
        template: `
          <h2>Device Transfer Verification</h2>
          <p>Hello ${user.name},</p>
          <p>Your device transfer verification code is:</p>
          <h1 style="color: #646cff; font-size: 2em; letter-spacing: 0.2em;">${otpCode}</h1>
          <p>This code will expire in ${expiryMinutes} minutes.</p>
          <p>Only share this code with the person you're transferring the device to.</p>
        `
      },
      password_reset: {
        subject: 'Password Reset Code - Check It Registry',
        template: `
          <h2>Password Reset</h2>
          <p>Hello ${user.name},</p>
          <p>Your password reset code is:</p>
          <h1 style="color: #646cff; font-size: 2em; letter-spacing: 0.2em;">${otpCode}</h1>
          <p>This code will expire in ${expiryMinutes} minutes.</p>
          <p>If you didn't request a password reset, please ignore this email.</p>
        `
      },
      '2fa': {
        subject: 'Two-Factor Authentication Code - Check It Registry',
        template: `
          <h2>Two-Factor Authentication</h2>
          <p>Hello ${user.name},</p>
          <p>Your 2FA verification code is:</p>
          <h1 style="color: #646cff; font-size: 2em; letter-spacing: 0.2em;">${otpCode}</h1>
          <p>This code will expire in ${expiryMinutes} minutes.</p>
        `
      },
      device_login: {
        subject: 'New Device Login Verification - Check It Registry',
        template: `
          <h2>New Device Login Detected</h2>
          <p>Hello ${user.name},</p>
          <p>We detected a login from a new device. To complete your login, please enter this verification code:</p>
          <h1 style="color: #646cff; font-size: 2em; letter-spacing: 0.2em;">${otpCode}</h1>
          <p>This code will expire in ${expiryMinutes} minutes.</p>
          <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Security Tip:</strong> You can choose to "Remember this device" to avoid verification codes for future logins from this device.</p>
          </div>
          <p>If you didn't attempt to log in, please secure your account immediately by changing your password.</p>
        `
      },
      device_verification: {
        subject: 'Device Registration Verification - Check It Registry',
        template: `
          <h2>Verify Your Device Registration</h2>
          <p>Hello ${user.name},</p>
          <p>Please verify your device registration by entering this verification code:</p>
          <h1 style="color: #646cff; font-size: 2em; letter-spacing: 0.2em;">${otpCode}</h1>
          <p>This code will expire in ${expiryMinutes} minutes.</p>
          <p>Once verified, your device will be reviewed by our admin team for final approval.</p>
          <div style="background: #e7f3ff; border: 1px solid #b3d9ff; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Note:</strong> Device verification is required to ensure the security and authenticity of registered devices.</p>
          </div>
        `
      }
    };

    const template = templates[otpType] || templates.email_verification;
    
    await NotificationService.sendEmailDirect(
      user.email,
      template.subject,
      template.template
    );
  }

  // Send OTP via SMS (placeholder for future SMS integration)
  async sendOTPSMS(phoneNumber, otpCode, otpType, expiryMinutes) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        const messages = {
          email_verification: `Your Check It verification code is: ${otpCode}. Expires in ${expiryMinutes} minutes.`,
          device_transfer: `Your Check It device transfer code is: ${otpCode}. Share only with the recipient. Expires in ${expiryMinutes} minutes.`,
          password_reset: `Your Check It password reset code is: ${otpCode}. Expires in ${expiryMinutes} minutes.`,
          '2fa': `Your Check It 2FA code is: ${otpCode}. Expires in ${expiryMinutes} minutes.`
        };

        const message = messages[otpType] || messages.email_verification;

        // Store SMS in queue (for future SMS provider integration)
        await connection.execute(
          `INSERT INTO sms_notifications (phone_number, message, notification_type, status) 
           VALUES (?, ?, ?, 'pending')`,
          [phoneNumber, message, otpType]
        );

        console.log(`SMS queued for ${phoneNumber}: ${message}`);
        
        // TODO: Integrate with SMS provider (Twilio, etc.)
        // For now, just log the SMS
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error sending SMS:', error);
      // Don't throw error for SMS failures
    }
  }

  // Clean up expired OTPs (should be run periodically)
  async cleanupExpiredOTPs() {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        const [result] = await connection.execute(
          'DELETE FROM otps WHERE expires_at < UTC_TIMESTAMP()'
        );
        
        console.log(`Cleaned up ${result.affectedRows} expired OTPs`);
        return result.affectedRows;
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error cleaning up expired OTPs:', error);
      throw error;
    }
  }

  // Get OTP statistics
  async getOTPStats() {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        const [stats] = await connection.execute(`
          SELECT 
            otp_type,
            COUNT(*) as total_generated,
            SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END) as total_used,
            SUM(CASE WHEN expires_at < NOW() AND used_at IS NULL THEN 1 ELSE 0 END) as total_expired,
            AVG(attempts) as avg_attempts
          FROM otps 
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          GROUP BY otp_type
        `);

        return stats;
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error getting OTP stats:', error);
      throw error;
    }
  }
}

module.exports = new OTPService();