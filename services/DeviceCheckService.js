// Enhanced Device Check Service - Location tracking and security validation
const Database = require('../config');
const DeviceCategoryService = require('./DeviceCategoryService');

class DeviceCheckService {
  constructor() {
    this.REQUIRED_ACCURACY = 100; // meters (relaxed to match frontend)
    this.SUSPICIOUS_SPEED_THRESHOLD = 100; // m/s (360 km/h)
    this.MAX_CHECKS_PER_HOUR = 50;
  }

  // Enhanced device check with location and security tracking
  async performDeviceCheck(checkData) {
    try {
      const {
        deviceIdentifier,
        checkerLocation,
        deviceFingerprint,
        networkInfo,
        checkReason,
        checkerUserId
      } = checkData;

      // Validate required data
      this.validateCheckData(checkData);

      // Find device by identifier
      const device = await this.findDeviceByIdentifier(deviceIdentifier);
      if (!device) {
        // Log negative check in new device_checks table
        const checkLogId = await this.logDeviceCheck({
          device: null,
          deviceIdentifier,
          checkerUserId,
          checkerLocation,
          deviceFingerprint,
          networkInfo,
          checkReason,
          securityAnalysis: { riskScore: 0, riskFactors: [] },
          warnings: { ownership: null, security: [] }
        });
        return {
          success: false,
          error: 'Device not found in registry',
          deviceStatus: 'not_found',
          checkId: checkLogId
        };
      }

      // Validate location accuracy (relaxed)
      if (checkerLocation.accuracy > this.REQUIRED_ACCURACY) {
        // Allow proceeding but mark as low confidence
        console.warn(`Location accuracy low (${checkerLocation.accuracy}m). Proceeding with check.`);
      }

      // Check rate limiting
      // Rate limiting disabled for device checks
      // const rateLimitCheck = await this.checkRateLimit(checkerUserId, deviceFingerprint.browserFingerprint);
      // if (!rateLimitCheck.allowed) {
      //   return {
      //     success: false,
      //     error: 'Too many checks performed. Please wait before checking again.',
      //     rateLimited: true
      //   };
      // }

      // Determine effective status using active reports if present
      let effectiveStatus = device.status;
      try {
        const activeReport = await Database.query(
          `SELECT report_type FROM reports 
           WHERE device_id = ? AND status IN ('open','under_review') 
           ORDER BY created_at DESC LIMIT 1`, [device.id]
        );
        if (activeReport && activeReport[0] && (activeReport[0].report_type === 'stolen' || activeReport[0].report_type === 'lost')) {
          effectiveStatus = activeReport[0].report_type;
        }
      } catch (repErr) {
        console.error('Active report lookup error:', repErr);
      }

      // Perform security analysis
      const securityAnalysis = await this.performSecurityAnalysis({
        device,
        checkerLocation,
        deviceFingerprint,
        networkInfo,
        checkerUserId
      });

      // Generate warnings based on ownership and security analysis
      const warnings = this.generateSecurityWarnings(device, checkerUserId, securityAnalysis);

      // Log the device check
      const checkLogId = await this.logDeviceCheck({
        device,
        deviceIdentifier,
        checkerUserId,
        checkerLocation,
        deviceFingerprint,
        networkInfo,
        checkReason,
        securityAnalysis,
        warnings,
        effectiveStatus
      });

      // Update device check statistics
      await this.updateDeviceCheckStats(device.id);

      // Determine check result
      const checkResult = this.determineCheckResult(effectiveStatus, securityAnalysis);

      return {
        success: true,
        deviceStatus: checkResult.status,
        deviceDetails: {
          id: device.id,
          category: device.category,
          brand: device.brand,
          model: device.model,
          status: effectiveStatus,
          registrationDate: device.created_at,
          lastCheckDate: new Date()
        },
        ownershipWarning: warnings.ownership,
        securityAlerts: warnings.security,
        transferAvailable: checkResult.transferAvailable,
        checkId: checkLogId,
        riskScore: securityAnalysis.riskScore
      };

    } catch (error) {
      console.error('Device check error:', error);
      throw error;
    }
  }

