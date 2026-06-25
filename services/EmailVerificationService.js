const mysql = require('mysql2/promise');
const crypto = require('crypto');
const Database = require('../config');
const NotificationService = require('./NotificationService');
const EmailTemplate = require('./EmailTemplate');

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
    
    const content = `
      <p>Hello <strong>${user.name}</strong>,</p>
      <p>Thank you for registering with <strong>Check It</strong>. To complete your registration and start protecting your devices, please verify your email address.</p>
      
      <p style="color: #6B7280;">Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #2563EB; font-size: 13px; background: #F3F4F6; padding: 10px; border-radius: 6px;">${verificationUrl}</p>
      
      <p style="color: #6B7280;">This verification link will expire in <strong>24 hours</strong>.</p>
      
      <div style="background: #F9FAFB; border-radius: 8px; padding: 20px; margin: 25px 0;">
        <h3 style="margin: 0 0 12px; color: #111827; font-size: 16px;">What's Next?</h3>
        <ul style="margin: 0; color: #374151; line-height: 1.8;">
          <li>Register your devices with proof of ownership</li>
          <li>Get admin verification for full protection</li>
          <li>Use our public check to verify devices before purchase</li>
          <li>Report stolen or lost devices instantly</li>
        </ul>
      </div>
      
      <p style="color: #9CA3AF; font-size: 13px;">If you didn't create an account with Check It, please ignore this email.</p>
    `;

    const fullHtml = EmailTemplate.wrapContent('Welcome to Check It!', content, {
      actionButton: { url: verificationUrl, text: 'Verify Email Address' }
    });

    await NotificationService.sendEmailDirect(
      user.email,
      'Verify Your Email - Check It',
      fullHtml
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