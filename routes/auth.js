// Authentication Routes and Middleware - MySQL Version
const express = require('express');
const Database = require('../config');
const EmailVerificationService = require('../services/EmailVerificationService');
const OTPService = require('../services/OTPService');
const DeviceSecurityService = require('../services/DeviceSecurityService');

const router = express.Router();

// Middleware to authenticate JWT tokens
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = Database.verifyJWT(token);
    
    // Get user from database
    const user = await Database.selectOne(
      'users',
      'id, name, email, role, region',
      'id = ?',
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// POST /api/auth/register - User registration (supports JSON and multipart for profile image)
router.post('/register', async (req, res) => {
  // Helper to perform registration after optional file parsing
  const handleRegister = async (req, res) => {
    try {
      const { name, email, password, phone, region } = req.body;

      // Validation
      if (!name || !email || !password) {
        return res.status(400).json({ 
          error: 'Name, email, and password are required' 
        });
      }

      if (name.trim().length < 2) {
        return res.status(400).json({ 
          error: 'Name must be at least 2 characters long' 
        });
      }

      if (!email.includes('@') || email.length < 5) {
        return res.status(400).json({ 
          error: 'Please enter a valid email address' 
        });
      }

      if (password.length < 6) {
        return res.status(400).json({ 
          error: 'Password must be at least 6 characters long' 
        });
      }

      if (phone && phone.length < 10) {
        return res.status(400).json({ 
          error: 'Please enter a valid phone number' 
        });
      }

      // Check if user already exists
      const existing = await Database.selectOne('users', 'id', 'email = ?', [email.toLowerCase().trim()]);
      if (existing) {
        return res.status(409).json({ 
          error: 'An account with this email already exists. Please use a different email or try logging in.' 
        });
      }

      // Hash password
      const passwordHash = await Database.hashPassword(password);

      // Create user
      const userId = Database.generateUUID();
      const userData = {
        id: userId,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        phone: phone?.trim() || null,
        region: region?.trim() || 'default',
        role: 'user',
        created_at: new Date(),
        updated_at: new Date()
      };

      // If a profile image was uploaded, store its URL
      if (req.file && req.file.fieldname === 'profile_image') {
        const FileUploadService = require('../services/FileUploadService');
        const files = await FileUploadService.processUploadedFiles(req.file, userId, userId, 'user_profile');
        const imageUrl = files?.[0]?.url || null;
        if (imageUrl) {
          userData.profile_image_url = imageUrl;
        }
      }

      await Database.insert('users', userData);

      // Generate JWT
      const token = Database.generateJWT({ id: userId, email: userData.email, role: 'user' });

      // Send email verification
      try {
        await EmailVerificationService.createEmailVerification(userId);
      } catch (emailError) {
        console.error('Email verification error:', emailError);
        // Don't fail registration if email fails
      }

      // Log successful registration
      await Database.logAudit(
        userId,
        'REGISTER',
        'users',
        userId,
        null,
        { registration_time: new Date() },
        req.ip
      );

      // Return user data (without password)
      const user = await Database.selectOne(
        'users',
        'id, name, email, role, region, verified_at, created_at, profile_image_url',
        'id = ?',
        [userId]
      );

      res.status(201).json({
        user,
        token,
        message: 'Account created successfully! Please check your email to verify your account.',
        email_verification_sent: true
      });
    } catch (error) {
      console.error('Registration error:', error);
      
      // Check for specific database errors
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ 
          error: 'An account with this email already exists' 
        });
      }
      
      if (error.message && error.message.includes('Database connection not available')) {
        return res.status(503).json({ 
          error: 'Service temporarily unavailable. Please try again later.' 
        });
      }
      
      res.status(500).json({ 
        error: 'An unexpected error occurred during registration. Please try again.' 
      });
    }
  };

  try {
    // If multipart/form-data, parse optional profile image using FileUploadService
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      const FileUploadService = require('../services/FileUploadService');
      const upload = FileUploadService.getUploadMiddleware('profile_image');
      upload(req, res, (err) => {
        if (err) {
          return res.status(400).json({ error: err.message });
        }
        // Proceed with registration logic
        handleRegister(req, res);
      });
    } else {
      // JSON body registration
      await handleRegister(req, res);
    }
  } catch (err) {
    console.error('Registration handler error:', err);
    res.status(500).json({ error: 'Failed to process registration request' });
  }
});

