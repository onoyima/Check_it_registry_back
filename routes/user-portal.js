// Enhanced User Portal Routes - Complete User Features
const express = require('express');
const Database = require('../config');
const { authenticateToken } = require('../middleware/auth');
const NotificationService = require('../services/NotificationService');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Security middleware - Log user actions
router.use(async (req, res, next) => {
  try {
    await Database.logAudit(
      req.user.id,
      `USER_${req.method}_${req.path.replace(/\//g, '_').toUpperCase()}`,
      'user_portal',
      null,
      null,
      {
        method: req.method,
        path: req.path,
        query: req.query,
        user_agent: req.get('User-Agent')
      },
      req.ip
    );
  } catch (error) {
    console.error('User audit logging error:', error);
  }
  next();
});

// ==================== USER DASHBOARD ====================
// Quick user search for autocomplete (name/email)
// GET /api/user-portal/search-users?q=term
router.get('/search-users', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q || q.length < 2) {
      return res.json({ users: [] });
    }

    // Exclude current user and limit results
    const users = await Database.query(
      `SELECT id, name, email
       FROM users
       WHERE id <> ? AND (email LIKE ? OR name LIKE ?)
       ORDER BY name ASC
       LIMIT 10`,
      [req.user.id, `%${q}%`, `%${q}%`]
    );

    res.json({ users });

  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Enhanced user dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's devices with detailed info
    const devices = await Database.query(`
      SELECT 
        d.*,
        CASE 
          WHEN d.status = 'verified' THEN 'Protected'
          WHEN d.status = 'unverified' THEN 'Pending Verification'
          WHEN d.status = 'stolen' THEN 'Reported Stolen'
          WHEN d.status = 'lost' THEN 'Reported Lost'
          WHEN d.status = 'found' THEN 'Found'
          WHEN d.status = 'pending_transfer' THEN 'Transfer Pending'
          ELSE d.status
        END as status_display,
        v.name as verified_by_name,
        DATEDIFF(NOW(), d.created_at) as days_registered
      FROM devices d
      LEFT JOIN users v ON d.verified_by = v.id
      WHERE d.user_id = ?
      ORDER BY d.created_at DESC
    `, [userId]);

    // Get user's reports
    const reports = await Database.query(`
      SELECT 
        r.*,
        d.brand, d.model, d.imei,
        lea.agency_name,
        DATEDIFF(NOW(), r.created_at) as days_since_report
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE r.reporter_id = ? OR d.user_id = ?
      ORDER BY r.created_at DESC
    `, [userId, userId]);

    // Get transfer history
    const transfers = await Database.query(`
      SELECT 
        dt.*,
        d.brand, d.model, d.imei,
        from_user.name as from_user_name,
        to_user.name as to_user_name,
        CASE 
          WHEN dt.from_user_id = ? THEN 'sent'
          WHEN dt.to_user_id = ? THEN 'received'
        END as transfer_direction
      FROM device_transfers dt
      JOIN devices d ON dt.device_id = d.id
      JOIN users from_user ON dt.from_user_id = from_user.id
      JOIN users to_user ON dt.to_user_id = to_user.id
      WHERE dt.from_user_id = ? OR dt.to_user_id = ?
      ORDER BY dt.created_at DESC
      LIMIT 10
    `, [userId, userId, userId, userId]);

    // Get recent notifications
    const notifications = await Database.query(`
      SELECT id, subject, message, status, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `, [userId]);

    // Calculate statistics
    const stats = {
      total_devices: devices.length,
      verified_devices: devices.filter(d => d.status === 'verified').length,
      pending_devices: devices.filter(d => d.status === 'unverified').length,
      protected_devices: devices.filter(d => ['verified', 'stolen', 'lost'].includes(d.status)).length,
      total_reports: reports.length,
      open_reports: reports.filter(r => r.status === 'open').length,
      resolved_reports: reports.filter(r => r.status === 'resolved').length,
      pending_transfers: transfers.filter(t => t.status === 'pending').length
    };

    res.json({
      success: true,
      data: {
        user: {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role,
          region: req.user.region
        },
        statistics: stats,
        devices: devices,
        reports: reports,
        transfers: transfers,
        notifications: notifications
      }
    });

  } catch (error) {
    console.error('User dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ==================== DEVICE MANAGEMENT ====================

// Get user's devices with filtering
router.get('/devices', async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, brand, search, page = 1, limit = 20 } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'd.user_id = ?';
    let whereParams = [userId];

    if (status) {
      whereClause += ' AND d.status = ?';
      whereParams.push(status);
    }

    if (brand) {
      whereClause += ' AND d.brand = ?';
      whereParams.push(brand);
    }

    if (search) {
      whereClause += ' AND (d.brand LIKE ? OR d.model LIKE ? OR d.imei LIKE ? OR d.serial LIKE ?)';
      whereParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const devices = await Database.query(`
      SELECT 
        d.*,
        v.name as verified_by_name,
        v.email as verified_by_email,
        DATEDIFF(NOW(), d.created_at) as days_registered,
        (SELECT COUNT(*) FROM reports WHERE device_id = d.id) as report_count,
        (SELECT MAX(created_at) FROM reports WHERE device_id = d.id) as last_report_date
      FROM devices d
      LEFT JOIN users v ON d.verified_by = v.id
      WHERE ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `, [...whereParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await Database.query(
      `SELECT COUNT(*) as count FROM devices d WHERE ${whereClause}`,
      whereParams
    );

    res.json({
      success: true,
      data: {
        devices,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount.count,
          pages: Math.ceil(totalCount.count / limit)
        }
      }
    });

  } catch (error) {
    console.error('User devices error:', error);
    res.status(500).json({ error: 'Failed to load devices' });
  }
});

// Get device details with full history
router.get('/devices/:id', async (req, res) => {
  try {
    const deviceId = req.params.id;
    const userId = req.user.id;

    // Get device details (select first row)
    const [device] = await Database.query(`
      SELECT 
        d.*,
        v.name as verified_by_name,
        v.email as verified_by_email
      FROM devices d
      LEFT JOIN users v ON d.verified_by = v.id
      WHERE d.id = ? AND d.user_id = ?
      LIMIT 1
    `, [deviceId, userId]);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Get device reports
    const reports = await Database.query(`
      SELECT 
        r.*,
        lea.agency_name,
        lea.contact_email as lea_email,
        lea.contact_phone as lea_phone
      FROM reports r
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE r.device_id = ?
      ORDER BY r.created_at DESC
    `, [deviceId]);

    // Get transfer history
    const transfers = await Database.query(`
      SELECT 
        dt.*,
        from_user.name as from_user_name,
        from_user.email as from_user_email,
        to_user.name as to_user_name,
        to_user.email as to_user_email
      FROM device_transfers dt
      JOIN users from_user ON dt.from_user_id = from_user.id
      JOIN users to_user ON dt.to_user_id = to_user.id
      WHERE dt.device_id = ?
      ORDER BY dt.created_at DESC
    `, [deviceId]);

    // Get verification history
    const verificationHistory = await Database.query(`
      SELECT 
        dvh.*,
        u.name as verified_by_name
      FROM device_verification_history dvh
      JOIN users u ON dvh.verified_by = u.id
      WHERE dvh.device_id = ?
      ORDER BY dvh.created_at DESC
    `, [deviceId]);

    // Get device check history (using device_check_logs)
    let checkHistory = [];
    try {
      checkHistory = await Database.query(`
        SELECT 
          dc.*, 
          u.name AS checker_name,
          u.email AS checker_email
        FROM device_check_logs dc
        LEFT JOIN users u ON dc.checker_user_id = u.id
        WHERE dc.device_id = ?
        ORDER BY dc.created_at DESC
        LIMIT 50
      `, [deviceId]);
    } catch (e) {
      checkHistory = [];
    }

    res.json({
      success: true,
      data: {
        device,
        reports,
        transfers,
        verification_history: verificationHistory,
        check_history: checkHistory,
        can_transfer: device.status === 'verified' && !transfers.some(t => t.status === 'pending'),
        can_report: ['verified', 'unverified'].includes(device.status)
      }
    });

  } catch (error) {
    console.error('Device details error:', error);
    res.status(500).json({ error: 'Failed to load device details' });
  }
});

// Update device information
router.put('/devices/:id', async (req, res) => {
  try {
    const deviceId = req.params.id;
    const userId = req.user.id;
    const { brand, model, color, device_image_url } = req.body;

    // Check ownership
    const device = await Database.selectOne('devices', '*', 'id = ? AND user_id = ?', [deviceId, userId]);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Only allow updates for unverified devices or specific fields for verified devices
    if (device.status === 'verified') {
      // For verified devices, only allow color and image updates
      const allowedUpdates = {};
      if (color) allowedUpdates.color = color;
      if (device_image_url) allowedUpdates.device_image_url = device_image_url;
      allowedUpdates.updated_at = new Date();

      if (Object.keys(allowedUpdates).length === 1) { // Only updated_at
        return res.status(400).json({ 
          error: 'Only color and image can be updated for verified devices' 
        });
      }

      await Database.update('devices', allowedUpdates, 'id = ?', [deviceId]);
    } else {
      // For unverified devices, allow all updates
      const updateData = { updated_at: new Date() };
      if (brand) updateData.brand = brand;
      if (model) updateData.model = model;
      if (color) updateData.color = color;
      if (device_image_url) updateData.device_image_url = device_image_url;

      await Database.update('devices', updateData, 'id = ?', [deviceId]);
    }

    // Log the update
    await Database.logAudit(
      userId,
      'UPDATE_DEVICE',
      'devices',
      deviceId,
      { brand: device.brand, model: device.model, color: device.color },
      { brand, model, color, device_image_url },
      req.ip
    );

    const updatedDevice = await Database.selectOne('devices', '*', 'id = ?', [deviceId]);

    res.json({
      success: true,
      data: updatedDevice,
      message: 'Device updated successfully'
    });

  } catch (error) {
    console.error('Device update error:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

// ==================== REPORT MANAGEMENT ====================

// Get user's reports
router.get('/reports', async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, type, page = 1, limit = 20 } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = '(r.reporter_id = ? OR d.user_id = ?)';
    let whereParams = [userId, userId];

    if (status) {
      whereClause += ' AND r.status = ?';
      whereParams.push(status);
    }

    if (type) {
      whereClause += ' AND r.report_type = ?';
      whereParams.push(type);
    }

    const reports = await Database.query(`
      SELECT 
        r.*,
        d.brand, d.model, d.imei, d.serial,
        lea.agency_name,
        lea.contact_email as lea_email,
        lea.contact_phone as lea_phone,
        DATEDIFF(NOW(), r.created_at) as days_since_report,
        CASE 
          WHEN r.reporter_id = ? THEN 'filed_by_me'
          WHEN d.user_id = ? THEN 'my_device'
          ELSE 'other'
        END as relation_type
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, userId, ...whereParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await Database.query(
      `SELECT COUNT(*) as count FROM reports r 
       JOIN devices d ON r.device_id = d.id 
       WHERE ${whereClause}`,
      whereParams
    );

    res.json({
      success: true,
      data: {
        reports,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount.count,
          pages: Math.ceil(totalCount.count / limit)
        }
      }
    });

  } catch (error) {
    console.error('User reports error:', error);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

// Get report details
router.get('/reports/:caseId', async (req, res) => {
  try {
    const caseId = req.params.caseId;
    const userId = req.user.id;

    const report = await Database.query(`
      SELECT 
        r.*,
        d.brand, d.model, d.imei, d.serial, d.color, d.device_image_url,
        owner.name as owner_name, owner.email as owner_email,
        lea.agency_name, lea.contact_email as lea_email, lea.contact_phone as lea_phone,
        lea.address as lea_address
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users owner ON d.user_id = owner.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      WHERE r.case_id = ? AND (r.reporter_id = ? OR d.user_id = ?)
    `, [caseId, userId, userId]);

    if (report.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Get report updates/timeline
    const timeline = await Database.query(`
      SELECT 
        al.action, al.new_values, al.created_at,
        u.name as updated_by_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.table_name = 'reports' AND al.record_id = ?
      ORDER BY al.created_at ASC
    `, [report[0].id]);

    res.json({
      success: true,
      data: {
        report: report[0],
        timeline: timeline,
        can_update: report[0].status === 'open' && report[0].reporter_id === userId
      }
    });

  } catch (error) {
    console.error('Report details error:', error);
    res.status(500).json({ error: 'Failed to load report details' });
  }
});

// Update report (add additional information)
router.put('/reports/:caseId', async (req, res) => {
  try {
    const caseId = req.params.caseId;
    const userId = req.user.id;
    const { additional_info, evidence_url } = req.body;

    const report = await Database.selectOne('reports', '*', 'case_id = ? AND reporter_id = ?', [caseId, userId]);
    if (!report) {
      return res.status(404).json({ error: 'Report not found or access denied' });
    }

    if (report.status !== 'open') {
      return res.status(400).json({ error: 'Cannot update closed reports' });
    }

    const updateData = { updated_at: new Date() };
    
    if (additional_info) {
      updateData.description = `${report.description}\n\n[UPDATE] ${additional_info}`;
    }
    
    if (evidence_url) {
      updateData.evidence_url = evidence_url;
    }

    await Database.update('reports', updateData, 'case_id = ?', [caseId]);

    // Log the update
    await Database.logAudit(
      userId,
      'UPDATE_REPORT',
      'reports',
      report.id,
      { description: report.description, evidence_url: report.evidence_url },
      updateData,
      req.ip
    );

    res.json({
      success: true,
      message: 'Report updated successfully',
      case_id: caseId
    });

  } catch (error) {
    console.error('Report update error:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// ==================== PROFILE MANAGEMENT ====================

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const userId = req.user.id;

    const profile = await Database.selectOne(`
      SELECT 
        id, name, email, phone, region, role, verified_at, created_at,
        (SELECT COUNT(*) FROM devices WHERE user_id = ?) as device_count,
        (SELECT COUNT(*) FROM reports WHERE reporter_id = ?) as report_count,
        (SELECT COUNT(*) FROM device_transfers WHERE from_user_id = ? OR to_user_id = ?) as transfer_count
      FROM users 
      WHERE id = ?
    `, [userId, userId, userId, userId, userId]);

    // Get recent activity
    const recentActivity = await Database.query(`
      SELECT action, table_name, created_at
      FROM audit_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [userId]);

    // Check if user is suspended
    const suspension = await Database.selectOne(`
      SELECT reason, expires_at, created_at
      FROM user_suspensions
      WHERE user_id = ? AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
    `, [userId]);

    res.json({
      success: true,
      data: {
        profile,
        recent_activity: recentActivity,
        is_suspended: !!suspension,
        suspension_info: suspension
      }
    });

  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, phone, region } = req.body;

    const user = await Database.selectOne('users', '*', 'id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updateData = { updated_at: new Date() };
    if (name && name.trim().length >= 2) updateData.name = name.trim();
    if (phone) updateData.phone = phone.trim();
    if (region) updateData.region = region.trim();

    await Database.update('users', updateData, 'id = ?', [userId]);

    // Log the update
    await Database.logAudit(
      userId,
      'UPDATE_PROFILE',
      'users',
      userId,
      { name: user.name, phone: user.phone, region: user.region },
      updateData,
      req.ip
    );

    const updatedUser = await Database.selectOne(
      'users',
      'id, name, email, phone, region, role, verified_at, created_at',
      'id = ?',
      [userId]
    );

    res.json({
      success: true,
      data: updatedUser,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ==================== NOTIFICATIONS ====================

// Get user notifications
router.get('/notifications', async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, status } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'user_id = ?';
    let whereParams = [userId];

    if (status) {
      whereClause += ' AND status = ?';
      whereParams.push(status);
    }

    const notifications = await Database.query(`
      SELECT id, channel, subject, message, status, sent_at, created_at
      FROM notifications
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [...whereParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await Database.query(
      `SELECT COUNT(*) as count FROM notifications WHERE ${whereClause}`,
      whereParams
    );

    res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount.count,
          pages: Math.ceil(totalCount.count / limit)
        }
      }
    });

  } catch (error) {
    console.error('Notifications error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

module.exports = router;
// Search users by email/name (for transfer suggestions)
router.get('/search-users', async (req, res) => {
  try {
    const { q = '' } = req.query;
    const query = String(q).trim();

    if (!query || query.length < 2) {
      return res.json({ success: true, users: [] });
    }

    // Limit suggestions and exclude sensitive fields
    const users = await Database.query(
      `SELECT id, name, email FROM users 
       WHERE email LIKE ? OR name LIKE ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [`%${query}%`, `%${query}%`]
    );

    res.json({ success: true, users });
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});