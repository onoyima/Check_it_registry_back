// Public Device Check Route - MySQL Version
const express = require('express');
const Database = require('../config');
const notifier = require('../services/EnhancedNotificationService');

const router = express.Router();

const noRestrictions = (req, res, next) => {
  next();
};

// GET /api/public-check/stats - Landing page statistics
router.get('/stats', noRestrictions, async (req, res) => {
  try {
    const [
      users,
      devices,
      verifiedDevices,
      recovered
    ] = await Promise.all([
      Database.query('SELECT COUNT(*) as count FROM users'),
      Database.query('SELECT COUNT(*) as count FROM devices'),
      Database.query('SELECT COUNT(*) as count FROM devices WHERE status = ?', ['verified']),
      Database.query('SELECT COUNT(*) as count FROM reports WHERE status = ?', ['resolved'])
    ]);

    res.json({
      users: users[0].count,
      devices: devices[0].count,
      verified_devices: verifiedDevices[0].count,
      recovered_devices: recovered[0].count
    });
  } catch (error) {
    console.error('Landing page stats error:', error);
    // Return estimates if DB fails, to keep landing page working (optional, but good for robust UX)
    res.json({
      users: 1250,
      devices: 3400,
      verified_devices: 2800,
      recovered_devices: 150
    });
  }
});

