// Test Email Route - For testing email configuration
const express = require('express');
const NotificationService = require('../services/NotificationService');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Test email sending (admin only)
router.post('/send-test', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { to_email, subject, message } = req.body;

    if (!to_email) {
      return res.status(400).json({
        error: 'Recipient email is required'
      });
    }

    // Queue test notification
    const notificationId = await NotificationService.queueNotification(
      req.user.id,
      'email',
      to_email,
      subject || 'Check It - Test Email',
      message || `
        <h2>Test Email from Check It Device Registry</h2>
        <p>This is a test email to verify the email configuration is working correctly.</p>
        <p><strong>Sent by:</strong> ${req.user.name} (${req.user.email})</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <p>If you received this email, the notification system is working properly!</p>
      `,
      {
        type: 'test_email',
        sender: req.user.name
      }
    );

    res.json({
      success: true,
      message: 'Test email queued successfully',
      notification_id: notificationId,
      recipient: to_email
    });

  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({
      error: 'Failed to send test email',
      details: error.message
    });
  }
});

// Test email configuration (admin only)
router.get('/config-test', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const config = {
      smtp_configured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
      smtp_host: process.env.SMTP_HOST,
      smtp_port: process.env.SMTP_PORT,
      smtp_user: process.env.SMTP_USER,
      smtp_secure: process.env.SMTP_SECURE,
      mail_from_address: process.env.MAIL_FROM_ADDRESS,
      mail_from_name: process.env.MAIL_FROM_NAME,
      admin_email: process.env.ADMIN_EMAIL
    };

    res.json({
      success: true,
      email_configuration: config,
      status: config.smtp_configured ? 'Ready' : 'Not Configured'
    });

  } catch (error) {
    console.error('Config test error:', error);
    res.status(500).json({
      error: 'Failed to check email configuration'
    });
  }
});

// Send welcome email to new admin (admin only)
router.post('/welcome-admin', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { admin_email, admin_name } = req.body;

    if (!admin_email) {
      return res.status(400).json({
        error: 'Admin email is required'
      });
    }

    const welcomeMessage = `
      <h2>Welcome to Check It Device Registry</h2>
      <p>Hello ${admin_name || 'Administrator'},</p>
      <p>Your admin account has been set up successfully for the Check It Device Registry system.</p>
      
      <h3>Your Admin Capabilities:</h3>
      <ul>
        <li>✅ Verify device registrations</li>
        <li>✅ Manage user accounts and roles</li>
        <li>✅ Monitor system statistics</li>
        <li>✅ Review audit logs</li>
        <li>✅ Manage LEA assignments</li>
        <li>✅ Configure system settings</li>
      </ul>

      <h3>Quick Start:</h3>
      <ol>
        <li>Log into the admin dashboard</li>
        <li>Review pending device verifications</li>
        <li>Set up LEA agencies for your regions</li>
        <li>Monitor system activity</li>
      </ol>

      <p><strong>Admin Dashboard:</strong> <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin">Access Admin Panel</a></p>
      
      <p>If you have any questions, please contact technical support.</p>
      
      <p>Best regards,<br>Check It Device Registry Team</p>
    `;

    const notificationId = await NotificationService.queueNotification(
      req.user.id,
      'email',
      admin_email,
      'Welcome to Check It Device Registry - Admin Access',
      welcomeMessage,
      {
        type: 'admin_welcome',
        admin_name: admin_name
      }
    );

    res.json({
      success: true,
      message: 'Welcome email sent successfully',
      notification_id: notificationId,
      recipient: admin_email
    });

  } catch (error) {
    console.error('Welcome email error:', error);
    res.status(500).json({
      error: 'Failed to send welcome email'
    });
  }
});

module.exports = router;