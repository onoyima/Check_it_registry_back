// Enhanced Analytics and Reporting Routes
const express = require('express');
const Database = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../services/AuditService');

const router = express.Router();

// All routes require admin access
router.use(authenticateToken);
router.use(requireRole(['admin']));

// Get comprehensive system analytics
router.get('/dashboard', async (req, res) => {
  try {
    const { period = '30', start_date, end_date } = req.query;

    // Build date filter
    let dateFilter = '';
    let dateParams = [];
    
    if (start_date && end_date) {
      dateFilter = 'WHERE DATE(created_at) BETWEEN ? AND ?';
      dateParams = [start_date, end_date];
    } else {
      dateFilter = 'WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
      dateParams = [parseInt(period)];
    }

    // Get comprehensive statistics
    const [
      userStats,
      deviceStats,
      reportStats,
      checkStats,
      recoveryStats,
      regionalStats,
      trendData
    ] = await Promise.all([
      // User statistics
      Database.query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN role = 'user' THEN 1 END) as regular_users,
          COUNT(CASE WHEN role = 'business' THEN 1 END) as business_users,
          COUNT(CASE WHEN role = 'lea' THEN 1 END) as lea_users,
          COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_users,
          COUNT(CASE WHEN verified_at IS NOT NULL THEN 1 END) as verified_users,
          COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_users_week,
          COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as new_users_month
        FROM users
      `),

      // Device statistics
      Database.query(`
        SELECT 
          COUNT(*) as total_devices,
          COUNT(CASE WHEN status = 'verified' THEN 1 END) as verified_devices,
          COUNT(CASE WHEN status = 'unverified' THEN 1 END) as unverified_devices,
          COUNT(CASE WHEN status = 'stolen' THEN 1 END) as stolen_devices,
          COUNT(CASE WHEN status = 'lost' THEN 1 END) as lost_devices,
          COUNT(CASE WHEN status = 'found' THEN 1 END) as found_devices,
          COUNT(CASE WHEN status = 'pending_transfer' THEN 1 END) as pending_transfers,
          COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_devices_week,
          COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as new_devices_month
        FROM devices
      `),

      // Report statistics
      Database.query(`
        SELECT 
          COUNT(*) as total_reports,
          COUNT(CASE WHEN report_type = 'stolen' THEN 1 END) as theft_reports,
          COUNT(CASE WHEN report_type = 'lost' THEN 1 END) as loss_reports,
          COUNT(CASE WHEN report_type = 'found' THEN 1 END) as found_reports,
          COUNT(CASE WHEN status = 'open' THEN 1 END) as open_cases,
          COUNT(CASE WHEN status = 'under_review' THEN 1 END) as under_review_cases,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_cases,
          COUNT(CASE WHEN status = 'dismissed' THEN 1 END) as dismissed_cases,
          AVG(DATEDIFF(COALESCE(updated_at, NOW()), created_at)) as avg_resolution_days
        FROM reports
      `),

      // Public check statistics
      Database.query(`
        SELECT 
          COUNT(*) as total_checks,
          COUNT(DISTINCT ip_address) as unique_ips,
          COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as checks_24h,
          COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as checks_week
        FROM imei_checks
      `),

      // Recovery statistics
      Database.query(`
        SELECT 
          COUNT(CASE WHEN r.report_type IN ('stolen', 'lost') THEN 1 END) as total_incidents,
          COUNT(CASE WHEN r.status = 'resolved' AND r.report_type IN ('stolen', 'lost') THEN 1 END) as recovered_devices,
          COUNT(CASE WHEN fr.report_type = 'found' THEN 1 END) as found_reports,
          ROUND(
            (COUNT(CASE WHEN r.status = 'resolved' AND r.report_type IN ('stolen', 'lost') THEN 1 END) * 100.0) / 
            NULLIF(COUNT(CASE WHEN r.report_type IN ('stolen', 'lost') THEN 1 END), 0), 2
          ) as recovery_rate_percent
        FROM reports r
        LEFT JOIN reports fr ON fr.report_type = 'found'
      `),

      // Regional statistics
      Database.query(`
        SELECT 
          u.region,
          COUNT(DISTINCT u.id) as users_count,
          COUNT(DISTINCT d.id) as devices_count,
          COUNT(DISTINCT r.id) as reports_count,
          COUNT(CASE WHEN r.report_type = 'stolen' THEN 1 END) as theft_count,
          COUNT(CASE WHEN r.status = 'resolved' THEN 1 END) as resolved_count
        FROM users u
        LEFT JOIN devices d ON u.id = d.user_id
        LEFT JOIN reports r ON d.id = r.device_id
        GROUP BY u.region
        ORDER BY devices_count DESC
        LIMIT 10
      `),

      // Trend data (last 30 days)
      Database.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(CASE WHEN table_name = 'users' THEN 1 END) as new_users,
          COUNT(CASE WHEN table_name = 'devices' THEN 1 END) as new_devices,
          COUNT(CASE WHEN table_name = 'reports' THEN 1 END) as new_reports
        FROM (
          SELECT created_at, 'users' as table_name FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          UNION ALL
          SELECT created_at, 'devices' as table_name FROM devices WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          UNION ALL
          SELECT created_at, 'reports' as table_name FROM reports WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        ) combined
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
      `)
    ]);

    res.json({
      success: true,
      analytics: {
        users: userStats[0],
        devices: deviceStats[0],
        reports: reportStats[0],
        public_checks: checkStats[0],
        recovery: recoveryStats[0],
        regional: regionalStats,
        trends: trendData
      },
      period: {
        days: period,
        start_date: start_date,
        end_date: end_date
      },
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Analytics dashboard error:', error);
    res.status(500).json({ error: 'Failed to generate analytics dashboard' });
  }
});