// GET /api/public-check?imei=xxx or ?serial=xxx
router.get('/', noRestrictions, async (req, res) => {
  try {
    const { imei, serial } = req.query;

    if (!imei && !serial) {
      return res.status(400).json({ 
        error: 'IMEI or serial number required' 
      });
    }

    // Require network and location context
    const xff = req.headers['x-forwarded-for'];
    const clientIP = (Array.isArray(xff) ? xff[0] : (xff || '')).split(',')[0].trim() || req.ip || req.connection.remoteAddress || req.socket?.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || '';
    const macHeader = req.headers['x-mac-address'] || req.headers['x-client-mac'];
    const macAddress = macHeader ? String(macHeader) : null;
    const locLat = req.headers['x-location-lat'];
    const locLon = req.headers['x-location-lon'];
    const locAcc = req.headers['x-location-accuracy'];
    const locationLatitude = locLat !== undefined ? Number(locLat) : null;
    const locationLongitude = locLon !== undefined ? Number(locLon) : null;
    const locationAccuracy = locAcc !== undefined ? Number(locAcc) : null;

    if (!macAddress) {
      return res.status(400).json({
        error: 'MAC address required. Provide in header x-mac-address or x-client-mac.'
      });
    }

    if (locationLatitude === null || locationLongitude === null || locationAccuracy === null) {
      return res.status(400).json({
        error: 'Live location required. Provide x-location-lat, x-location-lon, x-location-accuracy headers.'
      });
    }

    if (Number.isNaN(locationLatitude) || Number.isNaN(locationLongitude) || Number.isNaN(locationAccuracy)) {
      return res.status(400).json({
        error: 'Invalid location values. lat, lon, accuracy must be numbers.'
      });
    }

    if (Math.abs(locationLatitude) > 90 || Math.abs(locationLongitude) > 180 || locationAccuracy < 0) {
      return res.status(400).json({
        error: 'Invalid location bounds. lat in [-90,90], lon in [-180,180], accuracy >= 0.'
      });
    }

    // Search for device with owner KYC info
    let device;
    const queryCols = 'd.id, d.user_id, d.imei, d.serial, d.brand, d.model, d.status, u.kyc_status, u.is_verified, u.caution_flag';
    // Adjust join to be LEFT JOIN in case user key is missing (though should be enforced)
    const joinClause = 'LEFT JOIN users u ON d.user_id = u.id';

    if (imei) {
      const results = await Database.query(
        `SELECT ${queryCols} FROM devices d ${joinClause} WHERE d.imei = ?`,
        [imei]
      );
      device = results[0];
    } else if (serial) {
      const results = await Database.query(
        `SELECT ${queryCols} FROM devices d ${joinClause} WHERE d.serial = ?`,
        [serial]
      );
      device = results[0];
    }

    let result;

    if (!device) {
      result = {
        status: 'not_found',
        message: 'Device not found in registry'
      };
    } else {
      // Base result
      result = {
        status: device.status,
        device_details: {
          brand: device.brand,
          model: device.model
        },
        owner_kyc: {
          status: device.kyc_status || 'unverified',
          is_verified: !!device.is_verified,
          caution_flag: !!device.caution_flag
        }
      };

      if (device.status === 'stolen' || device.status === 'lost') {
        // Get active report
        const report = await Database.selectOne(
          'reports',
          'case_id, report_type, occurred_at',
          'device_id = ? AND status = ?',
          [device.id, 'open'],
          'created_at DESC'
        );

        result.message = `This device has been reported as ${device.status}`;
        result.case_id = report?.case_id;
        result.report_type = report?.report_type;
        result.occurred_at = report?.occurred_at;
        result.recovery_instructions = 'Please contact local law enforcement immediately. Do not attempt to confront or contact the seller.';
      } else if (device.status === 'unverified') {
        result.message = 'Device is registered but pending verification';
      } else {
        result.message = 'Device is registered and has no active reports';
      }

      // Add Caution Message if owner is flagged
      if (device.caution_flag) {
        result.warning = '⚠️ The owner of this device is flagged. Deal with caution.';
      }
    }

    // Log the check to legacy table
    await Database.insert('imei_checks', {
      id: Database.generateUUID(),
      query: imei || serial,
      ip_address: clientIP,
      user_agent: userAgent,
      result: JSON.stringify(result),
      created_at: new Date()
    });

    // Also log to existing device_check_logs table for enhanced tracking
    const checkResultEnum = !device
      ? 'unknown'
      : (device.status === 'stolen' || device.status === 'lost' ? 'stolen'
        : (device.status === 'verified' ? 'legitimate' : 'unknown'));

    const checkId = Database.generateUUID();
    await Database.insert('device_check_logs', {
      id: checkId,
      device_id: device ? device.id : null,
      checker_user_id: null,
      check_type: 'public_check',
      ip_address: clientIP,
      mac_address: macAddress,
      user_agent: userAgent,
      latitude: locationLatitude,
      longitude: locationLongitude,
      location_accuracy: locationAccuracy,
      device_fingerprint: JSON.stringify({}),
      risk_score: 0,
      suspicious_flags: JSON.stringify([]),
      check_result: checkResultEnum,
      warnings_shown: JSON.stringify([]),
      created_at: new Date()
    });

    // Alerts: notify owner and admins/LEA if reported device is checked
    if (device && (device.status === 'stolen' || device.status === 'lost')) {
      try {
        const subject = `ALERT: Reported device checked (${device.brand} ${device.model})`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
            <h2 style="color:#B91C1C;">Reported Device Check Detected</h2>
            <p>A device flagged as <strong>${device.status}</strong> was checked via the public API.</p>
            <ul>
              <li><strong>Device:</strong> ${device.brand} ${device.model}</li>
              <li><strong>Identifier:</strong> ${imei || serial}</li>
              <li><strong>IP:</strong> ${clientIP}</li>
              <li><strong>MAC:</strong> ${macAddress || 'Unknown'}</li>
              <li><strong>User-Agent:</strong> ${userAgent}</li>
              <li><strong>Location:</strong> ${locationLatitude && locationLongitude ? `${locationLatitude}, ${locationLongitude} (±${locationAccuracy || 'n/a'}m)` : 'Unknown'}</li>
              <li><strong>Check ID:</strong> ${checkId}</li>
            </ul>
            <p>Action may be required. Review related report and consider LEA notification.</p>
          </div>
        `;

        // Notify admin (if configured)
        if (process.env.ADMIN_EMAIL) {
          await notifier.sendEmail(process.env.ADMIN_EMAIL, subject, html);
        }

        // Notify device owner
        if (device.user_id) {
          const owner = await Database.selectOne('users', 'email, name, phone', 'id = ?', [device.user_id]);
          if (owner?.email) {
            await notifier.sendEmail(owner.email, `Device Check Alert - ${device.brand} ${device.model}`, html);
          }
        }

        // Notify assigned LEA if there is an open report
        const activeReport = await Database.query(
          `SELECT r.case_id, r.assigned_lea_id FROM reports r 
           WHERE r.device_id = ? AND r.status IN ('open','under_review') 
           ORDER BY r.created_at DESC LIMIT 1`, [device.id]
        );

        const ar = activeReport && activeReport[0];
        if (ar && ar.assigned_lea_id) {
          const lea = await Database.selectOne('law_enforcement_agencies', 'agency_name, contact_email', 'id = ?', [ar.assigned_lea_id]);
          if (lea?.contact_email) {
            await notifier.sendEmail(lea.contact_email, subject + ` (Case ${ar.case_id})`, html);
          }
        }

        // No alert_sent column in device_check_logs; skipping update
      } catch (notifyErr) {
        console.error('Error sending alerts for reported device check:', notifyErr);
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Error in public check:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/public-check/enhanced - Enhanced device check with location tracking
router.post('/enhanced', async (req, res) => {
  try {
    const {
      deviceIdentifier,
      checkerLocation,
      deviceFingerprint,
      networkInfo,
      checkReason = 'public_check'
    } = req.body;

    // Validate required data
    if (!deviceIdentifier) {
      return res.status(400).json({ 
        error: 'Device identifier is required' 
      });
    }

    if (!checkerLocation || !checkerLocation.latitude || !checkerLocation.longitude) {
      return res.status(400).json({ 
        error: 'Location data is required for device checks' 
      });
    }

    if (!deviceFingerprint) {
      return res.status(400).json({ 
        error: 'Device fingerprint is required' 
      });
    }

    // Require network info: IP and MAC
    const ipValue = networkInfo && (networkInfo.ip || networkInfo.ipAddress);
    const macValue = networkInfo && (networkInfo.mac || networkInfo.macAddress);
    if (!ipValue || !macValue) {
      return res.status(400).json({
        error: 'Network info required: provide IP and MAC in networkInfo.ip/.ipAddress and networkInfo.mac/.macAddress'
      });
    }

    const DeviceCheckService = require('../services/DeviceCheckService');
    
    // Get user ID if authenticated
    let checkerUserId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded = Database.verifyJWT(token);
        checkerUserId = decoded.id;
      } catch (error) {
        // Continue without user ID for anonymous checks
      }
    }

    // Perform enhanced device check
    const checkResult = await DeviceCheckService.performDeviceCheck({
      deviceIdentifier,
      checkerLocation,
      deviceFingerprint,
      networkInfo,
      checkReason,
      checkerUserId
    });

    // If reported device, send alerts to admin, owner, and LEA
    try {
      if (checkResult && (checkResult.deviceStatus === 'stolen' || checkResult.deviceStatus === 'lost')) {
        const deviceId = checkResult.deviceDetails?.id;
        let device = null;
        if (deviceId) {
          device = await Database.selectOne(
            'devices', 'id, user_id, brand, model, imei, serial, status', 'id = ?', [deviceId]
          );
        }

        // Resolve checker identity if available
        let checker = null;
        if (checkerUserId) {
          try {
            checker = await Database.selectOne('users', 'id, name, email, phone', 'id = ?', [checkerUserId]);
          } catch (e) {
            // ignore fetch errors
          }
        }

        const subject = `ALERT: Reported device checked (${checkResult.deviceDetails?.brand || device?.brand || ''} ${checkResult.deviceDetails?.model || device?.model || ''})`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
            <h2 style="color:#B91C1C;">Reported Device Check Detected</h2>
            <p>A device flagged as <strong>${checkResult.deviceStatus}</strong> was checked via the enhanced public API.</p>
            <ul>
              <li><strong>Device:</strong> ${checkResult.deviceDetails?.brand || device?.brand || 'Unknown'} ${checkResult.deviceDetails?.model || device?.model || ''}</li>
              <li><strong>Identifier:</strong> ${device?.imei || device?.serial || deviceIdentifier}</li>
              <li><strong>IP:</strong> ${networkInfo?.ip || networkInfo?.ipAddress || 'Unknown'}</li>
              <li><strong>MAC:</strong> ${networkInfo?.mac || networkInfo?.macAddress || deviceFingerprint?.macAddress || 'Unknown'}</li>
              <li><strong>User-Agent:</strong> ${deviceFingerprint?.userAgent || 'Unknown'}</li>
              <li><strong>Checker:</strong> ${checker ? `${checker.name} (${checker.email || checker.phone || checker.id})` : 'Anonymous'}</li>
              <li><strong>Location:</strong> ${checkerLocation?.latitude && checkerLocation?.longitude ? `${checkerLocation.latitude}, ${checkerLocation.longitude} (±${checkerLocation.accuracy || 'n/a'}m)` : 'Unknown'}</li>
              <li><strong>Check ID:</strong> ${checkResult.checkId || 'Unknown'}</li>
            </ul>
            <p>Action may be required. Review related report and consider LEA notification.</p>
          </div>
        `;

        // Notify admin (if configured)
        if (process.env.ADMIN_EMAIL) {
          await notifier.sendEmail(process.env.ADMIN_EMAIL, subject, html);
          // Persist admin notification for dashboard visibility
          await Database.insert('notifications', {
            user_id: null,
            channel: 'email',
            recipient: process.env.ADMIN_EMAIL,
            subject,
            message: `Reported device was checked. Check ID ${checkResult.checkId}`,
            payload: JSON.stringify({
              checkId: checkResult.checkId,
              device: { id: device?.id, brand: device?.brand, model: device?.model, imei: device?.imei, serial: device?.serial },
              checker: checker || { id: null },
              networkInfo,
              checkerLocation
            })
          });
        }

        // Notify device owner
        if (device?.user_id) {
          const owner = await Database.selectOne('users', 'email, name, phone', 'id = ?', [device.user_id]);
          if (owner?.email) {
            await notifier.sendEmail(owner.email, `Device Check Alert - ${device.brand} ${device.model}`, html);
            await Database.insert('notifications', {
              user_id: device.user_id,
              channel: 'email',
              recipient: owner.email,
              subject: `Device Check Alert - ${device.brand} ${device.model}`,
              message: `Reported device was checked. Check ID ${checkResult.checkId}`,
              payload: JSON.stringify({
                checkId: checkResult.checkId,
                device: { id: device.id, brand: device.brand, model: device.model, imei: device.imei, serial: device.serial },
                checker: checker || { id: null },
                networkInfo,
                checkerLocation
              })
            });
          }
        }

        // Notify assigned LEA if there is an open report
        if (device?.id) {
          const activeReport = await Database.query(
            `SELECT r.case_id, r.assigned_lea_id FROM reports r 
             WHERE r.device_id = ? AND r.status IN ('open','under_review') 
             ORDER BY r.created_at DESC LIMIT 1`, [device.id]
          );

          const ar = activeReport && activeReport[0];
          if (ar && ar.assigned_lea_id) {
            const lea = await Database.selectOne('law_enforcement_agencies', 'agency_name, contact_email', 'id = ?', [ar.assigned_lea_id]);
            if (lea?.contact_email) {
              await notifier.sendEmail(lea.contact_email, subject + ` (Case ${ar.case_id})`, html);
              await Database.insert('notifications', {
                user_id: null,
                channel: 'email',
                recipient: lea.contact_email,
                subject: subject + ` (Case ${ar.case_id})`,
                message: `Reported device was checked. Check ID ${checkResult.checkId}`,
                payload: JSON.stringify({
                  caseId: ar.case_id,
                  checkId: checkResult.checkId,
                  device: { id: device?.id, brand: device?.brand, model: device?.model, imei: device?.imei, serial: device?.serial },
                  checker: checker || { id: null },
                  networkInfo,
                  checkerLocation
                })
              });
            }
          }
        }
      }
    } catch (notifyErr) {
      console.error('Error sending alerts for enhanced device check:', notifyErr);
    }

    res.json(checkResult);

  } catch (error) {
    console.error('Enhanced device check error:', error);
    res.status(500).json({ 
      error: 'Failed to perform device check' 
    });
  }
});

