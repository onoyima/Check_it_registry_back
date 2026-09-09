// Authentication Routes and Middleware - MySQL Version
const express = require('express');
const Database = require('../config');
const EmailVerificationService = require('../services/EmailVerificationService');
const OTPService = require('../services/OTPService');
const PIIEncryptionService = require('../services/PIIEncryptionService');
const DeviceSecurityService = require('../services/DeviceSecurityService');
const FileUploadService = require('../services/FileUploadService');
const NotificationService = require('../services/NotificationService');
const EmailTemplate = require('../services/EmailTemplate');
const { getDisplayName, buildUserNameFields } = require('../utils/user-helpers');
const { otpLimiter } = require('../middleware/limiters');

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
      'id, name, first_name, middle_name, last_name, email, role, region',
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
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// POST /api/auth/register - User registration (supports JSON and multipart for profile image)
router.post('/register', async (req, res) => {
  // Helper to perform registration after optional file parsing
  const handleRegister = async (req, res) => {
    try {
      const { name, first_name, middle_name, last_name, email, password, phone, region, role } = req.body;

      // Build name fields (supports both legacy 'name' and new split fields)
      const nameFields = buildUserNameFields({ name, first_name, middle_name, last_name });
      const displayName = getDisplayName(nameFields);

      // Validation - require either 'name' or 'first_name'
      if (!displayName || displayName.length < 2) {
        return res.status(400).json({ 
          error: 'Name is required and must be at least 2 characters long' 
        });
      }

      if (!email || !password) {
        return res.status(400).json({ 
          error: 'Email and password are required' 
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

      // Check if user already exists by email (via lookup hash — email is encrypted at rest)
      const existing = await Database.selectOne('users', 'id', 'email_hash = ?', [PIIEncryptionService.hashEmail(email)]);
      if (existing) {
        return res.status(409).json({ 
          error: 'An account with this email already exists. Please use a different email or try logging in.' 
        });
      }

      // Check if user already exists by phone (phone is a unique identifier)
      if (phone && phone.trim()) {
        const existingPhone = await Database.selectOne('users', 'id', 'phone_hash = ?', [PIIEncryptionService.hashPhone(phone)]);
        if (existingPhone) {
          return res.status(409).json({ 
            error: 'An account with this phone number already exists. Please use a different phone number or try logging in.' 
          });
        }
      }

      // Hash password
      const passwordHash = await Database.hashPassword(password);

      // Create user
      const userId = Database.generateUUID();
      const userData = {
        id: userId,
        ...nameFields,
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        phone: phone?.trim() || null,
        region: region?.trim() || 'default',
        role: ['user', 'admin', 'lea', 'business'].includes(role) ? role : 'user',
        created_at: new Date(),
        updated_at: new Date()
      };

      // If a profile image was uploaded, store its URL
      if (req.file && req.file.fieldname === 'profile_image') {
        const files = await FileUploadService.processUploadedFiles(req.file, userId, userId, 'profile_image');
        const imageUrl = files?.[0]?.url || null;
        if (imageUrl) {
          userData.profile_image_url = imageUrl;
        }
      }

      await Database.insert('users', userData);

      // If business registration, create business profile
      if (userData.role === 'business') {
        const {
          registrationNumber, businessName: bizName,
          sector, country, city, address, phone: bizPhone
        } = req.body;
        if (registrationNumber) {
          await Database.insert('business_profiles', {
            id: Database.generateUUID(),
            user_id: userId,
            business_name: bizName || displayName,
            business_registration_number: registrationNumber,
            business_type: 'other',
            business_address: address || null,
            business_phone: bizPhone || phone?.trim() || null,
            business_email: email.toLowerCase().trim(),
            country: country || null,
            city: city || null,
            sector: sector || null,
            verification_status: 'pending',
            created_at: new Date(),
            updated_at: new Date(),
          });
        }
      }

      // Generate JWT
      const token = Database.generateJWT({ id: userId, email: userData.email, role: userData.role });

      // Send email verification
      try {
        await EmailVerificationService.createEmailVerification(userId);
      } catch (emailError) {
        console.error('Email verification error:', emailError);
        // Don't fail registration if email fails
      }

      // Send welcome email
      try {
        const welcomeContent = `
          <p>Hello <strong>${userData.name || displayName}</strong>,</p>
          <p>Welcome to <strong>Prove Ownership</strong>, Nigeria's premier device registry and recovery system! We're excited to help you protect your valuable devices.</p>
          <div style="background: #EFF6FF; border-left: 4px solid #2563EB; padding: 20px; border-radius: 8px; margin: 25px 0;">
            <h3 style="color: #1E40AF; margin: 0 0 12px; font-size: 16px;">Get Started in 3 Easy Steps</h3>
            <ol style="color: #374151; line-height: 2; margin: 0; padding-left: 20px;">
              <li><strong>Register Your Devices:</strong> Add your phones, laptops, and other valuables to our secure registry</li>
              <li><strong>Verify Ownership:</strong> Complete the verification process to ensure maximum protection</li>
              <li><strong>Stay Protected:</strong> Get instant alerts if someone checks your device</li>
            </ol>
          </div>
          <p>If you have any questions, our support team is here to help.</p>
          <p>Stay secure,<br><strong>The Prove Ownership Team</strong></p>
        `;
        const wrappedHtml = EmailTemplate.wrapContent('Welcome to Prove Ownership!', welcomeContent, {
          actionButton: { url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/register-device`, text: 'Register Your First Device' }
        });
        await NotificationService.sendEmailDirect(
          userData.email,
          'Welcome to Prove Ownership!',
          wrappedHtml
        );
      } catch (welcomeErr) {
        console.error('Welcome email error:', welcomeErr);
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
        'id, name, first_name, middle_name, last_name, email, role, region, verified_at, created_at, profile_image_url',
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
      'id, name, first_name, middle_name, last_name, email, password_hash, role, region, verified_at, two_factor_enabled, login_count',
      'email_hash = ?',
      [PIIEncryptionService.hashEmail(email)]
    );

    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid email or password. Please check your credentials and try again.' 
      });
    }

    // Verify password
    if (!user.password_hash) {
      console.error(`Login error: User ${user.id} (${user.email}) has no password_hash`);
      return res.status(401).json({ 
        error: 'Invalid email or password. Please check your credentials and try again.' 
      });
    }
    const validPassword = await Database.verifyPassword(password, user.password_hash);
    if (!validPassword) {
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

    // Check email verification
    const emailVerificationOptional = process.env.EMAIL_VERIFICATION_REQUIRED === 'false';
    if (!user.verified_at && !emailVerificationOptional) {
      // Fire-and-forget: send a fresh verification email
      EmailVerificationService.resendVerification(user.email).catch(err =>
        console.error('Auto-resend verification failed:', err.message)
      );

      return res.status(403).json({
        error: 'Please verify your email address before logging in. A fresh verification link has been sent to your email.',
        needs_verification: true,
        email: user.email,
        user_id: user.id
      });
    }

    // Check device trust status
    const enableOtp = process.env.ENABLE_EMAIL_OTP !== 'false';
    const deviceFingerprint = DeviceSecurityService.generateDeviceFingerprint(req);
    
    // Only check trust if OTP is enabled
    const isDeviceTrusted = enableOtp ? await DeviceSecurityService.isDeviceTrusted(user.id, deviceFingerprint) : true;
    
    // If device is not trusted and OTP is enabled, require OTP verification
    if (!isDeviceTrusted && enableOtp) {
      // Create OTP for device verification (wrap so email/DB failures don't break login)
      try {
        await OTPService.createOTP(user.id, 'device_login', deviceFingerprint, 10); // 10 minutes
      } catch (otpError) {
        console.error('OTP creation failed (continuing login):', otpError.message);
      }

      // Create temporary session (not trusted yet)
      let sessionInfo;
      try {
        sessionInfo = await DeviceSecurityService.createDeviceSession(user.id, req, false);
      } catch (sessionError) {
        console.error('Device session creation failed (continuing login):', sessionError.message);
        sessionInfo = { deviceFingerprint, isTrusted: false };
      }

      // Send device login notification (fire-and-forget — don't block login)
      const deviceInfo = DeviceSecurityService.parseUserAgent(req.get('User-Agent'));
      DeviceSecurityService.sendDeviceLoginNotification(
        user.id, 
        deviceInfo, 
        req.ip, 
        true // New device
      ).catch(err => console.error('Login notification error:', err));

      return res.status(200).json({
        requires_device_verification: true,
        device_fingerprint: deviceFingerprint,
        message: 'New device detected. Please check your email for a verification code.',
        user_id: user.id // Needed for OTP verification
      });
    }

    // Update session activity for trusted device
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

    // Send login notification for trusted device (fire-and-forget)
    const deviceInfo = DeviceSecurityService.parseUserAgent(req.get('User-Agent'));
    DeviceSecurityService.sendDeviceLoginNotification(
      user.id, 
      deviceInfo, 
      req.ip, 
      false // Trusted device
    ).catch(err => console.error('Login notification error:', err));

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
      'id, name, first_name, middle_name, last_name, email, role, region, phone, profile_image_url, verified_photo_url, verified_at, created_at, login_count, last_login_at, kyc_status, is_verified, caution_flag',
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
    const { name, first_name, middle_name, last_name, phone, region } = req.body;
    const userId = req.user.id;

    // Build name fields from either legacy or new fields
    const nameFields = buildUserNameFields({ name, first_name, middle_name, last_name });
    const displayName = getDisplayName(nameFields);

    if (!displayName || displayName.trim().length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters long' });
    }

    // Check phone uniqueness if changing
    if (phone && phone.trim()) {
      const existingPhone = await Database.selectOne('users', 'id', 'phone_hash = ? AND id != ?', [PIIEncryptionService.hashPhone(phone), userId]);
      if (existingPhone) {
        return res.status(409).json({ error: 'This phone number is already associated with another account' });
      }
    }

    const updateData = {
      ...nameFields,
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
      'id, name, first_name, middle_name, last_name, email, role, region, phone, profile_image_url, verified_at, created_at, kyc_status, is_verified, caution_flag',
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
    const user = await Database.selectOne('users', 'id, name, first_name, middle_name, last_name', 'email_hash = ?', [PIIEncryptionService.hashEmail(email)]);
    
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
    const user = await Database.selectOne('users', 'id, name, first_name, middle_name, last_name', 'email_hash = ?', [PIIEncryptionService.hashEmail(email)]);
    
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
      const content = `
        <p>Hello <strong>${getDisplayName(user)}</strong>,</p>
        <p>Your password has been successfully reset.</p>
        <div style="background: #F3F4F6; border-radius: 8px; padding: 16px; margin: 15px 0;">
          <table cellpadding="4" cellspacing="0" style="font-size: 14px; color: #374151;">
            <tr><td style="font-weight: 600; padding-right: 12px;">Time:</td><td>${new Date().toLocaleString()}</td></tr>
            <tr><td style="font-weight: 600; padding-right: 12px;">IP Address:</td><td>${req.ip}</td></tr>
          </table>
        </div>
        <div style="background: #FEF2F2; border-left: 4px solid #DC2626; padding: 12px 16px; border-radius: 8px; margin: 15px 0;">
          <p style="margin: 0; color: #991B1B; font-size: 14px;"><strong>If you didn't make this change,</strong> please contact support immediately.</p>
        </div>
        <p style="color: #6B7280;">For security, all your existing sessions have been logged out.</p>
      `;
      const fullHtml = EmailTemplate.wrapContent('Password Reset Successful', content);
      await NotificationService.sendEmailDirect(
        email,
        'Password Reset Successful - Prove Ownership',
        fullHtml
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
router.post('/send-otp', otpLimiter, authenticateToken, async (req, res) => {
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
router.post('/verify-device', otpLimiter, async (req, res) => {
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
      'id, name, first_name, middle_name, last_name, email, role, region, verified_at, login_count',
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
router.post('/verify-otp', otpLimiter, authenticateToken, async (req, res) => {
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
router.post('/resend-device-otp', otpLimiter, async (req, res) => {
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

// DELETE /api/auth/account - Redirect to proper secure deletion flow
router.delete('/account', authenticateToken, async (req, res) => {
  // This endpoint is deprecated. Account deletion must go through the secure flow:
  // POST /api/profile/delete-account/verify-password
  // POST /api/profile/delete-account/verify-security
  // POST /api/profile/delete-account (with reason + OTP + confirmation)
  res.status(400).json({
    error: 'Account deletion must go through the secure deletion flow',
    steps: [
      'POST /api/profile/delete-account/verify-password',
      'POST /api/profile/delete-account/verify-security',
      'POST /api/profile/delete-account'
    ]
  });
});

module.exports = { router, authenticateToken };