// Dashboard Configuration Routes
const express = require('express');
const Database = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// All routes require admin access
router.use(authenticateToken);
router.use(requireRole(['admin']));

// Get dashboard configuration
router.get('/config', async (req, res) => {
  try {
    // Get system-wide configuration
    const config = {
      system_info: {
        name: 'Check It Device Registry',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        api_url: process.env.BASE_URL || 'http://localhost:3006',
        frontend_url: process.env.FRONTEND_URL || 'http://localhost:5173'
      },
      features: {
        email_notifications: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
        sms_notifications: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
        push_notifications: !!process.env.FCM_SERVER_KEY,
        file_uploads: true,
        background_jobs: true,
        audit_logging: true
      },
      limits: {
        max_file_size_mb: parseInt(process.env.UPLOAD_MAX_SIZE) / 1024 / 1024 || 10,
        allowed_file_types: (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,application/pdf').split(','),
        session_timeout_hours: 24,
        transfer_expiry_hours: 24
      },
      regional_settings: await getRegionalSettings(),
      notification_templates: await getNotificationTemplates(),
      dashboard_widgets: await getDashboardWidgets()
    };

    res.json({
      success: true,
      configuration: config,
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Dashboard config error:', error);
    res.status(500).json({ error: 'Failed to load dashboard configuration' });
  }
});

// Get regional settings
async function getRegionalSettings() {
  try {
    const regions = await Database.query(`
      SELECT 
        u.region,
        COUNT(DISTINCT u.id) as user_count,
        COUNT(DISTINCT d.id) as device_count,
        COUNT(DISTINCT lea.id) as lea_count,
        lea.agency_name,
        lea.contact_email,
        lea.contact_phone
      FROM users u
      LEFT JOIN devices d ON u.id = d.user_id
      LEFT JOIN law_enforcement_agencies lea ON u.region = lea.region AND lea.active = TRUE
      WHERE u.region IS NOT NULL
      GROUP BY u.region, lea.id
      ORDER BY user_count DESC
    `);

    return regions;
  } catch (error) {
    console.error('Regional settings error:', error);
    return [];
  }
}

// Get notification templates
async function getNotificationTemplates() {
  return {
    device_verified: {
      subject: 'Device Verification Approved',
      template: 'Your device {{device_brand}} {{device_model}} has been verified and approved.'
    },
    device_rejected: {
      subject: 'Device Verification Rejected',
      template: 'Your device verification was rejected. Reason: {{rejection_reason}}'
    },
    device_stolen: {
      subject: 'Device Reported Stolen - Case {{case_id}}',
      template: 'Your device has been marked as stolen. Case ID: {{case_id}}'
    },
    device_found: {
      subject: 'Your Device May Have Been Found - Case {{case_id}}',
      template: 'Someone has reported finding your device. Case ID: {{case_id}}'
    },
    transfer_request: {
      subject: 'Device Transfer Request',
      template: 'You have received a device transfer request. Transfer code: {{transfer_code}}'
    },
    lea_new_case: {
      subject: 'New Case Assignment - {{case_id}}',
      template: 'A new case has been assigned to your agency. Case ID: {{case_id}}'
    }
  };
}

// Get dashboard widgets configuration
async function getDashboardWidgets() {
  return {
    admin_widgets: [
      {
        id: 'system_overview',
        title: 'System Overview',
        type: 'stats',
        enabled: true,
        position: { row: 1, col: 1 },
        size: { width: 4, height: 2 }
      },
      {
        id: 'verification_queue',
        title: 'Device Verification Queue',
        type: 'list',
        enabled: true,
        position: { row: 1, col: 5 },
        size: { width: 4, height: 2 }
      },
      {
        id: 'recent_reports',
        title: 'Recent Reports',
        type: 'list',
        enabled: true,
        position: { row: 2, col: 1 },
        size: { width: 8, height: 3 }
      },
      {
        id: 'regional_stats',
        title: 'Regional Statistics',
        type: 'chart',
        enabled: true,
        position: { row: 3, col: 1 },
        size: { width: 4, height: 3 }
      },
      {
        id: 'system_health',
        title: 'System Health',
        type: 'status',
        enabled: true,
        position: { row: 3, col: 5 },
        size: { width: 4, height: 3 }
      }
    ],
    user_widgets: [
      {
        id: 'my_devices',
        title: 'My Devices',
        type: 'list',
        enabled: true,
        position: { row: 1, col: 1 },
        size: { width: 6, height: 3 }
      },
      {
        id: 'my_reports',
        title: 'My Reports',
        type: 'list',
        enabled: true,
        position: { row: 1, col: 7 },
        size: { width: 6, height: 3 }
      },
      {
        id: 'quick_actions',
        title: 'Quick Actions',
        type: 'actions',
        enabled: true,
        position: { row: 2, col: 1 },
        size: { width: 12, height: 2 }
      }
    ],
    lea_widgets: [
      {
        id: 'assigned_cases',
        title: 'Assigned Cases',
        type: 'list',
        enabled: true,
        position: { row: 1, col: 1 },
        size: { width: 8, height: 4 }
      },
      {
        id: 'case_statistics',
        title: 'Case Statistics',
        type: 'stats',
        enabled: true,
        position: { row: 1, col: 9 },
        size: { width: 4, height: 4 }
      }
    ]
  };
}

// Update system configuration
router.put('/config/system', async (req, res) => {
  try {
    const { system_name, maintenance_mode, announcement } = req.body;

    // In a full implementation, you would store these in a configuration table
    // For now, we'll log the configuration changes

    await Database.logAudit(
      req.user.id,
      'SYSTEM_CONFIG_UPDATE',
      'system_config',
      null,
      null,
      {
        system_name: system_name,
        maintenance_mode: maintenance_mode,
        announcement: announcement
      },
      req.ip
    );

    res.json({
      success: true,
      message: 'System configuration updated successfully',
      updated_by: req.user.name,
      updated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('System config update error:', error);
    res.status(500).json({ error: 'Failed to update system configuration' });
  }
});

// Update notification templates
router.put('/config/notifications', async (req, res) => {
  try {
    const { templates } = req.body;

    if (!templates || typeof templates !== 'object') {
      return res.status(400).json({ error: 'Templates object is required' });
    }

    // In a full implementation, you would store these in a database table
    // For now, we'll log the template updates

    await Database.logAudit(
      req.user.id,
      'NOTIFICATION_TEMPLATES_UPDATE',
      'notification_templates',
      null,
      null,
      { templates: templates },
      req.ip
    );

    res.json({
      success: true,
      message: 'Notification templates updated successfully',
      updated_by: req.user.name,
      updated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Notification templates update error:', error);
    res.status(500).json({ error: 'Failed to update notification templates' });
  }
});

// Manage LEA agencies
router.get('/lea-agencies', async (req, res) => {
  try {
    const agencies = await Database.query(`
      SELECT 
        lea.*,
        COUNT(r.id) as assigned_cases,
        COUNT(CASE WHEN r.status = 'open' THEN 1 END) as open_cases,
        COUNT(CASE WHEN r.status = 'resolved' THEN 1 END) as resolved_cases
      FROM law_enforcement_agencies lea
      LEFT JOIN reports r ON lea.id = r.assigned_lea_id
      GROUP BY lea.id
      ORDER BY lea.agency_name
    `);

    res.json({
      success: true,
      agencies: agencies
    });

  } catch (error) {
    console.error('LEA agencies error:', error);
    res.status(500).json({ error: 'Failed to load LEA agencies' });
  }
});

// Add new LEA agency
router.post('/lea-agencies', async (req, res) => {
  try {
    const { 
      agency_name, 
      contact_email, 
      contact_phone, 
      region, 
      address, 
      jurisdiction_type = 'local' 
    } = req.body;

    if (!agency_name || !contact_email || !region) {
      return res.status(400).json({ 
        error: 'Agency name, contact email, and region are required' 
      });
    }

    // Check if agency already exists in region
    const existingAgency = await Database.selectOne(
      'law_enforcement_agencies',
      'id',
      'region = ? AND agency_name = ?',
      [region, agency_name]
    );

    if (existingAgency) {
      return res.status(409).json({ 
        error: 'Agency with this name already exists in the region' 
      });
    }

    const agencyId = Database.generateUUID();
    await Database.insert('law_enforcement_agencies', {
      id: agencyId,
      agency_name: agency_name,
      contact_email: contact_email,
      contact_phone: contact_phone,
      region: region,
      address: address,
      jurisdiction_type: jurisdiction_type,
      active: true,
      created_at: new Date()
    });

    // Log agency creation
    await Database.logAudit(
      req.user.id,
      'LEA_AGENCY_CREATED',
      'law_enforcement_agencies',
      agencyId,
      null,
      {
        agency_name: agency_name,
        region: region,
        contact_email: contact_email
      },
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'LEA agency created successfully',
      agency_id: agencyId,
      created_by: req.user.name
    });

  } catch (error) {
    console.error('LEA agency creation error:', error);
    res.status(500).json({ error: 'Failed to create LEA agency' });
  }
});

// Update LEA agency
router.put('/lea-agencies/:agencyId', async (req, res) => {
  try {
    const { agencyId } = req.params;
    const { 
      agency_name, 
      contact_email, 
      contact_phone, 
      region, 
      address, 
      jurisdiction_type,
      active 
    } = req.body;

    // Get current agency details
    const currentAgency = await Database.selectOne(
      'law_enforcement_agencies',
      '*',
      'id = ?',
      [agencyId]
    );

    if (!currentAgency) {
      return res.status(404).json({ error: 'LEA agency not found' });
    }

    // Update agency
    const updateData = {};
    if (agency_name) updateData.agency_name = agency_name;
    if (contact_email) updateData.contact_email = contact_email;
    if (contact_phone) updateData.contact_phone = contact_phone;
    if (region) updateData.region = region;
    if (address) updateData.address = address;
    if (jurisdiction_type) updateData.jurisdiction_type = jurisdiction_type;
    if (typeof active === 'boolean') updateData.active = active;
    updateData.updated_at = new Date();

    await Database.update('law_enforcement_agencies', updateData, 'id = ?', [agencyId]);

    // Log agency update
    await Database.logAudit(
      req.user.id,
      'LEA_AGENCY_UPDATED',
      'law_enforcement_agencies',
      agencyId,
      currentAgency,
      updateData,
      req.ip
    );

    res.json({
      success: true,
      message: 'LEA agency updated successfully',
      agency_id: agencyId,
      updated_by: req.user.name
    });

  } catch (error) {
    console.error('LEA agency update error:', error);
    res.status(500).json({ error: 'Failed to update LEA agency' });
  }
});

// Get system activity feed
router.get('/activity-feed', async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const activities = await Database.query(`
      SELECT 
        al.*,
        u.name as user_name,
        u.email as user_email,
        u.role as user_role
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.action IN (
        'REGISTER', 'LOGIN', 'DEVICE_REGISTERED', 'DEVICE_VERIFIED', 
        'REPORT_CREATED', 'TRANSFER_INITIATED', 'TRANSFER_ACCEPTED',
        'LEA_CASE_UPDATE', 'USER_ROLE_CHANGE'
      )
      ORDER BY al.created_at DESC
      LIMIT ?
    `, [parseInt(limit)]);

    // Format activities for display
    const formattedActivities = activities.map(activity => ({
      id: activity.id,
      timestamp: activity.created_at,
      user: {
        name: activity.user_name || 'System',
        email: activity.user_email,
        role: activity.user_role
      },
      action: activity.action,
      description: formatActivityDescription(activity),
      ip_address: activity.ip_address
    }));

    res.json({
      success: true,
      activities: formattedActivities,
      total_shown: formattedActivities.length
    });

  } catch (error) {
    console.error('Activity feed error:', error);
    res.status(500).json({ error: 'Failed to load activity feed' });
  }
});

// Format activity description for display
function formatActivityDescription(activity) {
  const newValues = activity.new_values ? JSON.parse(activity.new_values) : {};
  
  switch (activity.action) {
    case 'REGISTER':
      return 'New user registered';
    case 'LOGIN':
      return 'User logged in';
    case 'DEVICE_REGISTERED':
      return `Device registered: ${newValues.brand || ''} ${newValues.model || ''}`;
    case 'DEVICE_VERIFIED':
      return 'Device verification completed';
    case 'REPORT_CREATED':
      return `${newValues.report_type || 'Report'} report filed`;
    case 'TRANSFER_INITIATED':
      return 'Device transfer initiated';
    case 'TRANSFER_ACCEPTED':
      return 'Device transfer completed';
    case 'LEA_CASE_UPDATE':
      return `Case status updated to: ${newValues.status || 'unknown'}`;
    case 'USER_ROLE_CHANGE':
      return `User role changed to: ${newValues.role || 'unknown'}`;
    default:
      return activity.action.replace(/_/g, ' ').toLowerCase();
  }
}

module.exports = router;