// Get device brand and model statistics
router.get('/devices/brands', async (req, res) => {
  try {
    const brandStats = await Database.query(`
      SELECT 
        brand,
        COUNT(*) as total_devices,
        COUNT(CASE WHEN status = 'verified' THEN 1 END) as verified_count,
        COUNT(CASE WHEN status = 'stolen' OR status = 'lost' THEN 1 END) as incident_count,
        ROUND(
          (COUNT(CASE WHEN status = 'stolen' OR status = 'lost' THEN 1 END) * 100.0) / COUNT(*), 2
        ) as incident_rate_percent
      FROM devices
      GROUP BY brand
      ORDER BY total_devices DESC
    `);

    const modelStats = await Database.query(`
      SELECT 
        brand,
        model,
        COUNT(*) as device_count,
        COUNT(CASE WHEN status = 'stolen' OR status = 'lost' THEN 1 END) as incident_count
      FROM devices
      GROUP BY brand, model
      HAVING device_count >= 5
      ORDER BY incident_count DESC, device_count DESC
      LIMIT 20
    `);

    res.json({
      success: true,
      brand_statistics: brandStats,
      high_risk_models: modelStats
    });

  } catch (error) {
    console.error('Device brand analytics error:', error);
    res.status(500).json({ error: 'Failed to generate device brand analytics' });
  }
});

// Get theft hotspot analysis
router.get('/hotspots', async (req, res) => {
  try {
    const hotspots = await Database.query(`
      SELECT 
        r.location,
        COUNT(*) as incident_count,
        COUNT(CASE WHEN r.report_type = 'stolen' THEN 1 END) as theft_count,
        COUNT(CASE WHEN r.report_type = 'lost' THEN 1 END) as loss_count,
        COUNT(CASE WHEN r.status = 'resolved' THEN 1 END) as resolved_count,
        ROUND(
          (COUNT(CASE WHEN r.status = 'resolved' THEN 1 END) * 100.0) / COUNT(*), 2
        ) as resolution_rate_percent,
        MIN(r.occurred_at) as first_incident,
        MAX(r.occurred_at) as latest_incident
      FROM reports r
      WHERE r.location IS NOT NULL 
      AND r.location != ''
      AND r.report_type IN ('stolen', 'lost')
      GROUP BY r.location
      HAVING incident_count >= 2
      ORDER BY incident_count DESC
      LIMIT 20
    `);

    const timeAnalysis = await Database.query(`
      SELECT 
        HOUR(occurred_at) as hour_of_day,
        COUNT(*) as incident_count,
        DAYNAME(occurred_at) as day_name,
        COUNT(CASE WHEN DAYOFWEEK(occurred_at) IN (1, 7) THEN 1 END) as weekend_count
      FROM reports
      WHERE report_type IN ('stolen', 'lost')
      AND occurred_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY HOUR(occurred_at)
      ORDER BY incident_count DESC
    `);

    res.json({
      success: true,
      theft_hotspots: hotspots,
      time_analysis: timeAnalysis
    });

  } catch (error) {
    console.error('Hotspot analysis error:', error);
    res.status(500).json({ error: 'Failed to generate hotspot analysis' });
  }
});

