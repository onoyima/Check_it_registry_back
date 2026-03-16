// Found Device Reporting Routes
const express = require('express');
const Database = require('../config');
const NotificationService = require('../services/NotificationService');

const router = express.Router();

// Report a found device (public endpoint)
router.post('/report', async (req, res) => {
  try {
    const { 
      imei, 
      serial, 
      finder_name, 
      finder_contact, 
      finder_email,
      location_found, 
      description, 
      condition_notes,
      finder_id_proof 
    } = req.body;

    // Validate required fields
    if (!imei && !serial) {
      return res.status(400).json({ error: 'Either IMEI or serial number is required' });
    }

    if (!finder_name || !finder_contact) {
      return res.status(400).json({ error: 'Finder name and contact information are required' });
    }

    if (!location_found) {
      return res.status(400).json({ error: 'Location where device was found is required' });
    }

    // Find the device in the registry
    let device = null;
    if (imei) {
      device = await Database.selectOne('devices', '*', 'imei = ?', [imei]);
    }
    if (!device && serial) {
      device = await Database.selectOne('devices', '*', 'serial = ?', [serial]);
    }

    if (!device) {
      return res.status(404).json({ 
        error: 'Device not found in registry',
        message: 'This device is not registered in our system. Please contact local authorities directly.'
      });
    }

    // Check if device is reported as stolen/lost
    const existingReport = await Database.selectOne(
      'reports', 
      '*', 
      'device_id = ? AND report_type IN ("stolen", "lost") AND status != "resolved"',
      [device.id]
    );

    if (!existingReport) {
      return res.status(400).json({ 
        error: 'Device not reported as stolen or lost',
        message: 'This device is not currently reported as stolen or lost. If you believe this is an error, please contact the owner directly or local authorities.'
      });
    }

    // Generate case ID for found report
    const foundCaseId = Database.generateCaseId();

    // Get device owner information
    const owner = await Database.selectOne('users', '*', 'id = ?', [device.user_id]);
    
    // Get LEA for the region
    const lea = await Database.selectOne(
      'law_enforcement_agencies',
      '*',
      'region = ? AND active = TRUE',
      [owner.region]
    );

    // Create found device report
    const foundReportId = Database.generateUUID();
    await Database.insert('reports', {
      id: foundReportId,
      device_id: device.id,
      report_type: 'found',
      reporter_id: null, // Anonymous finder
      description: `Device found by ${finder_name}. Location: ${location_found}. ${description || ''}`,
      occurred_at: new Date(),
      location: location_found,
      status: 'open',
      case_id: foundCaseId,
      assigned_lea_id: lea ? lea.id : null,
      lea_notes: `FINDER DETAILS:\nName: ${finder_name}\nContact: ${finder_contact}\nEmail: ${finder_email || 'Not provided'}\nCondition: ${condition_notes || 'Not specified'}\nID Proof: ${finder_id_proof || 'Not provided'}`,
      created_at: new Date()
    });

    // Update original stolen/lost report status
    await Database.update('reports', {
      status: 'under_review',
      lea_notes: `${existingReport.lea_notes || ''}\n\n[FOUND DEVICE REPORT]\nFound report filed: ${foundCaseId}\nFinder: ${finder_name}\nLocation: ${location_found}\nDate: ${new Date().toISOString()}`,
      updated_at: new Date()
    }, 'id = ?', [existingReport.id]);

    // Update device status
    await Database.update('devices', {
      status: 'found',
      updated_at: new Date()
    }, 'id = ?', [device.id]);

    // Log the found device check
    await Database.insert('imei_checks', {
      id: Database.generateUUID(),
      query: imei || serial,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      result: JSON.stringify({
        status: 'found_device_reported',
        case_id: foundCaseId,
        original_case: existingReport.case_id
      }),
      created_at: new Date()
    });

    // Send notifications
    try {
      // Notify device owner
      await NotificationService.notifyDeviceFound(
        owner.id,
        {
          brand: device.brand,
          model: device.model,
          imei: device.imei,
          serial: device.serial
        },
        {
          name: finder_name,
          contact: finder_contact,
          email: finder_email
        },
        foundCaseId
      );

      // Notify LEA
      if (lea) {
        await NotificationService.queueNotification(
          null,
          'email',
          lea.contact_email,
          `Found Device Report - ${foundCaseId}`,
          `
            <h2>Found Device Report</h2>
            <p>A device has been reported as found and needs coordination for return.</p>
            <p><strong>Found Case ID:</strong> ${foundCaseId}</p>
            <p><strong>Original Case ID:</strong> ${existingReport.case_id}</p>
            <p><strong>Device:</strong> ${device.brand} ${device.model}</p>
            <p><strong>IMEI:</strong> ${device.imei || 'Not provided'}</p>
            <p><strong>Serial:</strong> ${device.serial || 'Not provided'}</p>
            <p><strong>Found Location:</strong> ${location_found}</p>
            <p><strong>Finder:</strong> ${finder_name}</p>
            <p><strong>Finder Contact:</strong> ${finder_contact}</p>
            <p><strong>Owner:</strong> ${owner.name} (${owner.email})</p>
            <p>Please coordinate the return of this device to its rightful owner.</p>
          `,
          {
            caseId: foundCaseId,
            originalCase: existingReport.case_id,
            type: 'found_device_coordination'
          }
        );
      }

    } catch (notificationError) {
      console.error('Notification error:', notificationError);
      // Don't fail the request if notifications fail
    }

    res.json({
      success: true,
      message: 'Found device report submitted successfully',
      case_id: foundCaseId,
      original_case_id: existingReport.case_id,
      next_steps: [
        'Law enforcement has been notified',
        'The device owner has been contacted',
        'You will be contacted by authorities to coordinate the return',
        'Please keep the device safe until authorities contact you'
      ],
      lea_contact: lea ? {
        agency: lea.agency_name,
        phone: lea.contact_phone,
        email: lea.contact_email
      } : null
    });

  } catch (error) {
    console.error('Found device report error:', error);
    res.status(500).json({ error: 'Failed to submit found device report' });
  }
});

