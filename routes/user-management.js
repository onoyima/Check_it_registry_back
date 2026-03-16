// User Management Routes - Advanced Admin Features
const express = require('express');
const Database = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');
const NotificationService = require('../services/NotificationService');

const router = express.Router();

// All routes require admin access
router.use(authenticateToken);
router.use(requireRole(['admin']));

// Get all users with advanced filtering and pagination
router.get('/users', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      role, 
      region, 
      verified, 
      search, 
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    let whereClause = '1=1';
    let params = [];

    // Build filters
    if (role) {
      whereClause += ' AND u.role = ?';
      params.push(role);
    }

    if (region) {
      whereClause += ' AND u.region = ?';
      params.push(region);
    }

    if (verified === 'true') {
      whereClause += ' AND u.verified_at IS NOT NULL';
    } else if (verified === 'false') {
      whereClause += ' AND u.verified_at IS NULL';
    }

    if (search) {
      whereClause += ' AND (u.name LIKE ? OR u.email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // Validate sort parameters
    const validSortFields = ['name', 'email', 'role', 'region', 'created_at', 'verified_at'];
    const validSortOrders = ['ASC', 'DESC'];
    
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortDirection = validSortOrders.includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'DESC';

    const offset = (page - 1) * limit;

    const [users, totalCount] = await Promise.all([
      Database.query(`
        SELECT 
          u.*,
          COUNT(DISTINCT d.id) as device_count,
          COUNT(DISTINCT r.id) as report_count,
          MAX(d.created_at) as last_device_registration,
          MAX(r.created_at) as last_report_date
        FROM users u
        LEFT JOIN devices d ON u.id = d.user_id
        LEFT JOIN reports r ON d.id = r.device_id
        WHERE ${whereClause}
        GROUP BY u.id
        ORDER BY u.${sortField} ${sortDirection}
        LIMIT ? OFFSET ?
      `, [...params, parseInt(limit), offset]),

      Database.query(`
        SELECT COUNT(DISTINCT u.id) as total
        FROM users u
        WHERE ${whereClause}
      `, params)
    ]);

    // Remove password hashes from response
    const sanitizedUsers = users.map(user => {
      const { password_hash, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    res.json({
      success: true,
      users: sanitizedUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        pages: Math.ceil(totalCount[0].total / limit)
      },
      filters: {
        role,
        region,
        verified,
        search,
        sort_by: sortField,
        sort_order: sortDirection
      }
    });

  } catch (error) {
    console.error('User management error:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// Get detailed user profile
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const [userDetails, devices, reports, transfers, auditLogs] = await Promise.all([
      // User basic info
      Database.selectOne('users', '*', 'id = ?', [userId]),

      // User's devices
      Database.query(`
        SELECT 
          d.*,
          COUNT(r.id) as report_count,
          MAX(r.created_at) as last_report_date
        FROM devices d
        LEFT JOIN reports r ON d.id = r.device_id
        WHERE d.user_id = ?
        GROUP BY d.id
        ORDER BY d.created_at DESC
      `, [userId]),

      // User's reports
      Database.query(`
        SELECT 
          r.*,
          d.brand,
          d.model,
          d.imei,
          lea.agency_name
        FROM reports r
        JOIN devices d ON r.device_id = d.id
        LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
        WHERE d.user_id = ?
        ORDER BY r.created_at DESC
      `, [userId]),

      // User's transfers
      Database.query(`
        SELECT 
          dt.*,
          d.brand,
          d.model,
          from_user.name as from_user_name,
          to_user.name as to_user_name
        FROM device_transfers dt
        JOIN devices d ON dt.device_id = d.id
        LEFT JOIN users from_user ON dt.from_user_id = from_user.id
        LEFT JOIN users to_user ON dt.to_user_id = to_user.id
        WHERE dt.from_user_id = ? OR dt.to_user_id = ?
        ORDER BY dt.created_at DESC
        LIMIT 10
      `, [userId, userId]),

      // Recent audit logs
      Database.query(`
        SELECT *
        FROM audit_logs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 20
      `, [userId])
    ]);

    if (!userDetails) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove password hash
    const { password_hash, ...userWithoutPassword } = userDetails;

    res.json({
      success: true,
      user: userWithoutPassword,
      devices: devices,
      reports: reports,
      transfers: transfers,
      recent_activity: auditLogs
    });

  } catch (error) {
    console.error('User details error:', error);
    res.status(500).json({ error: 'Failed to retrieve user details' });
  }
});

// Update user role
router.put('/users/:userId/role', async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, reason } = req.body;

    const validRoles = ['user', 'business', 'admin', 'lea'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ 
        error: 'Invalid role',
        valid_roles: validRoles
      });
    }

    // Get current user details
    const user = await Database.selectOne('users', 'name, email, role', 'id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldRole = user.role;

    // Update user role
    await Database.update('users', {
      role: role,
      updated_at: new Date()
    }, 'id = ?', [userId]);

    // Log the role change
    await Database.logAudit(
      req.user.id,
      'USER_ROLE_CHANGE',
      'users',
      userId,
      { role: oldRole },
      { role: role, reason: reason },
      req.ip
    );

    // Send notification to user
    await NotificationService.queueNotification(
      userId,
      'email',
      user.email,
      'Account Role Updated',
      `
        <h2>Account Role Updated</h2>
        <p>Hello ${user.name},</p>
        <p>Your account role has been updated by an administrator.</p>
        <p><strong>Previous Role:</strong> ${oldRole}</p>
        <p><strong>New Role:</strong> ${role}</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p>This change may affect your access permissions in the system.</p>
        <p>If you have questions about this change, please contact support.</p>
      `,
      {
        type: 'role_change',
        old_role: oldRole,
        new_role: role
      }
    );

    res.json({
      success: true,
      message: 'User role updated successfully',
      user_id: userId,
      old_role: oldRole,
      new_role: role,
      updated_by: req.user.name
    });

  } catch (error) {
    console.error('Role update error:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// Update user region
router.put('/users/:userId/region', async (req, res) => {
  try {
    const { userId } = req.params;
    const { region, reason } = req.body;

    if (!region || region.trim().length === 0) {
      return res.status(400).json({ error: 'Region is required' });
    }

    // Get current user details
    const user = await Database.selectOne('users', 'name, email, region', 'id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldRegion = user.region;

    // Update user region
    await Database.update('users', {
      region: region.trim(),
      updated_at: new Date()
    }, 'id = ?', [userId]);

    // Log the region change
    await Database.logAudit(
      req.user.id,
      'USER_REGION_CHANGE',
      'users',
      userId,
      { region: oldRegion },
      { region: region, reason: reason },
      req.ip
    );

    res.json({
      success: true,
      message: 'User region updated successfully',
      user_id: userId,
      old_region: oldRegion,
      new_region: region,
      updated_by: req.user.name
    });

  } catch (error) {
    console.error('Region update error:', error);
    res.status(500).json({ error: 'Failed to update user region' });
  }
});

// Suspend/unsuspend user account
router.put('/users/:userId/suspend', async (req, res) => {
  try {
    const { userId } = req.params;
    const { suspended, reason } = req.body;

    // Get current user details
    const user = await Database.selectOne('users', 'name, email', 'id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // For now, we'll use a custom field or handle suspension logic
    // In a full implementation, you might add a 'suspended' column to users table
    
    // Log the suspension action
    await Database.logAudit(
      req.user.id,
      suspended ? 'USER_SUSPENDED' : 'USER_UNSUSPENDED',
      'users',
      userId,
      null,
      { suspended: suspended, reason: reason },
      req.ip
    );

    // Send notification to user
    await NotificationService.queueNotification(
      userId,
      'email',
      user.email,
      suspended ? 'Account Suspended' : 'Account Reactivated',
      suspended ? `
        <h2>Account Suspended</h2>
        <p>Hello ${user.name},</p>
        <p>Your account has been suspended by an administrator.</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p>If you believe this is an error, please contact support.</p>
      ` : `
        <h2>Account Reactivated</h2>
        <p>Hello ${user.name},</p>
        <p>Your account has been reactivated and you can now access the system normally.</p>
        ${reason ? `<p><strong>Note:</strong> ${reason}</p>` : ''}
      `,
      {
        type: suspended ? 'account_suspended' : 'account_reactivated'
      }
    );

    res.json({
      success: true,
      message: `User account ${suspended ? 'suspended' : 'reactivated'} successfully`,
      user_id: userId,
      suspended: suspended,
      updated_by: req.user.name
    });

  } catch (error) {
    console.error('User suspension error:', error);
    res.status(500).json({ error: 'Failed to update user suspension status' });
  }
});

// Reset user password
router.post('/users/:userId/reset-password', async (req, res) => {
  try {
    const { userId } = req.params;
    const { new_password, send_email = true } = req.body;

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters long' 
      });
    }

    // Get user details
    const user = await Database.selectOne('users', 'name, email', 'id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash new password
    const passwordHash = await Database.hashPassword(new_password);

    // Update password
    await Database.update('users', {
      password_hash: passwordHash,
      updated_at: new Date()
    }, 'id = ?', [userId]);

    // Log password reset
    await Database.logAudit(
      req.user.id,
      'PASSWORD_RESET_ADMIN',
      'users',
      userId,
      null,
      { reset_by_admin: true },
      req.ip
    );

    // Send notification to user if requested
    if (send_email) {
      await NotificationService.queueNotification(
        userId,
        'email',
        user.email,
        'Password Reset by Administrator',
        `
          <h2>Password Reset</h2>
          <p>Hello ${user.name},</p>
          <p>Your password has been reset by an administrator.</p>
          <p><strong>New Password:</strong> ${new_password}</p>
          <p><strong>Important:</strong> Please log in and change your password immediately for security.</p>
          <p>If you did not request this password reset, please contact support immediately.</p>
        `,
        {
          type: 'password_reset_admin'
        }
      );
    }

    res.json({
      success: true,
      message: 'Password reset successfully',
      user_id: userId,
      email_sent: send_email,
      reset_by: req.user.name
    });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset user password' });
  }
});

// Update basic user details (name, email, phone, region)
router.put('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, phone, region } = req.body;

    const updates = {};

    if (name && typeof name === 'string' && name.trim().length > 0) {
      updates.name = name.trim();
    }
    if (email && typeof email === 'string') {
      const emailTrimmed = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailTrimmed)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      // Ensure uniqueness
      const existing = await Database.selectOne('users', 'id', 'email = ? AND id <> ?', [emailTrimmed, userId]);
      if (existing) {
        return res.status(409).json({ error: 'Email already in use by another account' });
      }
      updates.email = emailTrimmed;
    }
    if (phone && typeof phone === 'string') {
      updates.phone = phone.trim();
    }
    if (region && typeof region === 'string') {
      updates.region = region.trim();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided to update' });
    }

    // Verify user exists
    const currentUser = await Database.selectOne('users', '*', 'id = ?', [userId]);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Perform update
    await Database.update('users', { ...updates, updated_at: new Date() }, 'id = ?', [userId]);

    // Log audit
    await Database.logAudit(
      req.user.id,
      'USER_DETAILS_UPDATE',
      'users',
      userId,
      {
        name: currentUser.name,
        email: currentUser.email,
        phone: currentUser.phone,
        region: currentUser.region
      },
      updates,
      req.ip
    );

    // Optionally notify user of changes
    if (updates.email || updates.name || updates.phone || updates.region) {
      await NotificationService.queueNotification(
        userId,
        'email',
        updates.email || currentUser.email,
        'Account Details Updated',
        `
          <h2>Account Details Updated</h2>
          <p>Hello ${updates.name || currentUser.name},</p>
          <p>Your account details have been updated by an administrator.</p>
          <p>If you did not request this change, please contact support immediately.</p>
        `,
        { type: 'account_details_updated', updated_fields: Object.keys(updates) }
      );
    }

    res.json({
      success: true,
      message: 'User details updated successfully',
      user_id: userId,
      updated_fields: Object.keys(updates)
    });
  } catch (error) {
    console.error('User update error:', error);
    res.status(500).json({ error: 'Failed to update user details' });
  }
});

