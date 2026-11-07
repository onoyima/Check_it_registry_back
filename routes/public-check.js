// Public Device Check Route - MySQL Version
const express = require('express');
const { escapeHtml } = require('../utils/escape-html');
const Database = require('../config');
const notifier = require('../services/EnhancedNotificationService');
const RevenueService = require('../services/RevenueService');
const FraudDetectionService = require('../services/FraudDetectionService');
const DeviceCheckService = require('../services/DeviceCheckService');
const CheckCapture = require('../services/CheckCaptureService');
const { getDisplayName, nameSelectColumns } = require('../utils/user-helpers');

const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// Device checks are for registered, logged-in users only. Every check is
// attributed to the checker and kept in the device's check history.
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

// GET /api/public-check - the old way to check (headers for location and a
// "MAC address"). Closed: every check goes through POST /enhanced, which
// takes the checker's photo, location and the price rules.
router.get('/', authenticateToken, (req, res) => {
  res.status(410).json({ error: 'Use the Check an item page to check an item.' });
});

// How many free checks of other people's items this person has left
router.get('/allowance', authenticateToken, async (req, res) => {
  try {
    const a = await CheckCapture.allowance(req.user.id);
    const fee = await RevenueService.getFee('device_check_fee').catch(() => null);
    res.json({ ...a, fee });
  } catch (error) {
    if (error.priceNotSet) return res.json({ freeLimit: null, used: null, remaining: 0, fee: null, notSet: true });
    console.error('Check allowance error:', error);
    res.status(500).json({ error: 'Could not load your free checks' });
  }
});

// GET /api/public-check/certificate/:code - a buyer confirms the check
// certificate a seller shows them. Free, for signed-in people.
router.get('/certificate/:code', authenticateToken, async (req, res) => {
  try {
    const cert = await CheckCapture.readCertificate(req.params.code, req.user, req);
    if (!cert) return res.status(404).json({ error: "We couldn't find a certificate with that code. Check it and try again." });
    res.json({ success: true, certificate: cert });
  } catch (error) {
    console.error('Certificate lookup error:', error);
    res.status(500).json({ error: 'Could not check the certificate' });
  }
});