// Check if a device can be reported as found (public endpoint)
router.get('/check', async (req, res) => {
  try {
    const { imei, serial } = req.query;

    if (!imei && !serial) {
      return res.status(400).json({ error: 'Either IMEI or serial number is required' });
    }

    // Find the device
    let device = null;
    if (imei) {
      device = await Database.selectOne('devices', '*', 'imei = ?', [imei]);
    }
    if (!device && serial) {
      device = await Database.selectOne('devices', '*', 'serial = ?', [serial]);
    }

    if (!device) {
      return res.json({
        found_eligible: false,
        reason: 'Device not registered in our system',
        message: 'This device is not in our registry. If you found this device, please contact local authorities.'
      });
    }

    // Check if device is reported as stolen/lost
    const activeReport = await Database.selectOne(
      'reports',
      '*',
      'device_id = ? AND report_type IN ("stolen", "lost") AND status IN ("open", "under_review")',
      [device.id]
    );

    if (!activeReport) {
      return res.json({
        found_eligible: false,
        reason: 'Device not reported as stolen or lost',
        message: 'This device is not currently reported as stolen or lost.',
        device_info: {
          brand: device.brand,
          model: device.model,
          status: device.status
        }
      });
    }

    // Check if already reported as found
    const foundReport = await Database.selectOne(
      'reports',
      '*',
      'device_id = ? AND report_type = "found" AND status != "resolved"',
      [device.id]
    );

    if (foundReport) {
      return res.json({
        found_eligible: false,
        reason: 'Device already reported as found',
        message: `This device has already been reported as found (Case: ${foundReport.case_id}). If you have additional information, please contact law enforcement.`,
        existing_case: foundReport.case_id
      });
    }

    // Device is eligible to be reported as found
    res.json({
      found_eligible: true,
      message: 'This device can be reported as found',
      device_info: {
        brand: device.brand,
        model: device.model,
        status: device.status
      },
      original_case: {
        case_id: activeReport.case_id,
        report_type: activeReport.report_type,
        reported_date: activeReport.created_at
      }
    });

  } catch (error) {
    console.error('Found device check error:', error);
    res.status(500).json({ error: 'Failed to check device eligibility' });
  }
});

// Get found device reports (for LEA/Admin)
router.get('/reports', async (req, res) => {
  try {
    // This endpoint requires authentication
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Simple token verification (you might want to use the full auth middleware)
    const token = authHeader.split(' ')[1];
    let user;
    try {
      user = Database.verifyJWT(token);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Only LEA and admin can access
    if (!['lea', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { status, page = 1, limit = 20 } = req.query;

    // Build filters
    let whereClause = 'r.report_type = "found"';
    let params = [];

    // Region filter for LEA
    if (user.role === 'lea') {
      whereClause += ' AND u.region = ?';
      params.push(user.region);
    }

    if (status) {
      whereClause += ' AND r.status = ?';
      params.push(status);
    }

    const offset = (page - 1) * limit;

    const foundReports = await Database.query(`
      SELECT 
        r.id,
        r.case_id,
        r.status,
        r.description,
        r.location,
        r.lea_notes,
        r.created_at,
        r.updated_at,
        d.brand,
        d.model,
        d.imei,
        d.serial,
        u.name as owner_name,
        u.email as owner_email,
        u.phone as owner_phone,
        u.region,
        lea.agency_name,
        original_report.case_id as original_case_id,
        original_report.report_type as original_type
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
      LEFT JOIN reports original_report ON original_report.device_id = d.id 
        AND original_report.report_type IN ('stolen', 'lost') 
        AND original_report.id != r.id
      WHERE ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    res.json({
      found_reports: foundReports,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: foundReports.length // You might want to get actual count
      }
    });

  } catch (error) {
    console.error('Found reports error:', error);
    res.status(500).json({ error: 'Failed to load found device reports' });
  }
});

module.exports = router;