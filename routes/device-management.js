// Device Management Routes - MySQL Version
// Replaces Supabase Edge Function

const express = require("express");
const Database = require("../config");
const { authenticateToken } = require("../middleware/auth");

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

// GET /api/device-management - List user's devices
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const devices = await Database.select(
      "devices",
      "*",
      "user_id = ?",
      [userId],
      "created_at DESC"
    );

    res.json(devices);
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

    // Validate category and device data
    const DeviceCategoryService = require('../services/DeviceCategoryService');
    const validation = DeviceCategoryService.validateDeviceData(normalizedCategory, req.body);
    
    if (!validation.valid) {
      return res.status(400).json({ 
        error: validation.errors.join(', ')
      });
    }

    // Get primary identifier
    const primaryIdentifier = DeviceCategoryService.getPrimaryIdentifier(normalizedCategory, req.body);
    
    // Check if device already exists
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

    if (existingDevice.length > 0) {
      const existing = existingDevice[0];
      if (existing.user_id === userId) {
        return res.status(409).json({ 
          error: 'You have already registered this device' 
        });
      } else {
        return res.status(409).json({ 
          error: 'This device is already registered by another user' 
        });
      }
    }

    // Create device
    const deviceId = Database.generateUUID();
    const deviceData = {
      id: deviceId,
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
      created_at: new Date(),
      updated_at: new Date(),
    };

    await Database.insert("devices", deviceData);

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
      const user = await Database.selectOne("users", "name, email", "id = ?", [userId]);
      await NotificationService.sendEmailDirect(
        user.email,
        "Verify Your Device Ownership - Check It Registry",
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #646cff; color: white; padding: 20px; text-align: center;">
              <h1>Verify Your Device</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <p>Hello ${user.name},</p>
              <p>We received a registration for your device: <strong>${brand} ${model}</strong>.</p>
              <p>To confirm you are the owner, please verify this device.</p>
              <p>
                <a href="${verifyLink}" style="display:inline-block;background:#646cff;color:white;padding:12px 18px;border-radius:6px;text-decoration:none;">Verify Ownership</a>
              </p>
              <p>If the button doesn’t work, copy and paste this link into your browser:</p>
              <p><a href="${verifyLink}">${verifyLink}</a></p>
              <p>This link will expire in 24 hours. If it expires, you can request a new verification email from your devices page.</p>
            </div>
            <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
              <p>This is an automated message from Check It Device Registry</p>
            </div>
          </div>
        `
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

// DELETE /api/device-management/:id - Delete device
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const userId = req.user.id;

    // Verify ownership
    const existing = await Database.selectOne("devices", "user_id", "id = ?", [
      deviceId,
    ]);

    if (!existing || existing.user_id !== userId) {
      return res.status(404).json({
        error: "Device not found or unauthorized",
      });
    }

    // Delete device (cascade will handle reports)
    await Database.delete("devices", "id = ?", [deviceId]);

    res.json({ message: "Device deleted successfully" });
  } catch (error) {
    console.error("Error deleting device:", error);
    res.status(500).json({ error: "Internal server error" });
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
    const user = await Database.selectOne("users", "name, email", "id = ?", [
      userId,
    ]);

    await NotificationService.sendEmailDirect(
      user.email,
      "Device Verified Successfully - Check It Registry",
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #10b981; color: white; padding: 20px; text-align: center;">
            <h1>✅ Device Verified!</h1>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <h2>Verification Successful</h2>
            <p>Hello ${user.name},</p>
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
          </div>
          <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
            <p>This is an automated message from Check It Device Registry</p>
          </div>
        </div>
      `
    );

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
    const user = await Database.selectOne('users', 'name, email', 'id = ?', [userId]);
    await NotificationService.sendEmailDirect(
      user.email,
      'Device Verified Successfully - Check It Registry',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #10b981; color: white; padding: 20px; text-align: center;">
            <h1>✅ Device Verified!</h1>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <h2>Verification Successful</h2>
            <p>Hello ${user.name},</p>
            <p>Your device has been successfully verified:</p>
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
              <h3>${device.brand} ${device.model}</h3>
              <p><strong>Status:</strong> <span style="color: #10b981;">Verified ✅</span></p>
              <p><strong>Verified on:</strong> ${new Date().toLocaleString()}</p>
            </div>
          </div>
          <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
            <p>This is an automated message from Check It Device Registry</p>
          </div>
        </div>
      `
    );

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

// POST /api/device-management/report-stolen - Report device as stolen
router.post("/report-stolen", authenticateToken, async (req, res) => {
  try {
    const {
      device_id,
      incident_date,
      location,
      description,
      police_report_number,
    } = req.body;
    const userId = req.user.id;

    if (!device_id) {
      return res.status(400).json({ error: "Device ID is required" });
    }

    // Verify device belongs to user
    const device = await Database.selectOne(
      "devices",
      "*",
      "id = ? AND user_id = ?",
      [device_id, userId]
    );

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    if (device.status === "stolen") {
      return res
        .status(400)
        .json({ error: "Device is already reported as stolen" });
    }

    // Generate case ID
    const caseId = "CASE-" + Date.now().toString(36).toUpperCase();

    // Create report
    const reportId = Database.generateUUID();
    const reportData = {
      id: reportId,
      case_id: caseId,
      device_id: device_id,
      reporter_id: userId,
      report_type: "stolen",
      incident_date: incident_date ? new Date(incident_date) : new Date(),
      location: location?.trim() || null,
      description: description?.trim() || null,
      police_report_number: police_report_number?.trim() || null,
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
    };

    await Database.insert("reports", reportData);

    // Update device status
    await Database.update(
      "devices",
      {
        status: "stolen",
        updated_at: new Date(),
      },
      "id = ?",
      [device_id]
    );

    // Send theft report email
    const NotificationService = require("../services/NotificationService");
    const user = await Database.selectOne("users", "name, email", "id = ?", [
      userId,
    ]);

    await NotificationService.sendEmailDirect(
      user.email,
      `Device Reported Stolen - Case ${caseId}`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #dc2626; color: white; padding: 20px; text-align: center;">
            <h1>🚨 Device Reported Stolen</h1>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <h2>Theft Report Confirmed</h2>
            <p>Hello ${user.name},</p>
            <p>Your device has been successfully reported as stolen:</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
              <h3>${device.brand} ${device.model}</h3>
              <p><strong>Case ID:</strong> ${caseId}</p>
              <p><strong>IMEI:</strong> ${device.imei || "Not provided"}</p>
              <p><strong>Serial:</strong> ${device.serial || "Not provided"}</p>
              <p><strong>Status:</strong> <span style="color: #dc2626;">Stolen 🚨</span></p>
            </div>
            
            <p><strong>What happens next:</strong></p>
            <ul>
              <li>Your device is now marked as stolen in our database</li>
              <li>Law enforcement agencies have been notified</li>
              <li>We'll monitor for any attempts to register this device</li>
              <li>You'll be contacted if the device is found</li>
            </ul>
            
            <p>Keep your case ID <strong>${caseId}</strong> for reference.</p>
          </div>
          <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
            <p>This is an automated message from Check It Device Registry</p>
          </div>
        </div>
      `
    );

    // Log theft report
    await Database.logAudit(
      userId,
      "DEVICE_REPORTED_STOLEN",
      "devices",
      device_id,
      { status: device.status },
      { status: "stolen", case_id: caseId },
      req.ip
    );

    res.status(201).json({
      success: true,
      message: "Device reported as stolen successfully",
      case_id: caseId,
      report: reportData,
    });
  } catch (error) {
    console.error("Report stolen error:", error);
    res.status(500).json({ error: "Failed to report device as stolen" });
  }
});