// Get user statistics summary
router.get('/statistics', async (req, res) => {
  try {
    const stats = await Database.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN role = 'user' THEN 1 END) as regular_users,
        COUNT(CASE WHEN role = 'business' THEN 1 END) as business_users,
        COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_users,
        COUNT(CASE WHEN role = 'lea' THEN 1 END) as lea_users,
        COUNT(CASE WHEN verified_at IS NOT NULL THEN 1 END) as verified_users,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_users_week,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as new_users_month
      FROM users
    `);

    const regionStats = await Database.query(`
      SELECT 
        region,
        COUNT(*) as user_count,
        COUNT(CASE WHEN role = 'lea' THEN 1 END) as lea_count
      FROM users
      WHERE region IS NOT NULL
      GROUP BY region
      ORDER BY user_count DESC
    `);

    res.json({
      success: true,
      user_statistics: stats[0],
      regional_distribution: regionStats
    });

  } catch (error) {
    console.error('User statistics error:', error);
    res.status(500).json({ error: 'Failed to generate user statistics' });
  }
});

// Bulk operations
router.post('/bulk-operations', async (req, res) => {
  try {
    const { operation, user_ids, data } = req.body;

    if (!operation || !user_ids || !Array.isArray(user_ids)) {
      return res.status(400).json({ 
        error: 'Operation and user_ids array are required' 
      });
    }

    let results = [];

    switch (operation) {
      case 'update_region':
        if (!data.region) {
          return res.status(400).json({ error: 'Region is required for bulk region update' });
        }

        for (const userId of user_ids) {
          try {
            await Database.update('users', {
              region: data.region,
              updated_at: new Date()
            }, 'id = ?', [userId]);

            await Database.logAudit(
              req.user.id,
              'BULK_REGION_UPDATE',
              'users',
              userId,
              null,
              { new_region: data.region },
              req.ip
            );

            results.push({ user_id: userId, success: true });
          } catch (error) {
            results.push({ user_id: userId, success: false, error: error.message });
          }
        }
        break;

      case 'send_notification':
        if (!data.subject || !data.message) {
          return res.status(400).json({ error: 'Subject and message are required for bulk notification' });
        }

        for (const userId of user_ids) {
          try {
            const user = await Database.selectOne('users', 'email', 'id = ?', [userId]);
            if (user) {
              await NotificationService.queueNotification(
                userId,
                'email',
                user.email,
                data.subject,
                data.message,
                { type: 'bulk_notification', sent_by: req.user.name }
              );
              results.push({ user_id: userId, success: true });
            } else {
              results.push({ user_id: userId, success: false, error: 'User not found' });
            }
          } catch (error) {
            results.push({ user_id: userId, success: false, error: error.message });
          }
        }
        break;

      default:
        return res.status(400).json({ error: 'Invalid bulk operation' });
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      operation: operation,
      total_users: user_ids.length,
      successful: successCount,
      failed: failureCount,
      results: results,
      executed_by: req.user.name
    });

  } catch (error) {
    console.error('Bulk operations error:', error);
    res.status(500).json({ error: 'Failed to execute bulk operation' });
  }
});

module.exports = router;