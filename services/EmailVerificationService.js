const mysql = require('mysql2/promise');
const crypto = require('crypto');
const Database = require('../config');
const NotificationService = require('./NotificationService');

class EmailVerificationService {
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

  // Generate verification token
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Create and send email verification
  async createEmailVerification(userId) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        // Clean up old tokens for this user
        await connection.execute(
          'DELETE FROM email_verification_tokens WHERE user_id = ? AND expires_at < NOW()',
          [userId]
        );

        // Generate new token
        const token = this.generateToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Insert new token
        await connection.execute(
          `INSERT INTO email_verification_tokens (user_id, token, expires_at) 
           VALUES (?, ?, ?)`,
          [userId, token, expiresAt]
        );

        // Get user details
        const [userRows] = await connection.execute(
          'SELECT name, email FROM users WHERE id = ?',
          [userId]
        );

        if (userRows.length === 0) {
          throw new Error('User not found');
        }

        const user = userRows[0];

        // Send verification email
        await this.sendVerificationEmail(user, token);

        return {
          success: true,
          message: 'Verification email sent successfully'
        };

      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error creating email verification:', error);
      throw error;
    }
  }

  // Verify email token
  async verifyEmailToken(token) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        // Find valid token
        const [tokenRows] = await connection.execute(
          `SELECT user_id FROM email_verification_tokens 
           WHERE token = ? AND expires_at > NOW() AND used_at IS NULL`,
          [token]
        );

        if (tokenRows.length === 0) {
          return {
            success: false,
            message: 'Invalid or expired verification token'
          };
        }

        const userId = tokenRows[0].user_id;

        // Mark token as used
        await connection.execute(
          'UPDATE email_verification_tokens SET used_at = NOW() WHERE token = ?',
          [token]
        );

        // Mark user as verified
        await connection.execute(
          'UPDATE users SET verified_at = NOW() WHERE id = ?',
          [userId]
        );

        return {
          success: true,
          message: 'Email verified successfully',
          userId
        };

      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error verifying email token:', error);
      throw error;
    }
  }

  // Send verification email
  async sendVerificationEmail(user, token) {
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-email?token=${token}`;
    
    const emailTemplate = `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <h2 style="color: #646cff;">Welcome to Check It Device Registry!</h2>
        <p>Hello ${user.name},</p>
        <p>Thank you for registering with Check It. To complete your registration and start protecting your devices, please verify your email address.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" 
             style="background-color: #646cff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Verify Email Address
          </a>
        </div>
        
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
        
        <p>This verification link will expire in 24 hours.</p>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        
        <h3>What's Next?</h3>
        <ul>
          <li>Register your devices with proof of ownership</li>
          <li>Get admin verification for full protection</li>
          <li>Use our public check to verify devices before purchase</li>
          <li>Report stolen or lost devices instantly</li>
        </ul>
        
        <p>If you didn't create an account with Check It, please ignore this email.</p>
        
        <p>Best regards,<br>The Check It Team</p>
      </div>
    `;

    await NotificationService.sendEmail(
      user.email,
      'Verify Your Email - Check It Device Registry',
      emailTemplate
    );
  }

  // Resend verification email
  async resendVerification(email) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        // Find user by email
        const [userRows] = await connection.execute(
          'SELECT id, name, verified_at FROM users WHERE email = ?',
          [email]
        );

        if (userRows.length === 0) {
          return {
            success: false,
            message: 'User not found'
          };
        }

        const user = userRows[0];

        if (user.verified_at) {
          return {
            success: false,
            message: 'Email is already verified'
          };
        }

        // Create new verification
        return await this.createEmailVerification(user.id);

      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error resending verification:', error);
      throw error;
    }
  }

  // Check if user is verified
  async isUserVerified(userId) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        const [userRows] = await connection.execute(
          'SELECT verified_at FROM users WHERE id = ?',
          [userId]
        );

        return userRows.length > 0 && userRows[0].verified_at !== null;

      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error checking user verification:', error);
      throw error;
    }
  }

  // Clean up expired tokens
  async cleanupExpiredTokens() {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        const [result] = await connection.execute(
          'DELETE FROM email_verification_tokens WHERE expires_at < NOW()'
        );
        
        console.log(`Cleaned up ${result.affectedRows} expired email verification tokens`);
        return result.affectedRows;
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error cleaning up expired tokens:', error);
      throw error;
    }
  }
}

module.exports = new EmailVerificationService();