const nodemailer = require('nodemailer');
const twilio = require('twilio');
const webpush = require('web-push');
const { logActivity } = require('./AuditService');

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
        const subject = `Device Verification ${approved ? 'Approved' : 'Rejected'} - ${deviceName}`;
        const htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: ${approved ? '#10B981' : '#EF4444'}; color: white; padding: 20px; text-align: center;">
              <h1>Device Verification ${approved ? 'Approved' : 'Rejected'}</h1>
            </div>
            <div style="padding: 20px;">
              <p>Hello ${user.name},</p>
              <p>Your device verification request has been <strong>${status}</strong>.</p>
              
              <div style="background: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <h3>Device Details:</h3>
                <p><strong>Brand:</strong> ${device.brand}</p>
                <p><strong>Model:</strong> ${device.model}</p>
                <p><strong>IMEI:</strong> ${device.imei || 'N/A'}</p>
                <p><strong>Status:</strong> ${approved ? 'Verified' : 'Verification Failed'}</p>
              </div>

              ${notes ? `
                <div style="background: #FEF3C7; padding: 15px; border-radius: 8px; margin: 20px 0;">
                  <h3>Admin Notes:</h3>
                  <p>${notes}</p>
                </div>
              ` : ''}

              ${approved ? `
                <p>Your device is now verified and protected in our system. You can now:</p>
                <ul>
                  <li>Report it if it gets stolen or lost</li>
                  <li>Transfer ownership to another user</li>
                  <li>View its verification status anytime</li>
                </ul>
              ` : `
                <p>Unfortunately, we couldn't verify your device at this time. This could be due to:</p>
                <ul>
                  <li>Incomplete or unclear documentation</li>
                  <li>Device information that couldn't be validated</li>
                  <li>Missing required verification documents</li>
                </ul>
                <p>You can submit a new verification request with updated information.</p>
              `}

              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL}/devices" 
                   style="background: #3B82F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  View My Devices
                </a>
              </div>

              <p>Best regards,<br>The Check It Team</p>
            </div>
          </div>
        `;

        await this.sendEmail(user.email, subject, htmlContent);
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
        let subject, htmlContent;

        switch (alertType) {
          case 'device_checked':
            subject = `Device Check Alert - ${deviceName}`;
            htmlContent = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: #F59E0B; color: white; padding: 20px; text-align: center;">
                  <h1>🔍 Device Check Alert</h1>
                </div>
                <div style="padding: 20px;">
                  <p>Hello ${user.name},</p>
                  <p>Someone has checked your device in our system:</p>
                  
                  <div style="background: #FEF3C7; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3>Device: ${deviceName}</h3>
                    <p><strong>Checked at:</strong> ${new Date().toLocaleString()}</p>
                    <p><strong>Location:</strong> ${details.location || 'Unknown'}</p>
                    <p><strong>IP Address:</strong> ${details.ip_address || 'Unknown'}</p>
                  </div>

                  <p>If this was you, no action is needed. If you didn't perform this check, please review your device security.</p>
                  
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL}/devices/${device.id}" 
                       style="background: #3B82F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                      View Device Details
                    </a>
                  </div>
                </div>
              </div>
            `;
            break;

          case 'suspicious_activity':
            subject = `🚨 Suspicious Activity Alert - ${deviceName}`;
            htmlContent = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: #EF4444; color: white; padding: 20px; text-align: center;">
                  <h1>🚨 Suspicious Activity Detected</h1>
                </div>
                <div style="padding: 20px;">
                  <p>Hello ${user.name},</p>
                  <p><strong>We've detected suspicious activity related to your device:</strong></p>
                  
                  <div style="background: #FEE2E2; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #EF4444;">
                    <h3>Device: ${deviceName}</h3>
                    <p><strong>Activity:</strong> ${details.activity}</p>
                    <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                    <p><strong>Details:</strong> ${details.description}</p>
                  </div>

                  <p><strong>Recommended Actions:</strong></p>
                  <ul>
                    <li>Check if you still have your device</li>
                    <li>Review recent device activity</li>
                    <li>Report the device as stolen if missing</li>
                    <li>Contact support if you need assistance</li>
                  </ul>
                  
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL}/devices/${device.id}" 
                       style="background: #EF4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin-right: 10px;">
                      View Device
                    </a>
                    <a href="${process.env.FRONTEND_URL}/report-missing" 
                       style="background: #6B7280; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                      Report Missing
                    </a>
                  </div>
                </div>
              </div>
            `;
            break;
        }

        await this.sendEmail(user.email, subject, htmlContent);
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

      const subject = `Report Status Update - Case #${report.case_id}`;
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: ${statusColors[newStatus] || '#6B7280'}; color: white; padding: 20px; text-align: center;">
            <h1>Report Status Updated</h1>
          </div>
          <div style="padding: 20px;">
            <p>Hello ${user.name},</p>
            <p>Your report status has been updated:</p>
            
            <div style="background: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3>Case #${report.case_id}</h3>
              <p><strong>Report Type:</strong> ${report.report_type}</p>
              <p><strong>Previous Status:</strong> <span style="color: ${statusColors[oldStatus] || '#6B7280'}">${oldStatus.replace('_', ' ')}</span></p>
              <p><strong>New Status:</strong> <span style="color: ${statusColors[newStatus] || '#6B7280'}">${newStatus.replace('_', ' ')}</span></p>
              <p><strong>Updated:</strong> ${new Date().toLocaleString()}</p>
            </div>

            ${newStatus === 'resolved' ? `
              <div style="background: #D1FAE5; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10B981;">
                <h3>🎉 Great News!</h3>
                <p>Your report has been resolved. If this involves a device recovery, you should be contacted separately with details.</p>
              </div>
            ` : newStatus === 'under_review' ? `
              <div style="background: #DBEAFE; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3B82F6;">
                <h3>👀 Under Review</h3>
                <p>Our team is actively investigating your report. We'll update you as soon as we have more information.</p>
              </div>
            ` : ''}
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/reports" 
                 style="background: #3B82F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                View My Reports
              </a>
            </div>

            <p>Best regards,<br>The Check It Team</p>
          </div>
        </div>
      `;

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
      const subject = `Welcome to Check It - Secure Your Devices Today!`;
      
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); color: white; padding: 30px; text-align: center;">
            <h1>Welcome to Check It! 🛡️</h1>
            <p style="font-size: 18px; margin: 0;">Your Device Security Journey Starts Here</p>
          </div>
          
          <div style="padding: 30px;">
            <p style="font-size: 16px;">Hello ${user.name},</p>
            <p>Welcome to Check It, Nigeria's premier device registry and recovery system! We're excited to help you protect your valuable devices.</p>

            <div style="background: #F0F9FF; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #3B82F6;">
              <h3 style="color: #1E40AF; margin-top: 0;">🚀 Get Started in 3 Easy Steps:</h3>
              <ol style="color: #374151; line-height: 1.6;">
                <li><strong>Register Your Devices:</strong> Add your phones, laptops, and other valuables to our secure registry</li>
                <li><strong>Verify Ownership:</strong> Complete the verification process to ensure maximum protection</li>
                <li><strong>Stay Protected:</strong> Get instant alerts if someone checks your device</li>
              </ol>
            </div>

            <div style="background: #F9FAFB; padding: 20px; border-radius: 8px; margin: 25px 0;">
              <h3 style="color: #374151; margin-top: 0;">✨ What You Can Do:</h3>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                <div>
                  <p style="margin: 5px 0;"><strong>📱 Device Registry</strong><br>Secure registration system</p>
                  <p style="margin: 5px 0;"><strong>🔍 Public Checks</strong><br>Verify device legitimacy</p>
                </div>
                <div>
                  <p style="margin: 5px 0;"><strong>🚨 Theft Reports</strong><br>Quick reporting system</p>
                  <p style="margin: 5px 0;"><strong>🔄 Device Transfers</strong><br>Safe ownership transfers</p>
                </div>
              </div>
            </div>

            ${user.role === 'business' ? `
              <div style="background: #FEF3C7; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #F59E0B;">
                <h3 style="color: #92400E; margin-top: 0;">🏢 Business Account Benefits:</h3>
                <ul style="color: #374151; line-height: 1.6;">
                  <li>Bulk device registration</li>
                  <li>Advanced analytics and reporting</li>
                  <li>Priority support</li>
                  <li>Custom integration options</li>
                </ul>
              </div>
            ` : ''}

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/register-device" 
                 style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; margin-right: 10px;">
                Register Your First Device
              </a>
              <a href="${process.env.FRONTEND_URL}/dashboard" 
                 style="background: #6B7280; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                Go to Dashboard
              </a>
            </div>

            <div style="background: #FEE2E2; padding: 15px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #EF4444;">
              <p style="margin: 0; color: #991B1B;"><strong>🔒 Security Tip:</strong> Always verify devices before purchasing from unknown sellers. Use our public check feature to ensure you're not buying stolen property.</p>
            </div>

            <p>If you have any questions, our support team is here to help. Simply reply to this email or visit our help center.</p>

            <p style="margin-top: 30px;">Stay secure,<br><strong>The Check It Team</strong></p>
          </div>

          <div style="background: #F9FAFB; padding: 20px; text-align: center; border-top: 1px solid #E5E7EB;">
            <p style="margin: 0; color: #6B7280; font-size: 14px;">
              Follow us: 
              <a href="#" style="color: #3B82F6; text-decoration: none;">Twitter</a> | 
              <a href="#" style="color: #3B82F6; text-decoration: none;">Facebook</a> | 
              <a href="#" style="color: #3B82F6; text-decoration: none;">LinkedIn</a>
            </p>
            <p style="margin: 10px 0 0 0; color: #6B7280; font-size: 12px;">
              © 2024 Check It Device Registry. All rights reserved.
            </p>
          </div>
        </div>
      `;

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