const mysql = require('mysql2/promise');
const Database = require('../config');
const NotificationService = require('./NotificationService');
const EmailTemplate = require('./EmailTemplate');
const PIIEncryptionService = require('./PIIEncryptionService');

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

  // Generate a signed JWT as the verification token
  // Using JWT means verification works even if the DB table is missing
  generateToken(userId) {
    return Database.generateJWT({ type: 'email_verification', sub: userId });
  }

  // Decode/verify a verification JWT, returns the decoded payload or throws
  decodeToken(token) {
    const decoded = Database.verifyJWT(token);
    if (decoded.type !== 'email_verification') {
      throw new Error('Invalid token type');
    }
    return decoded;
  }

  // Create and send email verification
  async createEmailVerification(userId) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        // Get user details first (needed for email even if DB insert fails).
        // Read via Database so the read-hook decrypts the address.
        const user = await Database.selectOne('users', 'name, email', 'id = ?', [userId]);

        if (!user) {
          throw new Error('User not found');
        }

        const token = this.generateToken(userId);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const randomToken = require('crypto').randomBytes(32).toString('hex');

        // Try to persist token to DB (best-effort — table may not exist)
        let dbSuccess = false;
        try {
          await connection.execute(
            'DELETE FROM email_verification_tokens WHERE user_id = ? AND expires_at < NOW()',
            [userId]
          ).catch(() => {});

          await connection.execute(
            `INSERT INTO email_verification_tokens (user_id, token, expires_at) 
             VALUES (?, ?, ?)`,
            [userId, randomToken, expiresAt]
          );
          dbSuccess = true;
        } catch (insertErr) {
          console.error('email_verification_tokens table may not exist. Run migration 012:', insertErr.message);
        }

        // Send verification email regardless of DB insert success
        await this.sendVerificationEmail(user, token);

        return {
          success: true,
          message: 'Verification email sent successfully',
          token_persisted: dbSuccess
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
        // Step 1: Try legacy DB-backed lookup (for tokens stored before JWT migration)
        let userId = null;

        try {
          const [tokenRows] = await connection.execute(
            `SELECT user_id FROM email_verification_tokens 
             WHERE token = ? AND expires_at > NOW() AND used_at IS NULL`,
            [token]
          );

          if (tokenRows.length > 0) {
            userId = tokenRows[0].user_id;
            // Mark token as used (best-effort)
            await connection.execute(
              'UPDATE email_verification_tokens SET used_at = NOW() WHERE token = ?',
              [token]
            ).catch(() => {});
          }
        } catch (queryErr) {
          // Table may not exist — fall through to JWT verification
        }

        // Step 2: If DB lookup failed, try JWT verification
        if (!userId) {
          try {
            const decoded = this.decodeToken(token);
            userId = decoded.sub;
          } catch (jwtErr) {
            return {
              success: false,
              message: 'Invalid or expired verification token'
            };
          }
        }

        if (!userId) {
          return {
            success: false,
            message: 'Invalid or expired verification token'
          };
        }

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
      <p>Thank you for registering with <strong>Prove Ownership</strong>. To complete your registration and start protecting your devices, please verify your email address by clicking the button below.</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${verificationUrl}" target="_blank" style="display: inline-block; padding: 16px 40px; font-size: 16px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 8px; background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%);">Verify Email Address</a>
      </div>
      
      <p style="color: #6B7280; font-size: 14px;">If the button above doesn't work, copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #2563EB; font-size: 13px; background: #F3F4F6; padding: 12px; border-radius: 6px; font-family: monospace;">${verificationUrl}</p>
      
      <p style="color: #6B7280;">This verification link will expire in <strong>24 hours</strong>.</p>
      
      <div style="background: #F9FAFB; border-radius: 8px; padding: 20px; margin: 25px 0;">
        <h3 style="margin: 0 0 12px; color: #111827; font-size: 16px;">What's Next?</h3>
        <ul style="margin: 0; color: #374151; line-height: 1.8;">
          <li>Register your devices with proof of ownership</li>
          <li>Get admin verification for full protection</li>
          <li>If selling a device, ask the buyer to check it in your presence to verify its status</li>
          <li>Report stolen or lost devices instantly</li>
        </ul>
      </div>
      
      <p style="color: #9CA3AF; font-size: 13px;">If you didn't create an account with Prove Ownership, please ignore this email.</p>
    `;

    const fullHtml = EmailTemplate.wrapContent('Welcome to Prove Ownership!', content);

    await NotificationService.sendEmailDirect(
      user.email,
      'Verify Your Email - Prove Ownership',
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
          'SELECT id, name, verified_at FROM users WHERE email_hash = ?',
          [PIIEncryptionService.hashEmail(email)]
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

  // Close the email verification pool
  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  // Clean up expired tokens
  async cleanupExpiredTokens() {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        let result;
        try {
          [result] = await connection.execute(
            'DELETE FROM email_verification_tokens WHERE expires_at < NOW()'
          );
          console.log(`Cleaned up ${result.affectedRows} expired verification tokens`);
          return result.affectedRows;
        } catch (cleanupErr) {
          // Table may not exist
          return 0;
        }
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error cleaning up expired tokens:', error);
      return 0;
    }
  }
}

module.exports = new EmailVerificationService();