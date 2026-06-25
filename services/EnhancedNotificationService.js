const nodemailer = require('nodemailer');
const twilio = require('twilio');
const webpush = require('web-push');
const { logActivity } = require('./AuditService');
const EmailTemplate = require('./EmailTemplate');

class EnhancedNotificationService {
  constructor() {
    this.emailTransporter = null;
    this.twilioClient = null;
    this.initializeServices();
  }

  async initializeServices() {
    try {
      // Initialize email service
      if (process.env.SMTP_HOST) {
        this.emailTransporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });
      }

      // Initialize SMS service
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        this.twilioClient = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );
      }

      // Initialize push notifications
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        webpush.setVapidDetails(
          'mailto:' + process.env.ADMIN_EMAIL,
          process.env.VAPID_PUBLIC_KEY,
          process.env.VAPID_PRIVATE_KEY
        );
      }

      console.log('✅ Enhanced Notification Service initialized');
    } catch (error) {
      console.error('❌ Error initializing notification services:', error);
    }
  }

  // Send email notification
  async sendEmail(to, subject, htmlContent, textContent = null) {
    if (!this.emailTransporter) {
      console.log('📧 Email service not configured, skipping email to:', to);
      return { success: false, reason: 'Email service not configured' };
    }

    try {
      const mailOptions = {
        from: `"${process.env.APP_NAME || 'Check It'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to,
        subject,
        html: htmlContent,
        text: textContent || htmlContent.replace(/<[^>]*>/g, '')
      };

      const result = await this.emailTransporter.sendMail(mailOptions);
      console.log('📧 Email sent successfully to:', to);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('❌ Error sending email:', error);
      return { success: false, error: error.message };
    }
  }

  // Send SMS notification
  async sendSMS(to, message) {
    if (!this.twilioClient) {
      console.log('📱 SMS service not configured, skipping SMS to:', to);
      return { success: false, reason: 'SMS service not configured' };
    }

    try {
      const result = await this.twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to
      });

      console.log('📱 SMS sent successfully to:', to);
      return { success: true, sid: result.sid };
    } catch (error) {
      console.error('❌ Error sending SMS:', error);
      return { success: false, error: error.message };
    }
  }

  // Send push notification
  async sendPushNotification(subscription, payload) {
    try {
      const result = await webpush.sendNotification(subscription, JSON.stringify(payload));
      console.log('🔔 Push notification sent successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ Error sending push notification:', error);
      return { success: false, error: error.message };
    }
  }

  // Get user notification preferences
  async getUserPreferences(connection, userId) {
    try {
      const [rows] = await connection.execute(`
        SELECT 
          email_notifications,
          sms_notifications,
          push_notifications,
          device_alerts,
          transfer_notifications,
          verification_notifications,
          report_updates,
          marketing_emails,
          phone
        FROM users 
        WHERE id = ?
      `, [userId]);

      return rows[0] || {};
    } catch (error) {
      console.error('Error fetching user preferences:', error);
      return {};
    }
  }

  // Send device verification notification
  async sendDeviceVerificationUpdate(connection, userId, device, approved, notes = null) {
    try {
      const preferences = await this.getUserPreferences(connection, userId);
      const [userRows] = await connection.execute(
        'SELECT name, email FROM users WHERE id = ?',
        [userId]
      );

      if (userRows.length === 0) return;

      const user = userRows[0];
      const status = approved ? 'approved' : 'rejected';
      const deviceName = `${device.brand} ${device.model}`;

      // Email notification
      if (preferences.email_notifications && preferences.verification_notifications) {
        const subject = `Device Verification ${approved ? 'Approved' : 'Rejected'}`;
        const statusColor = approved ? '#22C55E' : '#EF4444';
        const statusBg = approved ? '#F0FDF4' : '#FEF2F2';
        const statusText = approved ? '#166534' : '#991B1B';

        const content = `
          <p>Hello <strong>${user.name}</strong>,</p>
          <p>Your device verification request has been <strong>${status}</strong>.</p>

          <div style="background: ${statusBg}; border-left: 4px solid ${statusColor}; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin: 0 0 10px; color: ${statusText}; font-size: 15px;">Device Details</h3>
            <table cellpadding="4" cellspacing="0" style="font-size: 14px; color: ${statusText};">
              <tr><td style="font-weight: 600; padding-right: 12px;">Brand:</td><td>${device.brand}</td></tr>
              <tr><td style="font-weight: 600; padding-right: 12px;">Model:</td><td>${device.model}</td></tr>
              <tr><td style="font-weight: 600; padding-right: 12px;">IMEI:</td><td>${device.imei || 'N/A'}</td></tr>
              <tr><td style="font-weight: 600; padding-right: 12px;">Status:</td><td>${approved ? 'Verified' : 'Verification Failed'}</td></tr>
            </table>
          </div>

          ${notes ? `
            <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 12px 16px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 5px; color: #92400E; font-size: 14px;">Admin Notes</h3>
              <p style="margin: 0; color: #92400E; font-size: 14px;">${notes}</p>
            </div>
          ` : ''}

          ${approved ? `
            <p>Your device is now verified and protected in our system. You can now:</p>
            <ul style="color: #374151; line-height: 1.8;">
              <li>Report it if it gets stolen or lost</li>
              <li>Transfer ownership to another user</li>
              <li>View its verification status anytime</li>
            </ul>
          ` : `
            <p>Unfortunately, we couldn't verify your device at this time. This could be due to:</p>
            <ul style="color: #374151; line-height: 1.8;">
              <li>Incomplete or unclear documentation</li>
              <li>Device information that couldn't be validated</li>
              <li>Missing required verification documents</li>
            </ul>
            <p>You can submit a new verification request with updated information.</p>
          `}
        `;

        const htmlContent = EmailTemplate.wrapContent(subject, content, {
          actionButton: { url: `${process.env.FRONTEND_URL}/devices`, text: 'View My Devices' }
        });

        await this.sendEmail(user.email, `${subject} - ${deviceName}`, htmlContent);
      }

      // SMS notification
      if (preferences.sms_notifications && preferences.verification_notifications && preferences.phone) {
        const smsMessage = `Check It: Your ${deviceName} verification has been ${status}. ${approved ? 'Your device is now protected!' : 'Please check your email for details.'} View: ${process.env.FRONTEND_URL}/devices`;
        await this.sendSMS(preferences.phone, smsMessage);
      }

      // Log notification
      await logActivity(connection, 'system', 'notification_sent', 'user', userId, 
        `Device verification notification sent (${status})`, '127.0.0.1', 'NotificationService');

    } catch (error) {
      console.error('Error sending device verification notification:', error);
    }
  }

  // Send device alert notification
  async sendDeviceAlert(connection, userId, device, alertType, details) {
    try {
      const preferences = await this.getUserPreferences(connection, userId);
      const [userRows] = await connection.execute(
        'SELECT name, email FROM users WHERE id = ?',
        [userId]
      );

      if (userRows.length === 0) return;

      const user = userRows[0];
      const deviceName = `${device.brand} ${device.model}`;

      if (preferences.email_notifications && preferences.device_alerts) {
        let subject, title, content, actionButton;

        switch (alertType) {
          case 'device_checked':
            subject = 'Device Check Alert';
            title = 'Device Check Alert';
            content = `
              <p>Hello <strong>${user.name}</strong>,</p>
              <p>Someone has checked your device in our system:</p>
              <div style="background: #FFFBEB; border-left: 4px solid #F59E0B; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin: 0 0 10px; color: #92400E; font-size: 15px;">Device: ${deviceName}</h3>
                <table cellpadding="4" cellspacing="0" style="font-size: 14px; color: #92400E;">
                  <tr><td style="font-weight: 600; padding-right: 12px;">Checked at:</td><td>${new Date().toLocaleString()}</td></tr>
                  <tr><td style="font-weight: 600; padding-right: 12px;">Location:</td><td>${details.location || 'Unknown'}</td></tr>
                  <tr><td style="font-weight: 600; padding-right: 12px;">IP Address:</td><td>${details.ip_address || 'Unknown'}</td></tr>
                </table>
              </div>
              <p>If this was you, no action is needed. If you didn't perform this check, please review your device security.</p>
            `;
            actionButton = { url: `${process.env.FRONTEND_URL}/devices/${device.id}`, text: 'View Device Details' };
            break;

          case 'suspicious_activity':
            subject = 'Suspicious Activity Alert';
            title = 'Suspicious Activity Detected';
            content = `
              <p>Hello <strong>${user.name}</strong>,</p>
              <p><strong>We've detected suspicious activity</strong> related to your device.</p>
              <div style="background: #FEF2F2; border-left: 4px solid #DC2626; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin: 0 0 10px; color: #991B1B; font-size: 15px;">Device: ${deviceName}</h3>
                <table cellpadding="4" cellspacing="0" style="font-size: 14px; color: #991B1B;">
                  <tr><td style="font-weight: 600; padding-right: 12px;">Activity:</td><td>${details.activity}</td></tr>
                  <tr><td style="font-weight: 600; padding-right: 12px;">Time:</td><td>${new Date().toLocaleString()}</td></tr>
                  <tr><td style="font-weight: 600; padding-right: 12px;">Details:</td><td>${details.description}</td></tr>
                </table>
              </div>
              <p><strong>Recommended Actions:</strong></p>
              <ul style="color: #374151; line-height: 1.8;">
                <li>Check if you still have your device</li>
                <li>Review recent device activity</li>
                <li>Report the device as stolen if missing</li>
                <li>Contact support if you need assistance</li>
              </ul>
              <div style="text-align: center; margin: 20px 0 10px;">
                <a href="${process.env.FRONTEND_URL}/devices/${device.id}" style="display: inline-block; padding: 12px 24px; background: #EF4444; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin-right: 8px;">View Device</a>
                <a href="${process.env.FRONTEND_URL}/report-missing" style="display: inline-block; padding: 12px 24px; background: #6B7280; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">Report Missing</a>
              </div>
            `;
            actionButton = null; // Already inline buttons
            break;
        }

        const htmlContent = EmailTemplate.wrapContent(title, content, { actionButton });
        await this.sendEmail(user.email, `${subject} - ${deviceName}`, htmlContent);
      }

      // SMS for critical alerts
      if (preferences.sms_notifications && preferences.device_alerts && preferences.phone && alertType === 'suspicious_activity') {
        const smsMessage = `🚨 Check It ALERT: Suspicious activity detected on your ${deviceName}. Check your email and secure your device immediately. ${process.env.FRONTEND_URL}`;
        await this.sendSMS(preferences.phone, smsMessage);
      }

    } catch (error) {
      console.error('Error sending device alert:', error);
    }
  }

  // Send report status update
  async sendReportStatusUpdate(connection, userId, report, oldStatus, newStatus) {
    try {
      const preferences = await this.getUserPreferences(connection, userId);
      const [userRows] = await connection.execute(
        'SELECT name, email FROM users WHERE id = ?',
        [userId]
      );

      if (userRows.length === 0 || !preferences.email_notifications || !preferences.report_updates) return;

      const user = userRows[0];
      const statusColors = {
        'open': '#F59E0B',
        'under_review': '#3B82F6',
        'resolved': '#10B981',
        'dismissed': '#6B7280'
      };

      const subject = `Report Status Updated - Case #${report.case_id}`;
      const title = `Report Status Updated`;
      const content = `
        <p>Hello <strong>${user.name}</strong>,</p>
        <p>Your report status has been updated:</p>

        <div style="background: #F3F4F6; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px; color: #111827; font-size: 15px;">Case #${report.case_id}</h3>
          <table cellpadding="4" cellspacing="0" style="font-size: 14px; color: #374151;">
            <tr><td style="font-weight: 600; padding-right: 12px;">Report Type:</td><td>${report.report_type}</td></tr>
            <tr><td style="font-weight: 600; padding-right: 12px;">Previous Status:</td><td style="color: ${statusColors[oldStatus] || '#6B7280'}; font-weight: 500;">${oldStatus.replace('_', ' ')}</td></tr>
            <tr><td style="font-weight: 600; padding-right: 12px;">New Status:</td><td style="color: ${statusColors[newStatus] || '#6B7280'}; font-weight: 500;">${newStatus.replace('_', ' ')}</td></tr>
            <tr><td style="font-weight: 600; padding-right: 12px;">Updated:</td><td>${new Date().toLocaleString()}</td></tr>
          </table>
        </div>

        ${newStatus === 'resolved' ? `
          <div style="background: #F0FDF4; border-left: 4px solid #22C55E; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin: 0 0 5px; color: #166534; font-size: 15px;">Great News!</h3>
            <p style="margin: 0; color: #166534;">Your report has been resolved. If this involves a device recovery, you should be contacted separately with details.</p>
          </div>
        ` : newStatus === 'under_review' ? `
          <div style="background: #EFF6FF; border-left: 4px solid #2563EB; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin: 0 0 5px; color: #1E40AF; font-size: 15px;">Under Review</h3>
            <p style="margin: 0; color: #1E40AF;">Our team is actively investigating your report. We'll update you as soon as we have more information.</p>
          </div>
        ` : ''}
      `;

      const htmlContent = EmailTemplate.wrapContent(title, content, {
        actionButton: { url: `${process.env.FRONTEND_URL}/reports`, text: 'View My Reports' }
      });

      await this.sendEmail(user.email, subject, htmlContent);

      // SMS for resolved cases
      if (preferences.sms_notifications && preferences.phone && newStatus === 'resolved') {
        const smsMessage = `Check It: Your report case #${report.case_id} has been RESOLVED! Check your email for details. ${process.env.FRONTEND_URL}/reports`;
        await this.sendSMS(preferences.phone, smsMessage);
      }

    } catch (error) {
      console.error('Error sending report status update:', error);
    }
  }

  // Send welcome email to new users
  async sendWelcomeEmail(connection, userId) {
    try {
      const [userRows] = await connection.execute(
        'SELECT name, email, role FROM users WHERE id = ?',
        [userId]
      );

      if (userRows.length === 0) return;

      const user = userRows[0];
      const subject = `Welcome to Check It!`;
      
      const content = `
        <p>Hello <strong>${user.name}</strong>,</p>
        <p>Welcome to <strong>Check It</strong>, Nigeria's premier device registry and recovery system! We're excited to help you protect your valuable devices.</p>

        <div style="background: #EFF6FF; border-left: 4px solid #2563EB; padding: 20px; border-radius: 8px; margin: 25px 0;">
          <h3 style="color: #1E40AF; margin: 0 0 12px; font-size: 16px;">Get Started in 3 Easy Steps</h3>
          <ol style="color: #374151; line-height: 2; margin: 0; padding-left: 20px;">
            <li><strong>Register Your Devices:</strong> Add your phones, laptops, and other valuables to our secure registry</li>
            <li><strong>Verify Ownership:</strong> Complete the verification process to ensure maximum protection</li>
            <li><strong>Stay Protected:</strong> Get instant alerts if someone checks your device</li>
          </ol>
        </div>

        <div style="background: #F9FAFB; border-radius: 8px; padding: 20px; margin: 25px 0;">
          <h3 style="color: #111827; margin: 0 0 12px; font-size: 16px;">What You Can Do</h3>
          <table cellpadding="6" cellspacing="0" style="font-size: 14px; color: #374151; width: 100%;">
            <tr>
              <td style="width: 50%; vertical-align: top;"><strong>Device Registry</strong><br><span style="color: #6B7280;">Secure registration system</span></td>
              <td style="width: 50%; vertical-align: top;"><strong>Public Checks</strong><br><span style="color: #6B7280;">Verify device legitimacy</span></td>
            </tr>
            <tr>
              <td style="width: 50%; vertical-align: top;"><strong>Theft Reports</strong><br><span style="color: #6B7280;">Quick reporting system</span></td>
              <td style="width: 50%; vertical-align: top;"><strong>Device Transfers</strong><br><span style="color: #6B7280;">Safe ownership transfers</span></td>
            </tr>
          </table>
        </div>

        ${user.role === 'business' ? `
          <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 16px; border-radius: 8px; margin: 25px 0;">
            <h3 style="color: #92400E; margin: 0 0 8px; font-size: 16px;">Business Account Benefits</h3>
            <ul style="color: #374151; line-height: 1.8; margin: 0;">
              <li>Bulk device registration</li>
              <li>Advanced analytics and reporting</li>
              <li>Priority support</li>
              <li>Custom integration options</li>
            </ul>
          </div>
        ` : ''}

        <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 16px; border-radius: 8px; margin: 25px 0;">
          <p style="margin: 0; color: #991B1B; font-size: 14px;"><strong>Security Tip:</strong> Always verify devices before purchasing from unknown sellers. Use our public check feature to ensure you're not buying stolen property.</p>
        </div>

        <p>If you have any questions, our support team is here to help. Simply reply to this email or visit our help center.</p>
        <p style="margin-top: 20px;">Stay secure,<br><strong>The Check It Team</strong></p>
      `;

      const htmlContent = EmailTemplate.wrapContent(subject, content, {
        actionButton: { url: `${process.env.FRONTEND_URL}/register-device`, text: 'Register Your First Device' }
      });

      await this.sendEmail(user.email, subject, htmlContent);

      await logActivity(connection, 'system', 'welcome_email_sent', 'user', userId, 
        'Welcome email sent to new user', '127.0.0.1', 'NotificationService');

    } catch (error) {
      console.error('Error sending welcome email:', error);
    }
  }

  // Send bulk notification to multiple users
  async sendBulkNotification(connection, userIds, subject, htmlContent, notificationType = 'general') {
    try {
      const results = [];
      
      for (const userId of userIds) {
        const preferences = await this.getUserPreferences(connection, userId);
        const [userRows] = await connection.execute(
          'SELECT name, email FROM users WHERE id = ?',
          [userId]
        );

        if (userRows.length === 0) continue;

        const user = userRows[0];

        if (preferences.email_notifications) {
          const personalizedContent = htmlContent.replace(/\{name\}/g, user.name);
          const result = await this.sendEmail(user.email, subject, personalizedContent);
          results.push({ userId, email: user.email, success: result.success });
        }
      }

      await logActivity(connection, 'system', 'bulk_notification_sent', 'system', null, 
        `Bulk notification sent to ${results.length} users (type: ${notificationType})`, '127.0.0.1', 'NotificationService');

      return results;
    } catch (error) {
      console.error('Error sending bulk notification:', error);
      return [];
    }
  }
}

module.exports = new EnhancedNotificationService();