// POST /api/public-check/enhanced - Enhanced device check with location tracking
router.post('/enhanced', authenticateToken, async (req, res) => {
  try {
    const {
      deviceIdentifier,
      checkerLocation,
      deviceFingerprint,
      networkInfo,
      selfie,
      checkReason = 'public_check'
    } = req.body;

    // Validate required data
    if (!deviceIdentifier) {
      return res.status(400).json({ error: 'Device identifier is required' });
    }
    if (!checkerLocation || checkerLocation.latitude == null || checkerLocation.longitude == null) {
      return res.status(400).json({ error: 'Location data is required for device checks' });
    }
    if (!deviceFingerprint) {
      return res.status(400).json({ error: 'Device fingerprint is required' });
    }
    // A photo of the person checking, taken with their camera just now
    const photo = CheckCapture.parseSelfie(selfie);
    if (!photo) {
      return res.status(400).json({ error: 'A photo of you is needed to check an item. Allow the camera and take the photo.' });
    }

    const checkerUserId = req.user.id;
    // The address this request came from, as our server sees it (behind the
    // VPS's web server this needs TRUST_PROXY set, see .env.example). The
    // address the browser claims is kept separately, for comparison only.
    const serverIp = CheckCapture.clientIp(req);
    const reportedIp = CheckCapture.cleanIp(networkInfo?.ip || networkInfo?.ipAddress);
    const browserDeviceId = CheckCapture.browserDeviceId(req);

    // Fraud scoring must never stop a genuine check from answering
    await FraudDetectionService.checkAndFlag(checkerUserId, 'DEVICE_CHECK', {
      ipAddress: serverIp, macAddress: null, deviceId: browserDeviceId,
    }).catch((e) => console.error('Device check: fraud scoring skipped:', e.message));

    // What it costs: your own item is free; other people's items are free
    // for the first few checks (admin setting), then the admin's price
    const target = await DeviceCheckService.findDeviceByIdentifier(String(deviceIdentifier).trim()).catch(() => null);
    const isOwnItem = !!(target && target.user_id === checkerUserId);
    let feePaid = null;
    if (!isOwnItem) {
      const allowance = await CheckCapture.allowance(checkerUserId);
      if (allowance.remaining <= 0) {
        const fee = await RevenueService.getFee('device_check_fee');
        if (fee > 0) {
          const { pay_by_pass } = req.body;
          if (!pay_by_pass) {
            return res.json({
              requiresPayment: true,
              amount: fee,
              purpose: 'Device Check Fee',
              message: `You've used your ${allowance.freeLimit} free checks of other people's items. This check costs ₦${fee.toLocaleString()}.`
            });
          }
          const paidInvoice = await RevenueService.redeemPaidInvoice(checkerUserId, pay_by_pass, ['device_check_fee']);
          if (!paidInvoice) {
            return res.status(402).json({
              requiresPayment: true,
              amount: fee,
              error: 'We could not confirm your payment for this check. If you were charged, contact support with your payment reference.'
            });
          }
          await RevenueService.chargeForCheck(checkerUserId, fee, paidInvoice.reference);
          feePaid = fee;
        }
      }
    }

    // Store the photo (private: only the checker, admins and police see it)
    const selfieUrl = await CheckCapture.saveSelfie(photo, checkerUserId);

    // Perform enhanced device check
    const checkResult = await DeviceCheckService.performDeviceCheck({
      deviceIdentifier,
      checkerLocation,
      deviceFingerprint,
      networkInfo,
      checkReason,
      checkerUserId,
      capture: { searchedIdentifier: String(deviceIdentifier).trim().slice(0, 64), isOwnItem, selfieUrl, serverIp, reportedIp, browserDeviceId, feePaid },
    });

    // An owner checking their own item gets a certificate to show a buyer
    if (isOwnItem && checkResult?.checkId) {
      checkResult.certificate = await CheckCapture.issueCertificate(checkResult.checkId).catch((e) => {
        console.error('Certificate not issued:', e.message); return null;
      });
    }
    checkResult.ownItem = isOwnItem;

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
            checker = await Database.selectOne('users', 'id, name, first_name, middle_name, last_name, email, phone', 'id = ?', [checkerUserId]);
          } catch (e) {
            // ignore fetch errors
          }
        }

        const subject = `ALERT: Reported device checked (${checkResult.deviceDetails?.brand || device?.brand || ''} ${checkResult.deviceDetails?.model || device?.model || ''})`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
            <h2 style="color:#B91C1C;">Reported Device Check Detected</h2>
            <p>An item reported <strong>${escapeHtml(checkResult.deviceStatus)}</strong> was just checked on Prove Ownership.</p>
            <ul>
              <li><strong>Device:</strong> ${escapeHtml(checkResult.deviceDetails?.brand || device?.brand || 'Unknown')} ${escapeHtml(checkResult.deviceDetails?.model || device?.model || '')}</li>
              <li><strong>Identifier:</strong> ${escapeHtml(String(device?.imei || device?.serial || deviceIdentifier))}</li>
              <li><strong>IP address:</strong> ${escapeHtml(serverIp || 'Unknown')}</li>
              <li><strong>Browser ID:</strong> ${escapeHtml(browserDeviceId || 'Unknown')}</li>
              <li><strong>Browser:</strong> ${escapeHtml(req.get('User-Agent') || 'Unknown')}</li>
              <li><strong>Photo:</strong> taken at the check (see the check in the admin or police portal)</li>
              <li><strong>Checker:</strong> ${checker ? escapeHtml(`${getDisplayName(checker)} (${checker.email || checker.phone || checker.id})`) : 'Anonymous'}</li>
              <li><strong>Location:</strong> ${checkerLocation?.latitude != null && checkerLocation?.longitude != null ? `${Number(checkerLocation.latitude)}, ${Number(checkerLocation.longitude)} (±${Number(checkerLocation.accuracy) || 'n/a'}m) <a href="https://maps.google.com/?q=${Number(checkerLocation.latitude)},${Number(checkerLocation.longitude)}">map</a>` : 'Unknown'}</li>
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
          const owner = await Database.selectOne('users', 'email, name, first_name, middle_name, last_name, phone', 'id = ?', [device.user_id]);
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
    // A price the admin hasn't set yet: say so instead of charging anything
    if (error.priceNotSet) return res.status(503).json({ error: error.message });
    console.error('Enhanced device check error:', error);
    try { require('../services/ErrorStore').capture(error, req); } catch (_) { /* ignore */ }
    // Bad input (missing location etc.) is the checker's to fix, so say what it is
    if (error.status === 400 || /^(Missing required field|Invalid location data|Invalid GPS coordinates)/.test(error.message || '')) {
      return res.status(400).json({ error: error.message === 'Invalid location data' ? 'We could not read your location. Turn on location and try again.' : error.message });
    }
    res.status(500).json({ 
      // Outside production, say what went wrong so it can be fixed quickly
      ...(process.env.NODE_ENV !== 'production' ? { detail: error.message } : {}),
      error: 'Failed to perform device check' 
    });
  }
});