// Get LEA performance statistics
router.get('/lea-performance', async (req, res) => {
  try {
    const leaStats = await Database.query(`
      SELECT 
        lea.agency_name,
        lea.region,
        lea.contact_email,
        COUNT(r.id) as assigned_cases,
        COUNT(CASE WHEN r.status = 'resolved' THEN 1 END) as resolved_cases,
        COUNT(CASE WHEN r.status = 'open' THEN 1 END) as open_cases,
        COUNT(CASE WHEN r.status = 'under_review' THEN 1 END) as under_review_cases,
        ROUND(
          (COUNT(CASE WHEN r.status = 'resolved' THEN 1 END) * 100.0) / 
          NULLIF(COUNT(r.id), 0), 2
        ) as resolution_rate_percent,
        AVG(DATEDIFF(
          CASE WHEN r.status = 'resolved' THEN r.updated_at ELSE NULL END, 
          r.created_at
        )) as avg_resolution_days
      FROM law_enforcement_agencies lea
      LEFT JOIN reports r ON lea.id = r.assigned_lea_id
      WHERE lea.active = TRUE
      GROUP BY lea.id, lea.agency_name, lea.region, lea.contact_email
      ORDER BY assigned_cases DESC
    `);

    const caseDistribution = await Database.query(`
      SELECT 
        u.region,
        COUNT(r.id) as total_cases,
        COUNT(CASE WHEN r.assigned_lea_id IS NULL THEN 1 END) as unassigned_cases,
        COUNT(CASE WHEN r.status = 'open' THEN 1 END) as open_cases,
        COUNT(CASE WHEN r.status = 'resolved' THEN 1 END) as resolved_cases
      FROM reports r
      JOIN devices d ON r.device_id = d.id
      JOIN users u ON d.user_id = u.id
      GROUP BY u.region
      ORDER BY total_cases DESC
    `);

    res.json({
      success: true,
      lea_performance: leaStats,
      case_distribution: caseDistribution
    });

  } catch (error) {
    console.error('LEA performance error:', error);
    res.status(500).json({ error: 'Failed to generate LEA performance statistics' });
  }
});

// Export analytics data as CSV
router.get('/export/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { start_date, end_date } = req.query;

    let data = [];
    let filename = '';
    let headers = '';

    switch (type) {
      case 'devices':
        data = await Database.query(`
          SELECT 
            d.id,
            d.brand,
            d.model,
            d.imei,
            d.serial,
            d.status,
            u.name as owner_name,
            u.email as owner_email,
            u.region,
            d.created_at,
            d.verified_at
          FROM devices d
          JOIN users u ON d.user_id = u.id
          ${start_date && end_date ? 'WHERE DATE(d.created_at) BETWEEN ? AND ?' : ''}
          ORDER BY d.created_at DESC
        `, start_date && end_date ? [start_date, end_date] : []);
        
        filename = `devices-export-${new Date().toISOString().split('T')[0]}.csv`;
        headers = 'ID,Brand,Model,IMEI,Serial,Status,Owner Name,Owner Email,Region,Created At,Verified At\n';
        break;

      case 'reports':
        data = await Database.query(`
          SELECT 
            r.case_id,
            r.report_type,
            r.status,
            r.occurred_at,
            r.location,
            d.brand,
            d.model,
            d.imei,
            u.name as owner_name,
            u.region,
            lea.agency_name,
            r.created_at
          FROM reports r
          JOIN devices d ON r.device_id = d.id
          JOIN users u ON d.user_id = u.id
          LEFT JOIN law_enforcement_agencies lea ON r.assigned_lea_id = lea.id
          ${start_date && end_date ? 'WHERE DATE(r.created_at) BETWEEN ? AND ?' : ''}
          ORDER BY r.created_at DESC
        `, start_date && end_date ? [start_date, end_date] : []);
        
        filename = `reports-export-${new Date().toISOString().split('T')[0]}.csv`;
        headers = 'Case ID,Type,Status,Occurred At,Location,Device Brand,Device Model,IMEI,Owner,Region,LEA Agency,Created At\n';
        break;

      case 'users':
        data = await Database.query(`
          SELECT 
            u.id,
            u.name,
            u.email,
            u.role,
            u.region,
            u.verified_at,
            u.created_at,
            COUNT(d.id) as device_count,
            COUNT(r.id) as report_count
          FROM users u
          LEFT JOIN devices d ON u.id = d.user_id
          LEFT JOIN reports r ON d.id = r.device_id
          ${start_date && end_date ? 'WHERE DATE(u.created_at) BETWEEN ? AND ?' : ''}
          GROUP BY u.id
          ORDER BY u.created_at DESC
        `, start_date && end_date ? [start_date, end_date] : []);
        
        filename = `users-export-${new Date().toISOString().split('T')[0]}.csv`;
        headers = 'ID,Name,Email,Role,Region,Verified At,Created At,Device Count,Report Count\n';
        break;

      default:
        return res.status(400).json({ error: 'Invalid export type' });
    }

    // Generate CSV content
    const csvRows = data.map(row => 
      Object.values(row).map(value => 
        `"${String(value || '').replace(/"/g, '""')}"`
      ).join(',')
    ).join('\n');

    const csv = headers + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

module.exports = router;