// POST /api/auth/login - Enhanced login with device security
router.post('/login', async (req, res) => {
  try {
    const { email, password, remember_device } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      });
    }

    if (!email.includes('@')) {
      return res.status(400).json({ 
        error: 'Please enter a valid email address' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters' 
      });
    }

    // Get user with additional security fields
    const user = await Database.selectOne(
      'users',
      'id, name, email, password_hash, role, region, verified_at, two_factor_enabled, login_count',
      'email = ?',
      [email.toLowerCase().trim()]
    );

    if (!user) {
      console.warn(`🔐 Login debug: user not found for email='${email.toLowerCase().trim()}'`);
      return res.status(401).json({ 
        error: 'Invalid email or password. Please check your credentials and try again.' 
      });
    }

    // Verify password
    const validPassword = await Database.verifyPassword(password, user.password_hash);
    if (!validPassword) {
      console.warn(`🔐 Login debug: invalid password for user_id='${user.id}', email='${user.email}'`);
      // Log failed login attempt
      await Database.insert('audit_logs', {
        id: Database.generateUUID(),
        user_id: user.id,
        action: 'login_failed',
        resource_type: 'auth',
        resource_id: user.id,
        details: 'Invalid password attempt',
        ip_address: req.ip,
        user_agent: req.get('User-Agent'),
        severity: 'medium',
        status: 'failed',
        created_at: new Date()
      });

      return res.status(401).json({ 
        error: 'Invalid email or password. Please check your credentials and try again.' 
      });
    }

    // Check device trust status
    const enableOtp = process.env.ENABLE_EMAIL_OTP !== 'false';
    const deviceFingerprint = DeviceSecurityService.generateDeviceFingerprint(req);
    console.log('🔍 Login Debug - Device fingerprint:', deviceFingerprint.substring(0, 16) + '...');
    
    // Only check trust if OTP is enabled
    const isDeviceTrusted = enableOtp ? await DeviceSecurityService.isDeviceTrusted(user.id, deviceFingerprint) : true;
    console.log('🔍 Login Debug - Device trusted:', isDeviceTrusted);
    
    // If device is not trusted and OTP is enabled, require OTP verification
    if (!isDeviceTrusted && enableOtp) {
      console.log('🔍 Login Debug - Requiring device verification');
      // Create OTP for device verification
      await OTPService.createOTP(user.id, 'device_login', deviceFingerprint, 10); // 10 minutes

      // Create temporary session (not trusted yet)
      const sessionInfo = await DeviceSecurityService.createDeviceSession(user.id, req, false);

      // Send device login notification
      const deviceInfo = DeviceSecurityService.parseUserAgent(req.get('User-Agent'));
      await DeviceSecurityService.sendDeviceLoginNotification(
        user.id, 
        deviceInfo, 
        req.ip, 
        true // New device
      );

      return res.status(200).json({
        requires_device_verification: true,
        device_fingerprint: deviceFingerprint,
        message: 'New device detected. Please check your email for a verification code.',
        user_id: user.id // Needed for OTP verification
      });
    }

    // Update session activity for trusted device
    console.log('🔍 Login Debug - Device is trusted, updating session activity');
    await DeviceSecurityService.updateSessionActivity(user.id, deviceFingerprint);

    // Update user login statistics
    await Database.update(
      'users',
      { 
        login_count: (user.login_count || 0) + 1,
        last_login_at: new Date(),
        updated_at: new Date()
      },
      'id = ?',
      [user.id]
    );

    // Generate JWT
    const token = Database.generateJWT({ 
      id: user.id, 
      email: user.email, 
      role: user.role 
    });

    // Log successful login
    await Database.insert('audit_logs', {
      id: Database.generateUUID(),
      user_id: user.id,
      action: 'login_success',
      resource_type: 'auth',
      resource_id: user.id,
      details: 'Successful login from trusted device',
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      severity: 'low',
      status: 'success',
      created_at: new Date()
    });

    // Send login notification for trusted device
    const deviceInfo = DeviceSecurityService.parseUserAgent(req.get('User-Agent'));
    await DeviceSecurityService.sendDeviceLoginNotification(
      user.id, 
      deviceInfo, 
      req.ip, 
      false // Trusted device
    );

    // Return user data (without password)
    const { password_hash, ...userWithoutPassword } = user;

    res.json({
      user: userWithoutPassword,
      token,
      message: 'Login successful',
      device_trusted: true
    });
  } catch (error) {
    console.error('Login error:', error);
    
    // Check if it's a database connection error
    if (error.message.includes('Database connection not available')) {
      return res.status(503).json({ 
        error: 'Service temporarily unavailable. Please try again later.' 
      });
    }
    
    res.status(500).json({ 
      error: 'An unexpected error occurred. Please try again.' 
    });
  }
});

