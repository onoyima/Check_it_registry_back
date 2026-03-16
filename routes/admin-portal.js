// Admin Portal Routes - MySQL Version
const express = require('express');
const Database = require('../config');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Admin role check is handled by middleware

// Apply authentication and admin check to all routes
router.use(authenticateToken);
router.use(requireAdmin);

// GET /api/admin-portal/stats - Dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = {};

    // Total counts
    const [totalUsers] = await Database.query('SELECT COUNT(*) as count FROM users');
    const [totalDevices] = await Database.query('SELECT COUNT(*) as count FROM devices');
    const [totalReports] = await Database.query('SELECT COUNT(*) as count FROM reports');
    const [pendingVerifications] = await Database.query('SELECT COUNT(*) as count FROM devices WHERE status = ?', ['unverified']);

    stats.totalUsers = totalUsers.count;
    stats.totalDevices = totalDevices.count;
    stats.totalReports = totalReports.count;
    stats.pendingVerifications = pendingVerifications.count;

    // Device status breakdown
    const deviceStatuses = await Database.query(`
      SELECT status, COUNT(*) as count 
      FROM devices 
      GROUP BY status
    `);
    stats.devicesByStatus = deviceStatuses.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});

    // Report status breakdown
    const reportStatuses = await Database.query(`
      SELECT status, COUNT(*) as count 
      FROM reports 
      GROUP BY status
    `);
    stats.reportsByStatus = reportStatuses.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});

    // Recent activity (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const [recentDevices] = await Database.query(
      'SELECT COUNT(*) as count FROM devices WHERE created_at >= ?',
      [thirtyDaysAgo]
    );
    const [recentReports] = await Database.query(
      'SELECT COUNT(*) as count FROM reports WHERE created_at >= ?',
      [thirtyDaysAgo]
    );
    const [recentChecks] = await Database.query(
      'SELECT COUNT(*) as count FROM imei_checks WHERE created_at >= ?',
      [thirtyDaysAgo]
    );

    stats.recentActivity = {
      devices: recentDevices.count,
      reports: recentReports.count,
      publicChecks: recentChecks.count
    };

    // Top brands
    const topBrands = await Database.query(`
      SELECT brand, COUNT(*) as count 
      FROM devices 
      GROUP BY brand 
      ORDER BY count DESC 
      LIMIT 10
    `);
    stats.topBrands = topBrands;

    res.json(stats);
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin-portal/verification-queue - Devices pending verification
router.get('/verification-queue', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const devices = await Database.query(`
      SELECT 
        d.*,
        u.name as owner_name,
        u.email as owner_email,
        u.phone as owner_phone
      FROM devices d
      JOIN users u ON d.user_id = u.id
      WHERE d.status = 'unverified'
      ORDER BY d.created_at ASC
      LIMIT ? OFFSET ?
    `, [parseInt(limit), parseInt(offset)]);

    const [totalCount] = await Database.query(
      'SELECT COUNT(*) as count FROM devices WHERE status = ?',
      ['unverified']
    );

    res.json({
      devices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount.count,
        pages: Math.ceil(totalCount.count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching verification queue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin-portal/devices - List all devices with filters
router.get('/devices', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, category, search, brand, model } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params = [];

    if (status) {
      whereClause += ' AND d.status = ?';
      params.push(status);
    }

    if (category) {
      whereClause += ' AND d.category = ?';
      params.push(category);
    }

    if (brand) {
      whereClause += ' AND d.brand = ?';
      params.push(brand);
    }

    if (model) {
      whereClause += ' AND d.model LIKE ?';
      params.push(`%${model}%`);
    }

    if (search) {
      whereClause += ' AND (d.brand LIKE ? OR d.model LIKE ? OR d.imei LIKE ? OR d.serial LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const devices = await Database.query(`
      SELECT 
        d.*, 
        u.name as owner_name, 
        u.email as owner_email, 
        u.phone as owner_phone
      FROM devices d
      JOIN users u ON d.user_id = u.id
      WHERE ${whereClause}
      ORDER BY d.updated_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await Database.query(
      `SELECT COUNT(*) as count FROM devices d JOIN users u ON d.user_id = u.id WHERE ${whereClause}`,
      params
    );

    res.json({
      devices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount.count,
        pages: Math.ceil(totalCount.count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching admin devices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin-portal/reported-devices - Devices with active reports
router.get('/reported-devices', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const rows = await Database.query(`
      SELECT 
        d.id,
        d.brand,
        d.model,
        d.imei,
        d.serial,
        d.status,
        u.name AS owner_name,
        u.email AS owner_email,
        u.phone AS owner_phone,
        MAX(r.created_at) AS latest_report_at,
        SUBSTRING_INDEX(GROUP_CONCAT(r.report_type ORDER BY r.created_at DESC), ',', 1) AS latest_report_type,
        COUNT(*) AS report_count
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE r.status IN ('open','under_review')
      GROUP BY d.id
      ORDER BY latest_report_at DESC
      LIMIT ? OFFSET ?
    `, [parseInt(limit), parseInt(offset)]);

    const [totalCount] = await Database.query(`
      SELECT COUNT(DISTINCT r.device_id) AS count
      FROM reports r
      WHERE r.status IN ('open','under_review')
    `);

    res.json({
      devices: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount.count,
        pages: Math.ceil(totalCount.count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching reported devices (admin):', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin-portal/alerts/device-checks - Recent checks on reported devices
router.get('/alerts/device-checks', async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const rows = await Database.query(`
      SELECT 
        dcl.*, 
        d.brand, d.model, d.imei, d.serial,
        owner.name AS owner_name, owner.email AS owner_email, owner.phone AS owner_phone,
        checker.name AS checker_name, checker.email AS checker_email, checker.phone AS checker_phone
      FROM device_check_logs dcl
      LEFT JOIN devices d ON dcl.device_id = d.id
      LEFT JOIN users owner ON d.user_id = owner.id
      LEFT JOIN users checker ON dcl.checker_user_id = checker.id
      LEFT JOIN reports r ON r.device_id = d.id AND r.status IN ('open','under_review')
      WHERE r.id IS NOT NULL
      ORDER BY dcl.created_at DESC
      LIMIT ?
    `, [parseInt(limit)]);

    res.json({ alerts: rows });
  } catch (error) {
    console.error('Error fetching device check alerts (admin):', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin-portal/devices/:id - Admin edit device details and status
router.put('/devices/:id', async (req, res) => {
  try {
    const deviceId = req.params.id;
    const adminId = req.user.id;
    const {
      brand,
      model,
      color,
      category,
      imei,
      serial,
      device_image_url,
      proof_url,
      status
    } = req.body;

    const device = await Database.selectOne('devices', '*', 'id = ?', [deviceId]);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const updateData = { updated_at: new Date() };
    if (brand !== undefined) updateData.brand = brand;
    if (model !== undefined) updateData.model = model;
    if (color !== undefined) updateData.color = color;
    if (category !== undefined) updateData.category = category;
    if (imei !== undefined) updateData.imei = imei || null;
    if (serial !== undefined) updateData.serial = serial || null;
    if (device_image_url !== undefined) updateData.device_image_url = device_image_url || null;
    if (proof_url !== undefined) updateData.proof_url = proof_url || null;

    // Allow admins to set status to verified/unverified/found directly.
    // For stolen/lost, require filing a report via report-management to ensure proper workflow.
    if (status !== undefined) {
      const allowedDirectStatuses = ['verified', 'unverified', 'found'];
      if (!allowedDirectStatuses.includes(status)) {
        return res.status(400).json({ error: 'Status change to stolen/lost must be done via a report' });
      }
      updateData.status = status;
    }

    await Database.update('devices', updateData, 'id = ?', [deviceId]);

    // Log audit
    await Database.logAudit(
      adminId,
      'ADMIN_UPDATE_DEVICE',
      'devices',
      deviceId,
      { brand: device.brand, model: device.model, color: device.color, category: device.category, status: device.status },
      updateData,
      req.ip
    );

    const updatedDevice = await Database.selectOne('devices', '*', 'id = ?', [deviceId]);
    res.json(updatedDevice);
  } catch (error) {
    console.error('Error updating device (admin):', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin-portal/verify-device/:id - Verify device
router.post('/verify-device/:id', async (req, res) => {
  try {
    const deviceId = req.params.id;
    const adminId = req.user.id;
    const { approved, notes } = req.body;

    const device = await Database.selectOne('devices', '*', 'id = ?', [deviceId]);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const newStatus = approved ? 'verified' : 'unverified';
    const verifiedAt = approved ? new Date() : null;
    const verifiedBy = approved ? adminId : null;

    await Database.update('devices', {
      status: newStatus,
      verified_at: verifiedAt,
      verified_by: verifiedBy,
      updated_at: new Date()
    }, 'id = ?', [deviceId]);

    // Log audit
    await Database.logAudit(
      adminId,
      'VERIFY_DEVICE',
      'devices',
      deviceId,
      { status: device.status },
      { status: newStatus, verified_by: verifiedBy },
      req.ip
    );

    // Create notification for device owner
    const owner = await Database.selectOne('users', 'email', 'id = ?', [device.user_id]);
    
    await Database.insert('notifications', {
      id: Database.generateUUID(),
      user_id: device.user_id,
      channel: 'email',
      recipient: owner.email,
      subject: `Device Verification ${approved ? 'Approved' : 'Rejected'}`,
      message: approved 
        ? `Your device ${device.brand} ${device.model} has been verified and is now protected.`
        : `Your device ${device.brand} ${device.model} verification was rejected. ${notes || ''}`,
      payload: JSON.stringify({
        type: 'device_verification',
        device_id: deviceId,
        approved,
        notes
      }),
      status: 'pending',
      created_at: new Date()
    });

    const updatedDevice = await Database.selectOne('devices', '*', 'id = ?', [deviceId]);
    res.json(updatedDevice);
  } catch (error) {
    console.error('Error verifying device:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin-portal/resend-device-verification/:id - Resend ownership verification email
router.post('/resend-device-verification/:id', async (req, res) => {
  try {
    const deviceId = req.params.id;
    const adminId = req.user.id;

    const device = await Database.selectOne('devices', 'id, brand, model, user_id, status', 'id = ?', [deviceId]);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Get owner
    const owner = await Database.selectOne('users', 'id, name, email', 'id = ?', [device.user_id]);
    if (!owner || !owner.email) {
      return res.status(400).json({ error: 'Device owner email not available' });
    }

    // Generate verification link token (24h expiry via Database.generateJWT)
    const verifyToken = Database.generateJWT({ type: 'device_verify', device_id: device.id, user_id: device.user_id });
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    const verifyLink = `${FRONTEND_URL}/verify-device?token=${verifyToken}`;

    // Send email
    const NotificationService = require('../services/NotificationService');
    await NotificationService.sendEmailDirect(
      owner.email,
      'Reminder: Verify Your Device Ownership - Check It Registry',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #646cff; color: white; padding: 20px; text-align: center;">
            <h1>Verify Your Device</h1>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <p>Hello ${owner.name},</p>
            <p>This is a friendly reminder to verify ownership of your device: <strong>${device.brand} ${device.model}</strong>.</p>
            <p>
              <a href="${verifyLink}" style="display:inline-block;background:#646cff;color:white;padding:12px 18px;border-radius:6px;text-decoration:none;">Verify Ownership</a>
            </p>
            <p>If the button doesn’t work, copy and paste this link into your browser:</p>
            <p><a href="${verifyLink}">${verifyLink}</a></p>
            <p>If the device is already verified, you can ignore this message; the link will simply confirm the status.</p>
          </div>
          <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
            <p>This is an automated message from Check It Device Registry</p>
          </div>
        </div>
      `
    );

    // Log audit
    await Database.logAudit(
      adminId,
      'RESEND_DEVICE_VERIFICATION_EMAIL',
      'devices',
      device.id,
      null,
      { email_sent_to: owner.email },
      req.ip
    );

    res.json({ success: true, message: 'Verification email resent to owner' });
  } catch (error) {
    console.error('Error resending verification email:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

// GET /api/admin-portal/audit-logs - View audit logs
router.get('/audit-logs', async (req, res) => {
  try {
    const { page = 1, limit = 50, action, table_name, user_id } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    let whereParams = [];

    if (action) {
      whereClause += ' AND action = ?';
      whereParams.push(action);
    }

    if (table_name) {
      whereClause += ' AND table_name = ?';
      whereParams.push(table_name);
    }

    if (user_id) {
      whereClause += ' AND user_id = ?';
      whereParams.push(user_id);
    }

    const logs = await Database.query(`
      SELECT 
        al.*,
        u.name as user_name,
        u.email as user_email
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `, [...whereParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await Database.query(
      `SELECT COUNT(*) as count FROM audit_logs WHERE ${whereClause}`,
      whereParams
    );

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount.count,
        pages: Math.ceil(totalCount.count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin-portal/users - List all users
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, role, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    let whereParams = [];

    if (role) {
      whereClause += ' AND role = ?';
      whereParams.push(role);
    }

    if (search) {
      whereClause += ' AND (name LIKE ? OR email LIKE ?)';
      whereParams.push(`%${search}%`, `%${search}%`);
    }

    const users = await Database.query(`
      SELECT 
        id, name, email, role, region, verified_at, created_at,
        (SELECT COUNT(*) FROM devices WHERE user_id = users.id) as device_count,
        (SELECT COUNT(*) FROM reports WHERE reporter_id = users.id) as report_count
      FROM users
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [...whereParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await Database.query(
      `SELECT COUNT(*) as count FROM users WHERE ${whereClause}`,
      whereParams
    );

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount.count,
        pages: Math.ceil(totalCount.count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin-portal/users/:id/role - Update user role
router.put('/users/:id/role', async (req, res) => {
  try {
    const userId = req.params.id;
    const adminId = req.user.id;
    const { role } = req.body;

    if (!['user', 'business', 'admin', 'lea'].includes(role)) {
      return res.status(400).json({ 
        error: 'Invalid role. Must be user, business, admin, or lea' 
      });
    }

    const user = await Database.selectOne('users', 'role', 'id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await Database.update('users', {
      role,
      updated_at: new Date()
    }, 'id = ?', [userId]);

    // Log audit
    await Database.logAudit(
      adminId,
      'UPDATE_USER_ROLE',
      'users',
      userId,
      { role: user.role },
      { role },
      req.ip
    );

    const updatedUser = await Database.selectOne(
      'users',
      'id, name, email, role, region, verified_at, created_at',
      'id = ?',
      [userId]
    );

    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;