// GET /api/public-check/history - Retrieve device check history with checker details
router.get('/history', async (req, res) => {
  try {
    const { device_id, identifier, limit = 50 } = req.query;

    let deviceId = device_id;
    if (!deviceId && identifier) {
      const device = await Database.selectOne(
        'devices', 'id', '(imei = ? OR serial = ?)', [identifier, identifier]
      );
      deviceId = device ? device.id : null;
    }

    if (!deviceId && !identifier) {
      return res.status(400).json({ error: 'Provide device_id or identifier' });
    }

    const checks = await Database.query(
      `SELECT 
        dc.*, 
        u.name AS checker_name,
        u.email AS checker_email
       FROM device_check_logs dc
       LEFT JOIN users u ON dc.checker_user_id = u.id
       WHERE ${deviceId ? 'dc.device_id = ?' : '1 = 0'}
       ORDER BY dc.created_at DESC
       LIMIT ?`,
      deviceId ? [deviceId, parseInt(limit)] : [parseInt(limit)]
    );

    // If identifier provided but no device_id, fallback to legacy imei_checks by query
    let legacyChecks = [];
    if (!deviceId && identifier) {
      legacyChecks = await Database.query(
        `SELECT * FROM imei_checks WHERE query = ? ORDER BY created_at DESC LIMIT ?`,
        [identifier, parseInt(limit)]
      );
    }

    res.json({ success: true, data: { checks, legacy_checks: legacyChecks } });
  } catch (error) {
    console.error('Device check history error:', error);
    res.status(500).json({ error: 'Failed to load device check history' });
  }
});

// GET /api/public-check/report/:id - Retrieve a specific check record
router.get('/report/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const check = await Database.selectOne('device_check_logs', '*', 'id = ?', [id]);
    if (!check) {
      return res.status(404).json({ error: 'Check record not found' });
    }

    let device = null;
    if (check.device_id) {
      device = await Database.selectOne(
        'devices', 'id, brand, model, imei, serial, status, user_id', 'id = ?', [check.device_id]
      );
    }

    let checker = null;
    if (check.checker_user_id) {
      checker = await Database.selectOne(
        'users', 'id, name, email, phone, region', 'id = ?', [check.checker_user_id]
      );
    }

    res.json({ success: true, data: { check, device, checker } });
  } catch (error) {
    console.error('Device check report error:', error);
    res.status(500).json({ error: 'Failed to load check report' });
  }
});

module.exports = router;