// GET /api/auth/me - Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await Database.selectOne(
      'users',
      'id, name, email, role, region, phone, profile_image_url, verified_at, created_at, login_count, last_login_at, kyc_status, is_verified, caution_flag',
      'id = ?',
      [req.user.id]
    );

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/auth/profile - Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, phone, region } = req.body;
    const userId = req.user.id;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters long' });
    }

    const updateData = {
      name: name.trim(),
      phone: phone ? phone.trim() : null,
      region: region ? region.trim() : null,
      updated_at: new Date()
    };

    await Database.update('users', updateData, 'id = ?', [userId]);

    // Log profile update
    await Database.logAudit(
      userId,
      'UPDATE_PROFILE',
      'users',
      userId,
      null,
      updateData,
      req.ip
    );

    // Return updated user
    const updatedUser = await Database.selectOne(
      'users',
      'id, name, email, role, region, phone, profile_image_url, verified_at, created_at, kyc_status, is_verified, caution_flag',
      'id = ?',
      [userId]
    );

    res.json({ 
      success: true, 
      message: 'Profile updated successfully',
      user: updatedUser 
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/auth/logout - Logout (client-side token removal)
router.post('/logout', (req, res) => {
  res.json({ message: 'Logout successful' });
});

// POST /api/auth/verify-email - Verify email with token
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    const result = await EmailVerificationService.verifyEmailToken(token);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    // Log email verification
    await Database.logAudit(
      result.userId,
      'EMAIL_VERIFIED',
      'users',
      result.userId,
      { verified_at: null },
      { verified_at: new Date() },
      req.ip
    );

    res.json({
      success: true,
      message: 'Email verified successfully! You can now use all features.'
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// POST /api/auth/resend-verification - Resend verification email
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const result = await EmailVerificationService.resendVerification(email);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    res.json({
      success: true,
      message: 'Verification email sent successfully'
    });

  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

// POST /api/auth/request-password-reset - Request password reset OTP
router.post('/request-password-reset', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Find user
    const user = await Database.selectOne('users', 'id, name', 'email = ?', [email.toLowerCase().trim()]);
    
    if (!user) {
      // Don't reveal if email exists or not for security
      return res.json({
        success: true,
        message: 'If an account with this email exists, a password reset code has been sent.'
      });
    }

    // Create password reset OTP
    const otpResult = await OTPService.createOTP(user.id, 'password_reset', null, 15); // 15 minutes

    // Log password reset request
    await Database.insert('audit_logs', {
      id: Database.generateUUID(),
      user_id: user.id,
      action: 'password_reset_requested',
      resource_type: 'auth',
      resource_id: user.id,
      details: 'Password reset OTP requested',
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      severity: 'medium',
      status: 'success',
      created_at: new Date()
    });

    res.json({
      success: true,
      message: 'If an account with this email exists, a password reset code has been sent.',
      expires_in_minutes: 15
    });

  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// POST /api/auth/reset-password - Reset password with OTP
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp_code, new_password } = req.body;

    if (!email || !otp_code || !new_password) {
      return res.status(400).json({ error: 'Email, OTP code, and new password are required' });
    }

    if (!email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Validate password strength
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(new_password)) {
      return res.status(400).json({ 
        error: 'Password must contain at least one lowercase letter, one uppercase letter, and one number' 
      });
    }

    // Find user
    const user = await Database.selectOne('users', 'id, name', 'email = ?', [email.toLowerCase().trim()]);
    
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or OTP code' });
    }

    // Verify OTP
    const otpResult = await OTPService.verifyOTP(user.id, otp_code, 'password_reset');

    if (!otpResult.success) {
      // Log failed password reset attempt
      await Database.insert('audit_logs', {
        id: Database.generateUUID(),
        user_id: user.id,
        action: 'password_reset_failed',
        resource_type: 'auth',
        resource_id: user.id,
        details: 'Invalid OTP for password reset',
        ip_address: req.ip,
        user_agent: req.get('User-Agent'),
        severity: 'high',
        status: 'failed',
        created_at: new Date()
      });

      return res.status(400).json({ error: otpResult.message });
    }

    // Hash new password
    const passwordHash = await Database.hashPassword(new_password);

    // Update password
    await Database.update('users', {
      password_hash: passwordHash,
      updated_at: new Date()
    }, 'id = ?', [user.id]);

    // Invalidate all existing sessions for security
    await Database.query(
      'UPDATE user_sessions SET is_active = false WHERE user_id = ?',
      [user.id]
    );

    // Log successful password reset
    await Database.insert('audit_logs', {
      id: Database.generateUUID(),
      user_id: user.id,
      action: 'password_reset_success',
      resource_type: 'auth',
      resource_id: user.id,
      details: 'Password successfully reset via OTP',
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      severity: 'medium',
      status: 'success',
      created_at: new Date()
    });

    // Send password reset confirmation email
    try {
      const NotificationService = require('../services/NotificationService');
      await NotificationService.sendEmail(
        email,
        'Password Reset Successful - Check It Registry',
        `
          <h2>Password Reset Successful</h2>
          <p>Hello ${user.name},</p>
          <p>Your password has been successfully reset.</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>IP Address:</strong> ${req.ip}</p>
          </div>
          <p>If you didn't make this change, please contact support immediately.</p>
          <p>For security, all your existing sessions have been logged out.</p>
        `
      );
    } catch (emailError) {
      console.error('Failed to send password reset confirmation email:', emailError);
    }

    res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password. All existing sessions have been logged out for security.'
    });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// POST /api/auth/send-otp - Send OTP for various purposes
router.post('/send-otp', authenticateToken, async (req, res) => {
  try {
    const { otp_type, reference_id } = req.body;
    const userId = req.user.id;

    const validTypes = ['device_transfer', '2fa', 'email_verification'];
    if (!validTypes.includes(otp_type)) {
      return res.status(400).json({ error: 'Invalid OTP type' });
    }

    const result = await OTPService.createOTP(userId, otp_type, reference_id);

    res.json({
      success: true,
      message: 'OTP sent successfully',
      expires_at: result.expiresAt
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /api/auth/verify-device - Verify device with OTP after login
router.post('/verify-device', async (req, res) => {
  try {
    const { user_id, otp_code, device_fingerprint, remember_device } = req.body;

    if (!user_id || !otp_code || !device_fingerprint) {
      return res.status(400).json({ 
        error: 'User ID, OTP code, and device fingerprint are required' 
      });
    }

    // Verify OTP
    const otpResult = await OTPService.verifyOTP(user_id, otp_code, 'device_login', device_fingerprint);

    if (!otpResult.success) {
      return res.status(400).json({ error: otpResult.message });
    }

    // Get user data
    const user = await Database.selectOne(
      'users',
      'id, name, email, role, region, verified_at, login_count',
      'id = ?',
      [user_id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Trust the device by default after successful OTP (skip prompts within 90 days)
    // If client explicitly sets remember_device === false, skip trusting.
    const shouldTrust = remember_device !== false;
    let trusted = false;
    if (shouldTrust) {
      trusted = await DeviceSecurityService.trustDevice(user_id, device_fingerprint);
      // In case session was not created earlier, create and trust now
      if (!trusted) {
        try {
          await DeviceSecurityService.createDeviceSession(user_id, req, true);
          trusted = true;
        } catch (sessionErr) {
          console.warn('Device session creation during verify failed:', sessionErr);
        }
      }

      // Update activity so session stays fresh
      try {
        await DeviceSecurityService.updateSessionActivity(user_id, device_fingerprint);
      } catch {}
    }

    // Update user login statistics
    await Database.update(
      'users',
      { 
        login_count: (user.login_count || 0) + 1,
        last_login_at: new Date(),
        updated_at: new Date()
      },
      'id = ?',
      [user_id]
    );

    // Generate JWT
    const token = Database.generateJWT({ 
      id: user.id, 
      email: user.email, 
      role: user.role 
    });

    // Log successful device verification
    await Database.insert('audit_logs', {
      id: Database.generateUUID(),
      user_id: user_id,
      action: 'device_verified',
      resource_type: 'security',
      resource_id: device_fingerprint,
      details: `Device verified and ${remember_device ? 'trusted' : 'not trusted'}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      severity: 'medium',
      status: 'success',
      created_at: new Date()
    });

    res.json({
      user,
      token,
      message: 'Device verified successfully',
      device_trusted: shouldTrust && trusted
    });

  } catch (error) {
    console.error('Device verification error:', error);
    res.status(500).json({ error: 'Failed to verify device' });
  }
});

// POST /api/auth/verify-otp - Verify OTP
router.post('/verify-otp', authenticateToken, async (req, res) => {
  try {
    const { otp_code, otp_type, reference_id } = req.body;
    const userId = req.user.id;

    if (!otp_code || !otp_type) {
      return res.status(400).json({ error: 'OTP code and type are required' });
    }

    const result = await OTPService.verifyOTP(userId, otp_code, otp_type, reference_id);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    // Log OTP verification
    await Database.insert('audit_logs', {
      id: Database.generateUUID(),
      user_id: userId,
      action: 'otp_verified',
      resource_type: 'security',
      resource_id: reference_id,
      details: `OTP verified for ${otp_type}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      severity: 'low',
      status: 'success',
      created_at: new Date()
    });

    res.json({
      success: true,
      message: result.message
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// GET /api/auth/trusted-devices - Get user's trusted devices
router.get('/trusted-devices', authenticateToken, async (req, res) => {
  try {
    const devices = await DeviceSecurityService.getTrustedDevices(req.user.id);
    res.json({ devices });
  } catch (error) {
    console.error('Get trusted devices error:', error);
    res.status(500).json({ error: 'Failed to get trusted devices' });
  }
});

// DELETE /api/auth/trusted-devices/:sessionId - Revoke trust for a device
router.delete('/trusted-devices/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const success = await DeviceSecurityService.revokeTrustedDevice(req.user.id, sessionId);
    
    if (success) {
      res.json({ message: 'Device trust revoked successfully' });
    } else {
      res.status(404).json({ error: 'Device not found or already revoked' });
    }
  } catch (error) {
    console.error('Revoke trusted device error:', error);
    res.status(500).json({ error: 'Failed to revoke device trust' });
  }
});

// POST /api/auth/resend-device-otp - Resend OTP for device verification
router.post('/resend-device-otp', async (req, res) => {
  try {
    const { user_id, device_fingerprint } = req.body;

    if (!user_id || !device_fingerprint) {
      return res.status(400).json({ 
        error: 'User ID and device fingerprint are required' 
      });
    }

    // Verify user exists
    const user = await Database.selectOne('users', 'id', 'id = ?', [user_id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create new OTP
    await OTPService.createOTP(user_id, 'device_login', device_fingerprint, 10);

    res.json({
      success: true,
      message: 'Verification code sent successfully'
    });

  } catch (error) {
    console.error('Resend device OTP error:', error);
    res.status(500).json({ error: 'Failed to resend verification code' });
  }
});

module.exports = { router, authenticateToken };