// GET /api/public-check/history - Retrieve device check history with checker details
// Check history / tracker: who checked a device, when and from where.
// Available to logged-in users.
// GET /api/public-check/mine - the checks I made, newest first
router.get('/mine', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const checks = await Database.query(
      `SELECT dc.id, dc.device_id, dc.check_type, dc.check_result, dc.is_paid, dc.created_at,
              d.brand, d.model, d.category, d.status AS device_status
       FROM device_check_logs dc
       LEFT JOIN devices d ON dc.device_id = d.id
       WHERE dc.checker_user_id = ?
       ORDER BY dc.created_at DESC
       LIMIT ?`, [req.user.id, limit]);
    res.json({ success: true, data: { checks } });
  } catch (error) {
    console.error('My checks error:', error);
    res.status(500).json({ error: 'Failed to load your checks' });
  }
});

const STAFF = ['admin', 'lea'];

router.get('/history', authenticateToken, async (req, res) => {
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

    // "Who checked this item" belongs to the item's owner (and staff), not
    // to anyone who knows its number: it shows the checkers' details.
    if (!STAFF.includes(req.user.role)) {
      const owned = deviceId ? await Database.selectOne('devices', 'id', 'id = ? AND user_id = ?', [deviceId, req.user.id]) : null;
      if (!owned) return res.status(403).json({ error: 'Only the owner can see who checked this item' });
    }

    const checks = await Database.query(
      `SELECT 
        dc.*, 
        u.name AS checker_name,
        u.first_name AS checker_first_name,
        u.middle_name AS checker_middle_name,
        u.last_name AS checker_last_name,
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

    res.json({ success: true, data: { checks: checks.map((c) => CheckCapture.forViewer(c, req.user)), legacy_checks: STAFF.includes(req.user.role) ? legacyChecks : [] } });
  } catch (error) {
    console.error('Device check history error:', error);
    res.status(500).json({ error: 'Failed to load device check history' });
  }
});

// GET /api/public-check/report/:id - Retrieve a specific check record
router.get('/report/:id', authenticateToken, async (req, res) => {
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
    // Only the person who checked, the item's owner, or staff may read it
    const allowed = STAFF.includes(req.user.role) || check.checker_user_id === req.user.id || (device && device.user_id === req.user.id);
    if (!allowed) return res.status(404).json({ error: 'Check record not found' });

    let checker = null;
    if (check.checker_user_id) {
      checker = await Database.selectOne(
        'users', 'id, name, first_name, middle_name, last_name, email, phone, region', 'id = ?', [check.checker_user_id]
      );
    }

    res.json({ success: true, data: { check: CheckCapture.forViewer(check, req.user), device, checker } });
  } catch (error) {
    console.error('Device check report error:', error);
    res.status(500).json({ error: 'Failed to load check report' });
  }
});

module.exports = router;
