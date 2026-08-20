// Device Management Routes - MySQL Version
// Replaces Supabase Edge Function

const express = require("express");
const Database = require("../config");
const { authenticateToken } = require("../middleware/auth");
const EmailTemplate = require("../services/EmailTemplate");
const { getDisplayName, nameSelectColumns } = require('../utils/user-helpers');

const router = express.Router();

// GET /api/device-management/categories - List available device categories from DB (fallback to service)
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    // Try reading from DB
    const dbCategories = await Database.query(`
      SELECT category_key, label, description
      FROM device_categories
      WHERE active = TRUE
      ORDER BY id ASC
    `);

    if (dbCategories && dbCategories.length > 0) {
      const formatted = dbCategories.map(row => ({
        key: row.category_key,
        label: row.label,
        description: row.description,
      }));
      return res.json(formatted);
    }

    // Fallback to service-defined categories
    const DeviceCategoryService = require('../services/DeviceCategoryService');
    const serviceCats = DeviceCategoryService.getAllCategories().map(c => ({ key: c.value, label: c.name }));
    return res.json(serviceCats);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/device-management/categories - Create a new category (admin only)
router.post('/categories', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const key = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const existing = await Database.selectOne('device_categories', 'id', 'category_key = ?', [key]);
    if (existing) {
      return res.status(409).json({ error: 'Category already exists' });
    }
    const id = Database.generateUUID();
    await Database.insert('device_categories', {
      id, category_key: key, label: name.trim(),
      description: description || '', active: true,
      required_fields: '[]', optional_fields: '[]',
      identifier_type: 'imei', created_at: new Date(), updated_at: new Date()
    });
    res.status(201).json({ id, key, name: name.trim(), description: description || '' });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// PUT /api/device-management/categories/:id - Update a category (admin only)
router.put('/categories/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { id } = req.params;
    const { name, description, active } = req.body;
    const existing = await Database.selectOne('device_categories', 'id', 'id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }
    const updateData = { updated_at: new Date() };
    if (name !== undefined) {
      updateData.label = name.trim();
      updateData.category_key = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    }
    if (description !== undefined) updateData.description = description;
    if (active !== undefined) updateData.active = active;
    await Database.update('device_categories', updateData, 'id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// DELETE /api/device-management/categories/:id - Delete a category (admin only)
router.delete('/categories/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { id } = req.params;
    const existing = await Database.selectOne('device_categories', 'id', 'id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }
    await Database.query('DELETE FROM device_categories WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// GET /api/device-management - List user's devices
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const statusFilter = req.query.status;

    let whereClause = 'user_id = ?';
    let whereParams = [userId];

    if (statusFilter) {
      const statuses = statusFilter.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length > 0) {
        whereClause += ` AND status IN (${statuses.map(() => '?').join(',')})`;
        whereParams.push(...statuses);
      }
    }

    const devices = await Database.query(
      `SELECT SQL_CALC_FOUND_ROWS * FROM devices WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...whereParams, limit, offset]
    );

    const [{ total }] = await Database.query(`SELECT FOUND_ROWS() as total`);

    res.json({
      data: devices,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error("Error fetching devices:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/device-management/:id - Get specific device
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const userId = req.user.id;

    const device = await Database.selectOne(
      "devices",
      "*",
      "id = ? AND user_id = ?",
      [deviceId, userId]
    );

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    res.json(device);
  } catch (error) {
    console.error("Error fetching device:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/device-management - Enhanced device registration with categories
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { 
      category = 'others',
      imei, 
      serial, 
      vin,
      brand, 
      model, 
      color, 
      device_image_url, 
      proof_url,
      // Category-specific fields
      imei2,
      networkCarrier,
      operatingSystem,
      storageCapacity,
      macAddress,
      processorType,
      ramSize,
      licensePlate,
      year,
      engineNumber,
      registrationState,
      estimatedValue,
      certificateNumber,
      ...additionalData
    } = req.body;
    
    const userId = req.user.id;

    // Normalize category using DB labels/keys
    let normalizedCategory = category;
    try {
      const catRow = await Database.selectOne('device_categories', 'category_key, label', '(LOWER(label) = LOWER(?) OR LOWER(category_key) = LOWER(?)) AND active = TRUE', [category, category]);
      if (catRow) {
        normalizedCategory = catRow.category_key;
      } else {
        // Simple mapping fallback
        const map = {
          'phone': 'mobile_phone',
          'mobile': 'mobile_phone',
          'vehicle': 'vehicle',
          'car': 'vehicle',
          'computers': 'computer',
          'computer': 'computer',
          'smart watch': 'smart_watch',
          'smartwatch': 'smart_watch',
          'others': 'others'
        };
        const key = (category || '').toString().trim().toLowerCase();
        normalizedCategory = map[key] || 'others';
      }
    } catch (catErr) {
      console.warn('Category normalization failed, defaulting:', catErr);
      normalizedCategory = 'others';
    }

    // Validate required fields
    if (!brand || !model) {
      return res.status(400).json({
        error: "Brand and model are required",
      });
    }

    // Normalize field names before validation (frontend sends 'serial', backend expects 'serialNumber')
    const normalizedData = {
      ...req.body,
      serialNumber: req.body.serial || req.body.serialNumber,
      description: req.body.description || req.body.notes,
    };
    delete normalizedData.serial; // avoid confusion

    // Validate category and device data
    const DeviceCategoryService = require('../services/DeviceCategoryService');
    const validation = DeviceCategoryService.validateDeviceData(normalizedCategory, normalizedData);
    
    if (!validation.valid) {
      return res.status(400).json({ 
        error: validation.errors.join(', ')
      });
    }

    // Get primary identifier
    const primaryIdentifier = DeviceCategoryService.getPrimaryIdentifier(normalizedCategory, normalizedData);
    
    // Check if device already exists (allow re-registration if released)
    const existingDevice = await Database.query(`
      SELECT id, user_id, status 
      FROM devices 
      WHERE (imei = ? OR serial = ? OR vin = ?)
      AND (? IS NOT NULL OR ? IS NOT NULL OR ? IS NOT NULL)
    `, [
      imei || null,
      serial || null,
      vin || null,
      imei || null,
      serial || null,
      vin || null
    ]);

    let existingId = null;
    if (existingDevice.length > 0) {
      const existing = existingDevice[0];
      if (existing.user_id === userId) {
        if (existing.status === 'released') {
          existingId = existing.id;
        } else {
          return res.status(409).json({ 
            error: 'You have already registered this device' 
          });
        }
      } else {
        if (existing.status === 'released') {
          existingId = existing.id;
        } else {
          return res.status(409).json({ 
            error: 'This device is already registered by another user' 
          });
        }
      }
    }

    const deviceData = {
      user_id: userId,
      category: normalizedCategory,
      imei: imei || null,
      serial: serial || null,
      brand,
      model,
      color: color || null,
      device_image_url: device_image_url || null,
      proof_url: proof_url || null,
      status: "unverified",
      released_at: null,
      // explicit category fields
      imei2: imei2 || null,
      network_carrier: networkCarrier || null,
      operating_system: operatingSystem || null,
      storage_capacity: storageCapacity || null,
      mac_address: macAddress || null,
      processor_type: processorType || null,
      ram_size: ramSize || null,
      bluetooth_mac: additionalData.bluetoothMac || null,
      vin: vin || null,
      license_plate: licensePlate || null,
      year: year || null,
      engine_number: engineNumber || null,
      registration_state: registrationState || null,
      description: additionalData.description || null,
      notes: additionalData.notes || null,
      estimated_value: additionalData.estimatedValue || null,
      certificate_number: additionalData.certificateNumber || null,
      updated_at: new Date(),
    };

    let deviceId;
    if (existingId) {
      deviceData.created_at = new Date();
      await Database.update("devices", { ...deviceData, id: undefined }, "id = ?", [existingId]);
      deviceId = existingId;
    } else {
      deviceId = Database.generateUUID();
      deviceData.id = deviceId;
      deviceData.created_at = new Date();
      await Database.insert("devices", deviceData);
    }

    // Generate a link token and send verification email to the owner
    try {
      const NotificationService = require("../services/NotificationService");
      const verifyToken = Database.generateJWT({
        type: 'device_verify',
        device_id: deviceId,
        user_id: userId
      });
      const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
      const verifyLink = `${FRONTEND_URL}/verify-device?token=${verifyToken}`;
      const user = await Database.selectOne("users", "name, email, first_name, middle_name, last_name", "id = ?", [userId]);
      const emailContent = `
        <p>Hello ${getDisplayName(user)},</p>
        <p>We received a registration for your device: <strong>${brand} ${model}</strong>.</p>
        <p>To confirm you are the owner, please verify this device.</p>
        <p>If the button doesn't work, copy and paste this link into your browser:</p>
        <p><a href="${verifyLink}">${verifyLink}</a></p>
        <p>This link will expire in 24 hours. If it expires, you can request a new verification email from your devices page.</p>
      `;
      await NotificationService.sendEmailDirect(
        user.email,
        "Verify Your Device Ownership - Prove Ownership",
        EmailTemplate.wrapContent('Verify Your Device', emailContent, { actionButton: { url: verifyLink, text: 'Verify Ownership' } })
    );
    } catch (mailErr) {
      console.warn("Failed to send device ownership verification email:", mailErr);
    }

    // Create notification for admin to verify
    await Database.insert("notifications", {
      id: Database.generateUUID(),
      user_id: userId,
      channel: "email",
      recipient: req.user.email,
      subject: "Device Registration Confirmation",
      message: `Your device ${brand} ${model} has been registered and is pending verification. We have sent a verification email to confirm ownership.`,
      payload: JSON.stringify({
        type: "device_registered",
        device_id: deviceId,
      }),
      status: "pending",
      created_at: new Date(),
    });

    // Get the created device
    const device = await Database.selectOne("devices", "*", "id = ?", [
      deviceId,
    ]);

    res.status(201).json(device);
  } catch (error) {
    console.error("Error registering device:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/device-management/:id - Update device
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const userId = req.user.id;
    const updateData = req.body;

    // Verify ownership
    const existing = await Database.selectOne("devices", "user_id", "id = ?", [
      deviceId,
    ]);

    if (!existing || existing.user_id !== userId) {
      return res.status(404).json({
        error: "Device not found or unauthorized",
      });
    }

    // Update device
    updateData.updated_at = new Date();
    await Database.update("devices", updateData, "id = ?", [deviceId]);

    // Get updated device
    const device = await Database.selectOne("devices", "*", "id = ?", [
      deviceId,
    ]);

    res.json(device);
  } catch (error) {
    console.error("Error updating device:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/device-management/:id/release - Release/delist device so new owner can register
router.post("/:id/release", authenticateToken, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const userId = req.user.id;

    const device = await Database.selectOne("devices", "id, user_id, status, brand, model", "id = ?", [deviceId]);
    if (!device || device.user_id !== userId) {
      return res.status(404).json({ error: "Device not found or unauthorized" });
    }
    if (device.status === 'released') {
      return res.status(400).json({ error: 'Device is already released' });
    }

    await Database.update("devices",
      { status: 'released', released_at: new Date(), updated_at: new Date() },
      "id = ?", [deviceId]);

    await Database.logAudit(userId, 'DEVICE_RELEASED', 'devices', deviceId,
      null, { brand: device.brand, model: device.model }, req.ip);

    res.json({ success: true, message: 'Device released successfully. It can now be registered by a new owner.' });
  } catch (error) {
    console.error("Error releasing device:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/device-management/:id - Soft-delete device (archive, not destroy)
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const userId = req.user.id;
    const { reason } = req.body;

    const existing = await Database.selectOne("devices", "user_id", "id = ?", [deviceId]);
    if (!existing || existing.user_id !== userId) {
      return res.status(404).json({ error: "Device not found or unauthorized" });
    }

    const ArchiveService = require('../services/ArchiveService');
    const result = await ArchiveService.softDeleteDevice(deviceId, userId, reason || 'User requested deletion');

    res.json({
      message: "Device deleted successfully. Record has been archived.",
      archiveId: result.archiveId
    });
  } catch (error) {
    console.error("Error deleting device:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// POST /api/device-management/verify-device - Verify device with OTP
router.post("/verify-device", authenticateToken, async (req, res) => {
  try {
    const { device_id, otp_code } = req.body;
    const userId = req.user.id;

    if (!device_id || !otp_code) {
      return res.status(400).json({
        error: "Device ID and OTP code are required",
      });
    }

    // Verify device belongs to user
    const device = await Database.selectOne(
      "devices",
      "id, brand, model, status",
      "id = ? AND user_id = ?",
      [device_id, userId]
    );

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Verify OTP
    const OTPService = require("../services/OTPService");
    const otpResult = await OTPService.verifyOTP(
      userId,
      otp_code,
      "device_verification",
      device_id
    );

    if (!otpResult.success) {
      return res.status(400).json({ error: otpResult.message });
    }

    // Update device status to verified
    await Database.update(
      "devices",
      {
        status: "verified",
        verified_at: new Date(),
        updated_at: new Date(),
      },
      "id = ?",
      [device_id]
    );

    // Send verification success email
    const NotificationService = require("../services/NotificationService");
    const user = await Database.selectOne("users", "name, email, first_name, middle_name, last_name", "id = ?", [
      userId,
    ]);

      const emailContent = `
        <h2>Verification Successful</h2>
        <p>Hello ${getDisplayName(user)},</p>
        <p>Your device has been successfully verified:</p>

        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
          <h3>${device.brand} ${device.model}</h3>
          <p><strong>Status:</strong> <span style="color: #10b981;">Verified ✅</span></p>
          <p><strong>Verified on:</strong> ${new Date().toLocaleString()}</p>
        </div>

        <p>Your device is now fully protected in our registry. If it's ever reported stolen or lost, we'll help with recovery efforts.</p>

        <p><strong>What's Next?</strong></p>
        <ul>
          <li>Your device is now searchable in our public database</li>
          <li>You can report it as stolen/lost if needed</li>
          <li>You can transfer ownership to others</li>
          <li>You'll receive alerts for any suspicious activity</li>
        </ul>
      `;
    try {
      await NotificationService.sendEmailDirect(
        user.email,
        "Device Verified Successfully - Prove Ownership",
        EmailTemplate.wrapContent('Device Verified!', emailContent)
      );
    } catch (emailErr) {
      console.warn("Failed to send verification success email:", emailErr.message);
    }

    // Log device verification
    await Database.logAudit(
      userId,
      "DEVICE_VERIFIED",
      "devices",
      device_id,
      { status: device.status },
      { status: "verified", verified_at: new Date() },
      req.ip
    );

    res.json({
      success: true,
      message: "Device verified successfully!",
      device: {
        id: device.id,
        brand: device.brand,
        model: device.model,
        status: "verified",
        verified_at: new Date(),
      },
    });
  } catch (error) {
    console.error("Device verification error:", error);
    res.status(500).json({ error: "Failed to verify device" });
  }
});

// POST /api/device-management/verify-device-link - Verify device via email link token
router.post('/verify-device-link', async (req, res) => {
  try {
    const token = req.body.token || req.query.token;

    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    let payload;
    try {
      const Database = require('../config');
      payload = Database.verifyJWT(token);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    if (!payload || payload.type !== 'device_verify' || !payload.device_id || !payload.user_id) {
      return res.status(400).json({ error: 'Malformed verification token' });
    }

    const userId = payload.user_id;

    // Verify device belongs to user in token (no auth required)
    const device = await Database.selectOne(
      'devices',
      'id, brand, model, status, user_id',
      'id = ? AND user_id = ?',
      [payload.device_id, userId]
    );

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Idempotent: if already verified, return success without error
    if (device.status === 'verified') {
      return res.json({
        success: true,
        message: 'Device already verified',
        device: { id: device.id, brand: device.brand, model: device.model, status: 'verified' }
      });
    }

    // Update device status to verified
    await Database.update(
      'devices',
      { status: 'verified', verified_at: new Date(), updated_at: new Date() },
      'id = ?',
      [device.id]
    );

    // Send verification success email
    const NotificationService = require('../services/NotificationService');
    const user = await Database.selectOne('users', 'name, email, first_name, middle_name, last_name', 'id = ?', [userId]);
      const emailContent = `
        <h2>Verification Successful</h2>
        <p>Hello ${getDisplayName(user)},</p>
        <p>Your device has been successfully verified:</p>
        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
          <h3>${device.brand} ${device.model}</h3>
          <p><strong>Status:</strong> <span style="color: #10b981;">Verified ✅</span></p>
          <p><strong>Verified on:</strong> ${new Date().toLocaleString()}</p>
        </div>
      `;
    try {
      await NotificationService.sendEmailDirect(
        user.email,
        'Device Verified Successfully - Prove Ownership',
        EmailTemplate.wrapContent('Device Verified!', emailContent)
      );
    } catch (emailErr) {
      console.warn("Failed to send verification success email:", emailErr.message);
    }

    // Log device verification
    await Database.logAudit(
      userId,
      'DEVICE_VERIFIED',
      'devices',
      device.id,
      { status: device.status },
      { status: 'verified', verified_at: new Date() },
      req.ip
    );

    res.json({ success: true, message: 'Device verified successfully via link!', device: { id: device.id, brand: device.brand, model: device.model, status: 'verified' } });
  } catch (error) {
    console.error('Link verification error:', error);
    res.status(500).json({ error: 'Failed to verify device via link' });
  }
});

// POST /api/device-management/resend-verification - Resend device verification OTP
router.post("/resend-verification", authenticateToken, async (req, res) => {
  try {
    const { device_id } = req.body;
    const userId = req.user.id;

    if (!device_id) {
      return res.status(400).json({ error: "Device ID is required" });
    }

    // Verify device belongs to user and is pending verification
    const device = await Database.selectOne(
      "devices",
      "id, brand, model, status",
      "id = ? AND user_id = ? AND status = ?",
      [device_id, userId, "unverified"]
    );

    if (!device) {
      return res.status(404).json({
        error: "Device not found or already verified",
      });
    }

    // Create new OTP
    const OTPService = require("../services/OTPService");
    await OTPService.createOTP(userId, "device_verification", device_id, 30);

    res.json({
      success: true,
      message: "Verification code sent to your email",
    });
  } catch (error) {
    console.error("Resend verification error:", error);
    res.status(500).json({ error: "Failed to resend verification code" });
  }
});

// POST /api/device-management/report-stolen - DEPRECATED
// Use POST /api/report-management instead (redesigned flow with device selection,
// payment, KYC, and proper notification logic)
router.post("/report-stolen", authenticateToken, async (req, res) => {
  res.status(410).json({ 
    error: 'This endpoint is deprecated. Use POST /api/report-management instead.',
    redirect: '/api/report-management'
  });
});

// POST /api/device-management/report-found - DEPRECATED
// Use POST /api/found-device/report instead (public found device flow)
router.post("/report-found", authenticateToken, async (req, res) => {
  res.status(410).json({ 
    error: 'This endpoint is deprecated. Use POST /api/found-device/report instead.',
    redirect: '/api/found-device/report'
  });
});

// POST /api/device-management/bulk - Bulk register devices
router.post('/bulk', authenticateToken, async (req, res) => {
  try {
    const devices = req.body.devices; // Array of device objects
    if (!Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ error: 'No devices provided' });
    }

    const userId = req.user.id;
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < devices.length; i++) {
        const d = devices[i];
        try {
            // Basic validation
            if (!d.brand || !d.model) throw new Error('Brand and Model are required');
            
            // Check existing
            if (d.imei || d.serial) {
                const existing = await Database.query(
                    'SELECT id FROM devices WHERE (imei = ? OR serial = ?) AND (imei IS NOT NULL OR serial IS NOT NULL)',
                    [d.imei || null, d.serial || null]
                );
                if (existing.length > 0) throw new Error('Device with this IMEI/Serial already exists');
            }

             const deviceId = Database.generateUUID();
                const noteData = [];
                if (d.purchaseDate) noteData.push(`Purchase Date: ${d.purchaseDate}`);
                if (d.ownerEmail) noteData.push(`Owner Email: ${d.ownerEmail}`);
                
                const deviceData = {
                id: deviceId,
                user_id: userId,
                category: d.category || 'others',
                brand: d.brand,
                model: d.model,
                imei: d.imei || null,
                serial: d.serial || null,
                status: 'unverified',
                notes: noteData.length ? noteData.join(', ') : null,
                created_at: new Date(),
                updated_at: new Date()
             };

             await Database.insert('devices', deviceData);
             results.success++;
        } catch (err) {
            results.failed++;
            results.errors.push({ index: i, identifier: d.imei || d.serial || 'unknown', error: err.message });
        }
    }

    res.json({
        message: `Bulk registration completed. Success: ${results.success}, Failed: ${results.failed}`,
        details: results
    });

  } catch (error) {
    console.error('Bulk registration error:', error);
    res.status(500).json({ error: 'Internal server error during bulk registration' });
  }
});

module.exports = router;
