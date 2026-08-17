const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const Database = require('../config');
const { authenticateToken } = require('../middleware/auth');
const ArchiveService = require('../services/ArchiveService');
const OTPService = require('../services/OTPService');
const { 
  validateProfileUpdate, 
  validatePasswordChange, 
  validateAccountDeletion,
  sanitizeObject 
} = require('../utils/validation-helpers');
const { getDisplayName, buildUserNameFields, nameSelectColumns } = require('../utils/user-helpers');
const router = express.Router();

// Configure multer for profile image uploads (memory storage for image processing)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Simple audit logging function
const logActivity = async (userId, action, resourceType, resourceId, details, ipAddress, userAgent) => {
  try {
    await Database.insert('audit_logs', {
      id: require('crypto').randomUUID(),
      user_id: userId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details,
      ip_address: ipAddress,
      user_agent: userAgent,
      severity: 'low',
      status: 'success',
      created_at: new Date()
    });
  } catch (error) {
    console.error('Audit logging error:', error);
  }
};

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    
    // Get user profile with stats
    const user = await Database.selectOne(
      'users',
      `id, ${nameSelectColumns()}, email, phone, region, role, profile_image_url, created_at, verified_at, 
       last_login_at, login_count, two_factor_enabled, email_notifications, 
       sms_notifications, push_notifications, device_alerts, transfer_notifications,
       verification_notifications, report_updates, marketing_emails, theme_preference,
       language_preference, timezone`,
      'id = ?',
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user statistics
    const deviceStats = await Database.query(`
      SELECT 
        COUNT(*) as total_devices,
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified_devices
      FROM devices 
      WHERE user_id = ?
    `, [req.user.id]);

    const reportStats = await Database.query(`
      SELECT 
        COUNT(*) as total_reports,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_reports
      FROM reports 
      WHERE reporter_id = ?
    `, [req.user.id]);

    const transferStats = await Database.query(`
      SELECT COUNT(*) as active_transfers
      FROM device_transfers 
      WHERE (from_user_id = ? OR to_user_id = ?) AND status = 'pending'
    `, [req.user.id, req.user.id]);

    const profile = {
      ...user,
      stats: {
        total_devices: deviceStats[0]?.total_devices || 0,
        verified_devices: deviceStats[0]?.verified_devices || 0,
        total_reports: reportStats[0]?.total_reports || 0,
        open_reports: reportStats[0]?.open_reports || 0,
        active_transfers: transferStats[0]?.active_transfers || 0
      }
    };

    await logActivity(req.user.id, 'profile_viewed', 'user', req.user.id, 
      'User viewed their profile', req.ip, req.get('User-Agent'));

    res.json({ profile });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    // Validate and sanitize input
    validateProfileUpdate(req.body);
    const { phone, region } = sanitizeObject(req.body);
    const nameFields = buildUserNameFields(sanitizeObject(req.body));

    // Check if user exists
    const user = await Database.selectOne('users', 'id', 'id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user profile
    await Database.update(
      'users',
      { ...nameFields, phone: phone || null, region: region || null, updated_at: new Date() },
      'id = ?',
      [req.user.id]
    );

    await logActivity(req.user.id, 'profile_updated', 'user', req.user.id, 
      'User updated their profile', req.ip, req.get('User-Agent'));

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Error updating profile:', error);
    if (error.details) {
      return res.status(400).json({ error: 'Validation failed', details: error.details });
    }
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Upload profile image
router.post('/image', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const FileUploadService = require('../services/FileUploadService');
    const result = await FileUploadService.processSingleFile(
      req.file.buffer, req.file.originalname, req.file.mimetype, 'profile_image', req.user.id
    );

    const imageUrl = result.url;

    // Get current profile image to delete old one
    const user = await Database.selectOne('users', 'profile_image_url', 'id = ?', [req.user.id]);
    const oldImageUrl = user?.profile_image_url;

    // Update user profile image
    await Database.update(
      'users',
      { profile_image_url: imageUrl, updated_at: new Date() },
      'id = ?',
      [req.user.id]
    );

    // Delete old image file if it exists
    if (oldImageUrl && oldImageUrl.startsWith('/uploads/')) {
      try {
        await FileUploadService.deleteByUrl(oldImageUrl);
      } catch (error) {
        console.log('Could not delete old image:', error.message);
      }
    }

    await logActivity(req.user.id, 'profile_image_updated', 'user', req.user.id, 
      'User updated their profile image', req.ip, req.get('User-Agent'));

    res.json({ 
      message: 'Profile image updated successfully',
      image_url: imageUrl
    });
  } catch (error) {
    console.error('Error uploading profile image:', error);
    res.status(500).json({ error: 'Failed to upload profile image' });
  }
});

