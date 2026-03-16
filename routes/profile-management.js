const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const Database = require('../config');
const { authenticateToken } = require('../middleware/auth');
const { 
  validateProfileUpdate, 
  validatePasswordChange, 
  validateAccountDeletion,
  sanitizeObject 
} = require('../utils/validation-helpers');
const router = express.Router();

// Configure multer for profile image uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/profiles');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `profile-${req.user.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
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
      `id, name, email, phone, region, role, profile_image_url, created_at, verified_at, 
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
    const { name, phone, region } = sanitizeObject(req.body);

    // Check if user exists
    const user = await Database.selectOne('users', 'id', 'id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user profile
    await Database.update(
      'users',
      { name, phone: phone || null, region: region || null, updated_at: new Date() },
      'id = ?',
      [req.user.id]
    );

    await logActivity(req.user.id, 'profile_updated', 'user', req.user.id, 
      'User updated their profile', req.ip, req.get('User-Agent'));

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Upload profile image
router.post('/profile/image', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const imageUrl = `/uploads/profiles/${req.file.filename}`;

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
    if (oldImageUrl && oldImageUrl.startsWith('/uploads/profiles/')) {
      const oldImagePath = path.join(__dirname, '../', oldImageUrl);
      try {
        await fs.unlink(oldImagePath);
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
router.put('/profile/notifications', authenticateToken, async (req, res) => {
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
router.put('/profile/password', authenticateToken, async (req, res) => {
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
router.put('/profile/2fa', authenticateToken, async (req, res) => {
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
router.get('/profile/activity', authenticateToken, async (req, res) => {
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

// Delete user account
router.delete('/profile', authenticateToken, async (req, res) => {
  try {
    // Validate input
    validateAccountDeletion(req.body);
    const { password } = req.body;

    // Get current password hash
    const user = await Database.selectOne(
      'users', 
      'password_hash, profile_image_url', 
      'id = ?', 
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Password is incorrect' });
    }

    // Log the account deletion
    await logActivity(req.user.id, 'account_deleted', 'user', req.user.id, 
      'User deleted their account', req.ip, req.get('User-Agent'));

    // Delete related data (cascade delete should handle most of this)
    await Database.query('DELETE FROM device_transfers WHERE from_user_id = ? OR to_user_id = ?', 
      [req.user.id, req.user.id]);
    await Database.query('DELETE FROM reports WHERE reporter_id = ?', [req.user.id]);
    await Database.query('DELETE FROM devices WHERE user_id = ?', [req.user.id]);
    await Database.query('DELETE FROM users WHERE id = ?', [req.user.id]);

    // Delete profile image if it exists
    const profileImageUrl = user.profile_image_url;
    if (profileImageUrl && profileImageUrl.startsWith('/uploads/profiles/')) {
      const imagePath = path.join(__dirname, '../', profileImageUrl);
      try {
        await fs.unlink(imagePath);
      } catch (error) {
        console.log('Could not delete profile image:', error.message);
      }
    }

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Export user data (GDPR compliance)
router.get('/profile/export', authenticateToken, async (req, res) => {
  try {
    // Get user data
    const userData = await Database.selectOne(
      'users',
      `id, name, email, phone, region, role, created_at, verified_at, last_login_at,
       email_notifications, sms_notifications, push_notifications`,
      'id = ?',
      [req.user.id]
    );

    // Get devices
    const devices = await Database.query(`
      SELECT brand, model, color, imei, serial, status, created_at
      FROM devices WHERE user_id = ?
    `, [req.user.id]);

    // Get reports
    const reports = await Database.query(`
      SELECT case_id, report_type, status, occurred_at, location, description, created_at
      FROM reports WHERE reporter_id = ?
    `, [req.user.id]);

    // Get activity logs (last 100)
    const activities = await Database.query(`
      SELECT action, resource_type, details, ip_address, created_at
      FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
    `, [req.user.id]);

    const exportData = {
      user: userData,
      devices,
      reports,
      recent_activities: activities,
      exported_at: new Date().toISOString()
    };

    await logActivity(req.user.id, 'data_exported', 'user', req.user.id, 
      'User exported their data', req.ip, req.get('User-Agent'));

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="user-data-${req.user.id}-${Date.now()}.json"`);
    res.json(exportData);
  } catch (error) {
    console.error('Error exporting user data:', error);
    res.status(500).json({ error: 'Failed to export user data' });
  }
});

// Update user preferences (theme, language, etc.)
router.put('/profile/preferences', authenticateToken, async (req, res) => {
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
router.get('/profile/recent-devices', authenticateToken, async (req, res) => {
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
router.get('/profile/recent-reports', authenticateToken, async (req, res) => {
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
router.put('/profile/privacy', authenticateToken, async (req, res) => {
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

module.exports = router;