// POST /api/device-management/report-found - Report finding a device
router.post("/report-found", authenticateToken, async (req, res) => {
  try {
    const { device_id, found_location, finder_contact, description } = req.body;
    const userId = req.user.id;

    if (!device_id) {
      return res.status(400).json({ error: "Device ID is required" });
    }

    // Verify device exists and is reported as stolen
    const device = await Database.selectOne(
      "devices",
      "*",
      "id = ? AND status = ?",
      [device_id, "stolen"]
    );

    if (!device) {
      return res.status(404).json({
        error: "Device not found or not reported as stolen",
      });
    }

    // Generate case ID for found report
    const caseId = "FOUND-" + Date.now().toString(36).toUpperCase();

    // Create found report
    const reportId = Database.generateUUID();
    const reportData = {
      id: reportId,
      case_id: caseId,
      device_id: device_id,
      reporter_id: userId,
      report_type: "found",
      location: found_location?.trim() || null,
      description: description?.trim() || null,
      finder_contact: finder_contact?.trim() || null,
      status: "pending_verification",
      created_at: new Date(),
      updated_at: new Date(),
    };

    await Database.insert("reports", reportData);

    // Notify device owner
    const owner = await Database.selectOne("users", "name, email", "id = ?", [
      device.user_id,
    ]);
    const NotificationService = require("../services/NotificationService");

    await NotificationService.sendEmailDirect(
      owner.email,
      `Your Device May Have Been Found - Case ${caseId}`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #10b981; color: white; padding: 20px; text-align: center;">
            <h1>🎉 Device Possibly Found!</h1>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <h2>Great News!</h2>
            <p>Hello ${owner.name},</p>
            <p>Someone has reported finding a device matching your stolen ${
              device.brand
            } ${device.model}:</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
              <h3>Found Device Report</h3>
              <p><strong>Case ID:</strong> ${caseId}</p>
              <p><strong>Found Location:</strong> ${
                found_location || "Not specified"
              }</p>
              <p><strong>Finder Contact:</strong> ${
                finder_contact || "Available through support"
              }</p>
              <p><strong>Description:</strong> ${
                description || "No additional details"
              }</p>
            </div>
            
            <p><strong>Next Steps:</strong></p>
            <ul>
              <li>Our team will verify this report</li>
              <li>We'll coordinate with law enforcement</li>
              <li>You'll be contacted to arrange device recovery</li>
              <li>Please have your proof of ownership ready</li>
            </ul>
            
            <p>Case ID: <strong>${caseId}</strong></p>
          </div>
          <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
            <p>This is an automated message from Check It Device Registry</p>
          </div>
        </div>
      `
    );

    res.status(201).json({
      success: true,
      message:
        "Device found report submitted successfully. The owner has been notified.",
      case_id: caseId,
    });
  } catch (error) {
    console.error("Report found error:", error);
    res.status(500).json({ error: "Failed to report device as found" });
  }
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