// Update notification preferences
router.put('/notifications', authenticateToken, async (req, res) => {
  try {
    const {
      email_notifications,
      sms_notifications,
      push_notifications,
      device_alerts,
      transfer_notifications,
      verification_notifications,
      report_updates,
      marketing_emails
    } = req.body;

    await Database.update(
      'users',
      {
        email_notifications: email_notifications || false,
        sms_notifications: sms_notifications || false,
        push_notifications: push_notifications || false,
        device_alerts: device_alerts || false,
        transfer_notifications: transfer_notifications || false,
        verification_notifications: verification_notifications || false,
        report_updates: report_updates || false,
        marketing_emails: marketing_emails || false,
        updated_at: new Date()
      },
      'id = ?',
      [req.user.id]
    );

    await logActivity(req.user.id, 'notification_preferences_updated', 'user', req.user.id, 
      'User updated notification preferences', req.ip, req.get('User-Agent'));

    res.json({ message: 'Notification preferences updated successfully' });
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

// Change password
router.put('/password', authenticateToken, async (req, res) => {
  try {
    // Validate input
    validatePasswordChange(req.body);
    const { currentPassword, newPassword } = req.body;

    // Get current password hash
    const user = await Database.selectOne('users', 'password_hash', 'id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      await logActivity(req.user.id, 'password_change_failed', 'auth', req.user.id, 
        'Failed password change attempt - invalid current password', req.ip, req.get('User-Agent'));
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await Database.update(
      'users',
      { password_hash: newPasswordHash, updated_at: new Date() },
      'id = ?',
      [req.user.id]
    );

    await logActivity(req.user.id, 'password_changed', 'auth', req.user.id, 
      'User successfully changed their password', req.ip, req.get('User-Agent'));

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Enable/disable two-factor authentication
router.put('/2fa', authenticateToken, async (req, res) => {
  try {
    const { enabled } = req.body;

    await Database.update(
      'users',
      { two_factor_enabled: enabled || false, updated_at: new Date() },
      'id = ?',
      [req.user.id]
    );

    await logActivity(req.user.id, 'two_factor_toggled', 'security', req.user.id, 
      `Two-factor authentication ${enabled ? 'enabled' : 'disabled'}`, req.ip, req.get('User-Agent'));

    res.json({ 
      message: `Two-factor authentication ${enabled ? 'enabled' : 'disabled'} successfully` 
    });
  } catch (error) {
    console.error('Error updating 2FA:', error);
    res.status(500).json({ error: 'Failed to update two-factor authentication' });
  }
});

// Get user activity log
router.get('/activity', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const activities = await Database.query(`
      SELECT 
        id,
        action,
        resource_type,
        resource_id,
        details,
        ip_address,
        user_agent,
        created_at
      FROM audit_logs 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [req.user.id, limit, offset]);

    const countResult = await Database.query(
      'SELECT COUNT(*) as total FROM audit_logs WHERE user_id = ?',
      [req.user.id]
    );

    res.json({
      activities,
      pagination: {
        page,
        limit,
        total: countResult[0]?.total || 0,
        pages: Math.ceil((countResult[0]?.total || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({ error: 'Failed to fetch user activity' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ACCOUNT DELETION (Secure: password → security question → reason → OTP → soft-delete)
// ═══════════════════════════════════════════════════════════════

// Step 1: Verify password before starting deletion flow
router.post('/delete-account/verify-password', authenticateToken, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required' });
    const user = await Database.queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Incorrect password' });
    const hasQuestion = await ArchiveService.hasSecurityQuestion(req.user.id);
    const question = await ArchiveService.getSecurityQuestion(req.user.id);
    res.json({ success: true, hasSecurityQuestion: hasQuestion, question: question?.question || null });
  } catch (error) {
    console.error('Delete account verify password error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Step 2: Verify security question
router.post('/delete-account/verify-security', authenticateToken, async (req, res) => {
  try {
    const { answer } = req.body;
    if (!answer) return res.status(400).json({ error: 'Security answer is required' });
    const result = await ArchiveService.verifySecurityQuestion(req.user.id, answer);
    if (!result.verified) return res.status(400).json({ error: result.error });
    // Send OTP for deletion
    await OTPService.createOTP(req.user.id, 'account_deletion', null, 10);
    const user = await Database.queryOne('SELECT phone, email FROM users WHERE id = ?', [req.user.id]);
    const maskedPhone = user?.phone ? user.phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2') : null;
    res.json({ success: true, otpSent: true, maskedPhone, message: 'OTP sent to your registered phone' });
  } catch (error) {
    console.error('Delete account verify security error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Step 3: Resend OTP for deletion
router.post('/delete-account/resend-otp', authenticateToken, async (req, res) => {
  try {
    await OTPService.createOTP(req.user.id, 'account_deletion', null, 10);
    res.json({ success: true, message: 'OTP resent' });
  } catch (error) {
    console.error('Delete account resend OTP error:', error);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

// Step 4: Final deletion (requires reason + OTP + confirmation text)
router.post('/delete-account', authenticateToken, async (req, res) => {
  try {
    const { reason, otpCode, confirmText } = req.body;
    if (!reason) return res.status(400).json({ error: 'Deletion reason is required' });
    if (!otpCode) return res.status(400).json({ error: 'OTP verification is required' });
    if (confirmText !== 'DELETE_MY_ACCOUNT') {
      return res.status(400).json({ error: 'Please type DELETE_MY_ACCOUNT to confirm' });
    }
    // Verify OTP
    const otpResult = await OTPService.verifyOTP(req.user.id, 'account_deletion', otpCode);
    if (!otpResult.success) {
      return res.status(400).json({ error: otpResult.error || 'Invalid OTP' });
    }
    // Perform soft delete
    const result = await ArchiveService.softDeleteUser(
      req.user.id, reason, true, true, req.user.id
    );
    res.json({
      success: true,
      message: 'Account has been deleted. Your data has been archived for administrative purposes.',
      archiveId: result.archiveId
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete account' });
  }
});

// Setup security question
router.post('/security-question', authenticateToken, async (req, res) => {
  try {
    const { question, answer } = req.body;
    if (!question || !answer) return res.status(400).json({ error: 'Question and answer are required' });
    const result = await ArchiveService.setupSecurityQuestion(req.user.id, question, answer);
    res.json({ success: true, message: 'Security question configured', question: result.question });
  } catch (error) {
    console.error('Setup security question error:', error);
    res.status(500).json({ error: 'Failed to setup security question' });
  }
});

// Get my security question status
router.get('/security-question', authenticateToken, async (req, res) => {
  try {
    const has = await ArchiveService.hasSecurityQuestion(req.user.id);
    const question = await ArchiveService.getSecurityQuestion(req.user.id);
    res.json({ configured: has, question: question?.question || null });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch security question' });
  }
});

// Data export - immediate JSON download
router.get('/export', authenticateToken, async (req, res) => {
  try {
    const { type } = req.query;
    const exportType = type || 'full';
    const data = await ArchiveService.generateUserDataExport(req.user.id, exportType);
    await ArchiveService.logExportAudit(
      req.user.id, exportType, 'completed', null, 0, req.ip, req.get('User-Agent')
    );
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="prove-ownership-export-${exportType}-${Date.now()}.json"`);
    res.json(data);
  } catch (error) {
    console.error('Data export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Update user preferences (theme, language, etc.)
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const { theme_preference, language_preference, timezone } = req.body;

    const updateData = {};
    if (theme_preference) updateData.theme_preference = theme_preference;
    if (language_preference) updateData.language_preference = language_preference;
    if (timezone) updateData.timezone = timezone;
    updateData.updated_at = new Date();

    await Database.update('users', updateData, 'id = ?', [req.user.id]);

    await logActivity(req.user.id, 'preferences_updated', 'user', req.user.id, 
      'User updated their preferences', req.ip, req.get('User-Agent'));

    res.json({ message: 'Preferences updated successfully' });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Get user's recent devices
router.get('/recent-devices', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;

    const devices = await Database.query(`
      SELECT id, brand, model, status, created_at, verified_at
      FROM devices 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [req.user.id, limit]);

    res.json({ devices });
  } catch (error) {
    console.error('Error fetching recent devices:', error);
    res.status(500).json({ error: 'Failed to fetch recent devices' });
  }
});

// Get user's recent reports
router.get('/recent-reports', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;

    const reports = await Database.query(`
      SELECT r.id, r.case_id, r.report_type, r.status, r.created_at, d.brand, d.model
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      WHERE r.reporter_id = ?
      ORDER BY r.created_at DESC
      LIMIT ?
    `, [req.user.id, limit]);

    res.json({ reports });
  } catch (error) {
    console.error('Error fetching recent reports:', error);
    res.status(500).json({ error: 'Failed to fetch recent reports' });
  }
});

// Update user's privacy settings
router.put('/privacy', authenticateToken, async (req, res) => {
  try {
    const {
      profile_visibility,
      show_online_status,
      allow_contact_from_strangers,
      data_sharing_consent,
      analytics_consent
    } = req.body;

    const updateData = {
      profile_visibility: profile_visibility || 'private',
      show_online_status: show_online_status || false,
      allow_contact_from_strangers: allow_contact_from_strangers || false,
      data_sharing_consent: data_sharing_consent || false,
      analytics_consent: analytics_consent !== undefined ? analytics_consent : true,
      updated_at: new Date()
    };

    await Database.update('users', updateData, 'id = ?', [req.user.id]);

    await logActivity(req.user.id, 'privacy_settings_updated', 'user', req.user.id, 
      'User updated privacy settings', req.ip, req.get('User-Agent'));

    res.json({ message: 'Privacy settings updated successfully' });
  } catch (error) {
    console.error('Error updating privacy settings:', error);
    res.status(500).json({ error: 'Failed to update privacy settings' });
  }
});

// Update user profile (name, phone, region)
router.put('/update', authenticateToken, async (req, res) => {
  try {
    const { phone, region } = req.body;
    const nameFields = buildUserNameFields(req.body);
    const updateData = { ...nameFields, updated_at: new Date() };
    if (phone !== undefined) updateData.phone = phone;
    if (region !== undefined) updateData.region = region;

    await Database.update('users', updateData, 'id = ?', [req.user.id]);
    const user = await Database.selectOne('users', `id, ${nameSelectColumns()}, email, phone, region, role`, 'id = ?', [req.user.id]);
    res.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get user profile stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [[{ deviceCount }]] = await Database.query(
      'SELECT COUNT(*) as deviceCount FROM devices WHERE user_id = ?', [userId]
    );
    const [[{ reportCount }]] = await Database.query(
      'SELECT COUNT(*) as reportCount FROM reports WHERE reporter_id = ?', [userId]
    );
    const [[{ transferCount }]] = await Database.query(
      'SELECT COUNT(*) as transferCount FROM ownership_transfers WHERE from_user_id = ? OR to_user_id = ?', [userId, userId]
    );
    const [[{ listingCount }]] = await Database.query(
      'SELECT COUNT(*) as listingCount FROM marketplace_listings WHERE seller_id = ?', [userId]
    );
    const user = await Database.selectOne('users', 'created_at', 'id = ?', [userId]);

    res.json({
      stats: {
        devices: deviceCount,
        reports: reportCount,
        transfers: transferCount,
        listings: listingCount,
        memberSince: user?.created_at
      }
    });
  } catch (error) {
    console.error('Error fetching profile stats:', error);
    res.status(500).json({ error: 'Failed to fetch profile stats' });
  }
});

// Get user preferences
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const rows = await Database.query(`
      SELECT
        email_notifications, sms_notifications, push_notifications,
        device_alerts, transfer_notifications, verification_notifications,
        report_updates, marketing_emails,
        theme_preference, language_preference, timezone,
        two_factor_enabled, session_timeout, auto_logout_enabled
      FROM users WHERE id = ?
    `, [req.user.id]);
    res.json({ preferences: rows[0] || {} });
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

module.exports = router;