  // Validate check data
  validateCheckData(checkData) {
    const required = ['deviceIdentifier', 'checkerLocation', 'deviceFingerprint', 'checkReason'];
    
    for (const field of required) {
      if (!checkData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate location data
    const location = checkData.checkerLocation;
    if (!location.latitude || !location.longitude || !location.accuracy) {
      throw new Error('Invalid location data');
    }

    if (Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) {
      throw new Error('Invalid GPS coordinates');
    }
  }

  // Find device by various identifiers
  async findDeviceByIdentifier(identifier) {
    try {
      // Search by primary identifiers
      const device = await Database.query(`
        SELECT d.*, u.name as owner_name, u.email as owner_email, u.id as owner_id
        FROM devices d
        JOIN users u ON d.user_id = u.id
        WHERE d.imei = ?
           OR d.serial = ?
           OR d.vin = ?
           OR d.license_plate = ?
           OR d.mac_address = ?
           OR d.bluetooth_mac = ?
        LIMIT 1
      `, [identifier, identifier, identifier, identifier, identifier, identifier]);

      return device.length > 0 ? device[0] : null;
    } catch (error) {
      console.error('Device search error:', error);
      throw error;
    }
  }

  // Check rate limiting
  async checkRateLimit(userId, fingerprint) {
    // Rate limiting disabled: always allow checks
    return {
      allowed: true,
      remaining: Number.MAX_SAFE_INTEGER,
      resetTime: new Date(Date.now() + 60 * 60 * 1000)
    };
  }

  // Perform comprehensive security analysis
  async performSecurityAnalysis(data) {
    const { device, checkerLocation, deviceFingerprint, networkInfo, checkerUserId } = data;
    
    let riskScore = 0;
    const riskFactors = [];

    // Location-based risk analysis
    const locationRisk = await this.analyzeLocationRisk(checkerUserId, checkerLocation);
    riskScore += locationRisk.score;
    riskFactors.push(...locationRisk.factors);

    // Device fingerprint risk analysis
    const fingerprintRisk = this.analyzeDeviceFingerprintRisk(deviceFingerprint);
    riskScore += fingerprintRisk.score;
    riskFactors.push(...fingerprintRisk.factors);

    // Network risk analysis
    const networkRisk = await this.analyzeNetworkRisk(networkInfo);
    riskScore += networkRisk.score;
    riskFactors.push(...networkRisk.factors);

    // Historical pattern analysis
    const patternRisk = await this.analyzeHistoricalPatterns(device.id, checkerUserId);
    riskScore += patternRisk.score;
    riskFactors.push(...patternRisk.factors);

    return {
      riskScore: Math.min(100, riskScore), // Cap at 100
      riskFactors,
      locationAnalysis: locationRisk,
      fingerprintAnalysis: fingerprintRisk,
      networkAnalysis: networkRisk,
      patternAnalysis: patternRisk
    };
  }

  // Analyze location-based risks
  async analyzeLocationRisk(userId, location) {
    let score = 0;
    const factors = [];

    try {
      // Check for location spoofing (impossible speed)
      if (userId) {
        const recentLocations = await Database.query(`
          SELECT latitude, longitude, created_at
          FROM device_check_logs
          WHERE checker_user_id = ?
          AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
          ORDER BY created_at DESC
          LIMIT 5
        `, [userId]);

        for (const prevLocation of recentLocations) {
          const distance = this.calculateDistance(
            location.latitude, location.longitude,
            prevLocation.latitude, prevLocation.longitude
          );
          
          const timeDiff = (new Date() - new Date(prevLocation.created_at)) / 1000; // seconds
          const speed = distance / timeDiff; // m/s

          if (speed > this.SUSPICIOUS_SPEED_THRESHOLD) {
            score += 30;
            factors.push('impossible_travel_speed');
            break;
          }
        }
      }

      // Check location clustering (multiple checks from same location)
      const nearbyChecks = await Database.query(`
        SELECT COUNT(*) as nearby_count
        FROM device_check_logs
        WHERE ABS(latitude - ?) < 0.001 AND ABS(longitude - ?) < 0.001
        AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `, [location.latitude, location.longitude]);

      if (nearbyChecks[0]?.nearby_count > 10) {
        score += 15;
        factors.push('location_clustering');
      }

      // Check for high-risk locations (if we had a database of such locations)
      // This could include known fraud hotspots, etc.

    } catch (error) {
      console.error('Location risk analysis error:', error);
    }

    return { score, factors };
  }

  // Analyze device fingerprint risks
  analyzeDeviceFingerprintRisk(fingerprint) {
    let score = 0;
    const factors = [];

    // Check for headless browsers or automation
    if (fingerprint.userAgent.includes('HeadlessChrome') || 
        fingerprint.userAgent.includes('PhantomJS')) {
      score += 40;
      factors.push('headless_browser');
    }

    // Check for missing plugins (common in automated browsers)
    if (!fingerprint.plugins || fingerprint.plugins.length === 0) {
      score += 20;
      factors.push('no_plugins');
    }

    // Check for limited fonts (sign of sandboxed environment)
    if (!fingerprint.fonts || fingerprint.fonts.length < 5) {
      score += 15;
      factors.push('limited_fonts');
    }

    // Check for disabled rendering
    if (fingerprint.canvas === 'canvas-error' || fingerprint.webgl === 'webgl-error') {
      score += 25;
      factors.push('rendering_disabled');
    }

    // Check for suspicious user agent patterns
    if (fingerprint.userAgent.length < 50 || 
        !fingerprint.userAgent.includes('Mozilla')) {
      score += 10;
      factors.push('suspicious_user_agent');
    }

    return { score, factors };
  }

  // Analyze network-based risks
  async analyzeNetworkRisk(networkInfo) {
    let score = 0;
    const factors = [];

    try {
      // Check for VPN/Proxy usage (simplified check)
      if (networkInfo.ipAddress) {
        // In a real implementation, you'd check against VPN/proxy databases
        // For now, we'll do basic checks
        
        // Check for common VPN IP ranges or patterns
        if (this.isLikelyVPN(networkInfo.ipAddress)) {
          score += 20;
          factors.push('vpn_detected');
        }
      }

      // Check connection type
      if (networkInfo.connectionType === 'none') {
        score += 30;
        factors.push('no_connection');
      }

    } catch (error) {
      console.error('Network risk analysis error:', error);
    }

    return { score, factors };
  }

  // Analyze historical patterns
  async analyzeHistoricalPatterns(deviceId, checkerUserId) {
    let score = 0;
    const factors = [];

    try {
      // Check frequency of checks for this device
      const recentChecks = await Database.query(`
        SELECT COUNT(*) as check_count
        FROM device_check_logs
        WHERE device_id = ?
        AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `, [deviceId]);

      if (recentChecks[0]?.check_count > 20) {
        score += 25;
        factors.push('excessive_checking');
      }

      // Check if user has been checking many different devices
      if (checkerUserId) {
        const userChecks = await Database.query(`
          SELECT COUNT(DISTINCT device_id) as unique_devices
          FROM device_check_logs
          WHERE checker_user_id = ?
          AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `, [checkerUserId]);

        if (userChecks[0]?.unique_devices > 50) {
          score += 20;
          factors.push('bulk_checking');
        }
      }

    } catch (error) {
      console.error('Pattern analysis error:', error);
    }

    return { score, factors };
  }

  // Generate security warnings
  generateSecurityWarnings(device, checkerUserId, securityAnalysis) {
    const warnings = {
      ownership: null,
      security: []
    };

    // Ownership warnings
    if (checkerUserId && checkerUserId !== device.owner_id) {
      if (device.status === 'stolen') {
        warnings.ownership = {
          level: 'danger',
          title: '🚨 STOLEN DEVICE ALERT',
          message: 'This device has been reported as STOLEN. Do not purchase or accept this device.',
          recommendations: [
            'Contact law enforcement immediately',
            'Do not complete any transaction',
            'Report this incident to authorities'
          ],
          requiresOwnerVerification: false
        };
      } else {
        warnings.ownership = {
          level: 'warning',
          title: '⚠️ Ownership Verification Required',
          message: 'You are not the registered owner of this device. Verify ownership before purchase.',
          recommendations: [
            'Ask seller to check device with their own account',
            'Request proof of purchase documentation',
            'Verify seller identity matches registration',
            'Use secure ownership transfer process'
          ],
          requiresOwnerVerification: true
        };
      }
    }

    // Security warnings based on risk analysis
    if (securityAnalysis.riskScore > 70) {
      warnings.security.push({
        level: 'danger',
        message: 'High-risk security patterns detected',
        details: securityAnalysis.riskFactors
      });
    } else if (securityAnalysis.riskScore > 40) {
      warnings.security.push({
        level: 'warning',
        message: 'Suspicious activity patterns detected',
        details: securityAnalysis.riskFactors
      });
    }

    return warnings;
  }

  // Log device check with comprehensive data
  async logDeviceCheck(logData) {
    try {
      const {
        device,
        deviceIdentifier,
        checkerUserId,
        checkerLocation,
        deviceFingerprint,
        networkInfo,
        checkReason,
        securityAnalysis,
        warnings,
        effectiveStatus
      } = logData;

      const checkLogId = Database.generateUUID();

      // Map check result to device_check_logs enumeration
      // device_check_logs.check_result ENUM('legitimate', 'stolen', 'suspicious', 'unknown')
      let checkResultEnum = 'unknown';
      if (!device) {
        checkResultEnum = 'unknown';
      } else if ((effectiveStatus || device.status) === 'stolen') {
        checkResultEnum = 'stolen';
      } else if ((effectiveStatus || device.status) === 'lost') {
        checkResultEnum = 'stolen'; // treat lost as reported device for alerts
      } else if ((securityAnalysis?.riskScore || 0) > 70) {
        checkResultEnum = 'suspicious';
      } else if (device.status === 'verified') {
        checkResultEnum = 'legitimate';
      } else {
        checkResultEnum = 'unknown';
      }

      const isSuspicious = (securityAnalysis?.riskScore || 0) > 70;

      // Write to existing device_check_logs table (present in schema)
      await Database.insert('device_check_logs', {
        id: checkLogId,
        device_id: device ? device.id : null,
        checker_user_id: checkerUserId || null,
        check_type: 'public_check',
        latitude: checkerLocation?.latitude || null,
        longitude: checkerLocation?.longitude || null,
        location_accuracy: checkerLocation?.accuracy || null,
        ip_address: networkInfo?.ipAddress || null,
        mac_address: (deviceFingerprint?.macAddress || networkInfo?.macAddress || networkInfo?.mac || null),
        user_agent: deviceFingerprint?.userAgent || null,
        browser_fingerprint: null,
        device_fingerprint: JSON.stringify(deviceFingerprint || {}),
        risk_score: securityAnalysis?.riskScore || 0,
        suspicious_flags: JSON.stringify(securityAnalysis?.riskFactors || []),
        check_result: checkResultEnum,
        warnings_shown: JSON.stringify(warnings?.security || []),
        created_at: new Date()
      });

      return checkLogId;
    } catch (error) {
      console.error('Check logging error:', error);
      throw error;
    }
  }

  // Update device check statistics
  async updateDeviceCheckStats(deviceId) {
    // No-op: legacy columns last_check_date/check_count may not exist in current schema
    return;
  }

  // Determine final check result
  determineCheckResult(effectiveStatus, securityAnalysis) {
    let status = 'legitimate';
    let transferAvailable = false;

    // Check effective status (from device or active report)
    if (effectiveStatus === 'stolen') {
      status = 'stolen';
    } else if (effectiveStatus === 'lost') {
      status = 'lost';
    } else if (securityAnalysis.riskScore > 70) {
      status = 'suspicious';
    } else if (effectiveStatus === 'verified') {
      status = 'legitimate';
      transferAvailable = true;
    } else {
      // Preserve unknown when not determinable
      status = 'unknown';
    }

    return { status, transferAvailable };
  }

  // Utility functions
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  isLikelyVPN(ipAddress) {
    // Simplified VPN detection - in production, use proper VPN detection services
    const vpnPatterns = [
      /^10\./, // Private IP ranges often used by VPNs
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, 
      /^192\.168\./
    ];

    return vpnPatterns.some(pattern => pattern.test(ipAddress));
  }

  // Get device check history for LEA reports
  async getDeviceCheckHistory(deviceId, limit = 50) {
    try {
      const history = await Database.query(`
        SELECT 
          dcl.*,
          u.name as checker_name,
          u.email as checker_email
        FROM device_check_logs dcl
        LEFT JOIN users u ON dcl.checker_user_id = u.id
        WHERE dcl.device_id = ?
        ORDER BY dcl.created_at DESC
        LIMIT ?
      `, [deviceId, limit]);

      return history.map(record => ({
        ...record,
        device_fingerprint: this.safeJsonParse(record.device_fingerprint),
        suspicious_flags: this.safeJsonParse(record.suspicious_flags),
        warnings_shown: this.safeJsonParse(record.warnings_shown)
      }));
    } catch (error) {
      console.error('Check history error:', error);
      throw error;
    }
  }

  safeJsonParse(jsonString) {
    try {
      return jsonString ? JSON.parse(jsonString) : null;
    } catch (error) {
      return null;
    }
  }
}

module.exports = new DeviceCheckService();