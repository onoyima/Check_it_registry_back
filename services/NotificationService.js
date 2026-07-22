// Notification Service - Email, SMS, and Push Notifications
const nodemailer = require("nodemailer");
const Database = require("../config");
const EmailTemplate = require("./EmailTemplate");

class NotificationService {
  constructor() {
    // Email transporter setup
    this.emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 5000,
      socketTimeout: 10000,
    });

    // SMS configuration (Twilio)
    this.twilioClient = null;
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const twilio = require("twilio");
      this.twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
    }
  }

  // Queue notification for processing
  async queueNotification(
    userId,
    channel,
    recipient,
    subject,
    message,
    payload = null
  ) {
    const notificationId = Database.generateUUID();

    await Database.insert("notifications", {
      id: notificationId,
      user_id: userId,
      channel: channel, // 'email', 'sms', 'push'
      recipient: recipient,
      subject: subject,
      message: message,
      payload: payload ? JSON.stringify(payload) : null,
      status: "pending",
      created_at: new Date(),
    });

    // Process immediately in development, queue in production
    if (process.env.NODE_ENV === "development") {
      await this.processNotification(notificationId);
    }

    return notificationId;
  }

  // Process a single notification
  async processNotification(notificationId) {
    try {
      const notification = await Database.selectOne(
        "notifications",
        "*",
        "id = ?",
        [notificationId]
      );

      if (!notification || notification.status !== "pending") {
        return;
      }

      let result = false;
      let errorMessage = null;

      switch (notification.channel) {
        case "email":
          result = await this.sendEmail(notification);
          break;
        case "sms":
          result = await this.sendSMS(notification);
          break;
        case "push":
          result = await this.sendPush(notification);
          break;
        default:
          errorMessage = `Unknown notification channel: ${notification.channel}`;
      }

      // Update notification status
      await Database.update(
        "notifications",
        {
          status: result ? "sent" : "failed",
          sent_at: result ? new Date() : null,
          error_message: errorMessage,
          updated_at: new Date(),
        },
        "id = ?",
        [notificationId]
      );

      return result;
    } catch (error) {
      console.error("Error processing notification:", error);

      await Database.update(
        "notifications",
        {
          status: "failed",
          error_message: error.message,
          updated_at: new Date(),
        },
        "id = ?",
        [notificationId]
      );

      return false;
    }
  }

  // Send email notification (from notification object)
  async sendEmail(notification) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log("📧 Email notification (SMTP not configured):", {
        to: notification.recipient,
        subject: notification.subject,
        message: notification.message,
      });
      return true; // Simulate success in development
    }

    try {
      const mailOptions = {
        from: `"${process.env.MAIL_FROM_NAME || 'Prove Ownership'}" <${process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER}>`,
        to: notification.recipient,
        subject: notification.subject,
        html: this.generateEmailHTML(
          notification.message,
          notification.payload
        ),
      };

      await this.emailTransporter.sendMail(mailOptions);
      console.log("✅ Email sent successfully to:", notification.recipient);
      return true;
    } catch (error) {
      console.error("❌ Email send failed:", error);
      return false;
    }
  }

  // Send email directly (for OTP and immediate notifications)
  async sendEmailDirect(to, subject, htmlContent) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log("📧 Direct email (SMTP not configured):", {
        to,
        subject,
        content: htmlContent.substring(0, 100) + '...'
      });
      return true; // Simulate success in development
    }

    try {
      const mailOptions = {
        from: `"${process.env.MAIL_FROM_NAME || 'Prove Ownership'}" <${process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER}>`,
        to,
        subject,
        html: htmlContent,
      };

      const result = await this.emailTransporter.sendMail(mailOptions);
      console.log("✅ Direct email sent successfully to:", to);
      console.log("   Message ID:", result.messageId);
      return true;
    } catch (error) {
      console.error("❌ Direct email send failed:", error);
      console.error("   Error details:", error.message);
      return false;
    }
  }

  // Send SMS notification
  async sendSMS(notification) {
    if (!this.twilioClient) {
      console.log("📱 SMS notification (Twilio not configured):", {
        to: notification.recipient,
        message: notification.message,
      });
      return true; // Simulate success in development
    }

    try {
      await this.twilioClient.messages.create({
        body: notification.message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: notification.recipient,
      });

      console.log("✅ SMS sent successfully to:", notification.recipient);
      return true;
    } catch (error) {
      console.error("❌ SMS send failed:", error);
      return false;
    }
  }

  // Send push notification
  async sendPush(notification) {
    // Firebase FCM implementation would go here
    console.log("🔔 Push notification (FCM not configured):", {
      to: notification.recipient,
      message: notification.message,
    });
    return true; // Simulate success in development
  }

  // Generate HTML email template
  generateEmailHTML(message, payload) {
    const data = payload ? JSON.parse(payload) : {};

    let extraContent = '';
    if (data.caseId) {
      extraContent += `<p><strong>Case ID:</strong> ${data.caseId}</p>`;
    }
    if (data.deviceInfo) {
      extraContent += `<p><strong>Device:</strong> ${data.deviceInfo}</p>`;
    }

    const content = `${message}${extraContent}`;
    const actionButton = data.actionUrl ? { url: data.actionUrl, text: 'Take Action' } : null;
    return EmailTemplate.wrapContent('Prove Ownership Notification', content, { actionButton });
  }

  // Notification templates
  async notifyDeviceVerified(userId, deviceInfo) {
    const user = await Database.selectOne(
      "users",
      "name, email, phone",
      "id = ?",
      [userId]
    );
    if (!user) return;

    const subject = "Device Verification Approved";
    const deviceName = `${deviceInfo.brand} ${deviceInfo.model}`;
    const message = `
      <p>Hello <strong>${user.name}</strong>,</p>
      <p><strong>Great news!</strong> Your device has been verified and approved.</p>
      <div style="background: #F0FDF4; border-left: 4px solid #22C55E; padding: 16px; border-radius: 8px; margin: 15px 0;">
        <p style="margin: 0; color: #166534; font-size: 15px;"><strong>${deviceName}</strong></p>
        <p style="margin: 5px 0 0; color: #166534; font-size: 13px;">IMEI/Serial: ${deviceInfo.imei || deviceInfo.serial}</p>
      </div>
      <p>Your device is now protected in our registry. If it's ever reported stolen or lost, we'll help with recovery efforts.</p>
    `;

    const wrappedHtml = EmailTemplate.wrapContent(subject, message);
    await this.queueNotification(
      userId,
      "email",
      user.email,
      subject,
      wrappedHtml,
      {
        deviceInfo: deviceName,
        type: "device_verified",
      }
    );

    if (user.phone) {
      const smsMessage = `Prove Ownership: Your ${deviceInfo.brand} ${deviceInfo.model} has been verified and is now protected. Case any issues, contact support.`;
      await this.queueNotification(userId, "sms", user.phone, null, smsMessage);
    }
  }

  async notifyDeviceRejected(userId, deviceInfo, reason) {
    const user = await Database.selectOne(
      "users",
      "name, email, phone",
      "id = ?",
      [userId]
    );
    if (!user) return;

    const subject = "Device Verification Rejected";
    const deviceName = `${deviceInfo.brand} ${deviceInfo.model}`;
    const message = `
      <p>Hello <strong>${user.name}</strong>,</p>
      <p>Unfortunately, we couldn't verify your device.</p>
      <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 16px; border-radius: 8px; margin: 15px 0;">
        <p style="margin: 0; color: #991B1B; font-size: 15px;"><strong>${deviceName}</strong></p>
        <p style="margin: 5px 0 0; color: #991B1B; font-size: 13px;">IMEI/Serial: ${deviceInfo.imei || deviceInfo.serial}</p>
      </div>
      <p><strong>Reason:</strong> ${reason || "Insufficient proof of ownership"}</p>
      <p>Please upload a clearer proof of purchase and try again.</p>
    `;

    const wrappedHtml = EmailTemplate.wrapContent(subject, message);
    await this.queueNotification(
      userId,
      "email",
      user.email,
      subject,
      wrappedHtml,
      {
        deviceInfo: deviceName,
        type: "device_rejected",
      }
    );
  }

  async notifyDeviceStolen(userId, deviceInfo, caseId) {
    const user = await Database.selectOne(
      "users",
      "name, email, phone",
      "id = ?",
      [userId]
    );
    if (!user) return;

    const subject = `Device Reported Stolen - Case ${caseId}`;
    const deviceName = `${deviceInfo.brand} ${deviceInfo.model}`;
    const message = `
      <p>Hello <strong>${user.name}</strong>,</p>
      <p><strong>Your device has been marked as stolen</strong> in our system.</p>
      <div style="background: #FEF2F2; border-left: 4px solid #DC2626; padding: 16px; border-radius: 8px; margin: 15px 0;">
        <p style="margin: 0; color: #991B1B; font-size: 15px;"><strong>${deviceName}</strong></p>
        <p style="margin: 5px 0 0; color: #991B1B; font-size: 13px;">IMEI/Serial: ${deviceInfo.imei || deviceInfo.serial}</p>
      </div>
      <p><strong>Case ID:</strong> ${caseId}</p>
      <p>Law enforcement has been notified. We'll contact you if there are any updates.</p>
    `;

    const wrappedHtml = EmailTemplate.wrapContent(subject, message);
    await this.queueNotification(
      userId,
      "email",
      user.email,
      subject,
      wrappedHtml,
      {
        caseId: caseId,
        deviceInfo: deviceName,
        type: "device_stolen",
      }
    );

    if (user.phone) {
      const smsMessage = `Prove Ownership: Your ${deviceInfo.brand} ${deviceInfo.model} reported stolen. Case ID: ${caseId}. LEA notified.`;
      await this.queueNotification(userId, "sms", user.phone, null, smsMessage);
    }
  }

  async notifyLEANewCase(leaId, caseInfo) {
    const lea = await Database.selectOne(
      "law_enforcement_agencies",
      "agency_name, contact_email, contact_phone",
      "id = ?",
      [leaId]
    );
    if (!lea) return;

    const subject = `New Case Assignment - ${caseInfo.case_id}`;
    const message = `
      <p>Hello <strong>${lea.agency_name}</strong>,</p>
      <p>A new <strong>${caseInfo.report_type}</strong> case has been assigned to your agency.</p>
      <div style="background: #F3F4F6; border-radius: 8px; padding: 16px; margin: 15px 0;">
        <table cellpadding="4" cellspacing="0" style="font-size: 14px; color: #374151;">
          <tr><td style="font-weight: 600; padding-right: 12px;">Case ID:</td><td>${caseInfo.case_id}</td></tr>
          <tr><td style="font-weight: 600; padding-right: 12px;">Device:</td><td>${caseInfo.device_brand} ${caseInfo.device_model}</td></tr>
          <tr><td style="font-weight: 600; padding-right: 12px;">IMEI:</td><td>${caseInfo.device_imei || "Not provided"}</td></tr>
          <tr><td style="font-weight: 600; padding-right: 12px;">Location:</td><td>${caseInfo.location || "Not specified"}</td></tr>
          <tr><td style="font-weight: 600; padding-right: 12px;">Occurred:</td><td>${new Date(caseInfo.occurred_at).toLocaleString()}</td></tr>
        </table>
      </div>
      <p>Please log into the LEA portal to review case details and take action.</p>
    `;

    const actionButton = { url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/lea/cases/${caseInfo.case_id}`, text: 'Review Case' };
    const wrappedHtml = EmailTemplate.wrapContent(subject, message, { actionButton });
    await this.queueNotification(
      null,
      "email",
      lea.contact_email,
      subject,
      wrappedHtml,
      {
        caseId: caseInfo.case_id,
        type: "lea_new_case",
      }
    );
  }

  async notifyDeviceFound(userId, deviceInfo, finderInfo, caseId) {
    const user = await Database.selectOne(
      "users",
      "name, email, phone",
      "id = ?",
      [userId]
    );
    if (!user) return;

    const subject = `Your Device May Have Been Found - Case ${caseId}`;
    const deviceName = `${deviceInfo.brand} ${deviceInfo.model}`;
    const message = `
      <p>Hello <strong>${user.name}</strong>,</p>
      <p><strong>Great news!</strong> Someone has reported finding a device matching yours.</p>
      <div style="background: #F0FDF4; border-left: 4px solid #22C55E; padding: 16px; border-radius: 8px; margin: 15px 0;">
        <p style="margin: 0; color: #166534; font-size: 15px;"><strong>${deviceName}</strong></p>
        <p style="margin: 5px 0 0; color: #166534; font-size: 13px;">IMEI/Serial: ${deviceInfo.imei || deviceInfo.serial}</p>
      </div>
      <p><strong>Case ID:</strong> ${caseId}</p>
      <p><strong>Finder Contact:</strong> ${finderInfo.contact || "Available through LEA"}</p>
      <p>Law enforcement has been notified to coordinate the return. They will contact you soon.</p>
    `;

    const wrappedHtml = EmailTemplate.wrapContent(subject, message);
    await this.queueNotification(
      userId,
      "email",
      user.email,
      subject,
      wrappedHtml,
      {
        caseId: caseId,
        deviceInfo: deviceName,
        type: "device_found",
      }
    );

    if (user.phone) {
      const smsMessage = `Prove Ownership: Your ${deviceInfo.brand} ${deviceInfo.model} may have been found! Case: ${caseId}. LEA will contact you.`;
      await this.queueNotification(userId, "sms", user.phone, null, smsMessage);
    }
  }

  // Process pending notifications (for background job)
  async processPendingNotifications(limit = 10) {
    const pendingNotifications = await Database.select(
      "notifications",
      "id",
      "status = ? AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)",
      ["pending"],
      "created_at ASC",
      limit
    );

    let processed = 0;
    for (const notification of pendingNotifications) {
      const success = await this.processNotification(notification.id);
      if (success) processed++;
    }

    return { total: pendingNotifications.length, processed };
  }

  // Retry failed notifications
  async retryFailedNotifications(maxRetries = 3) {
    const failedNotifications = await Database.query(
      `
      SELECT id, error_message, retry_count
      FROM notifications 
      WHERE status = 'failed' 
      AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      AND retry_count < ?
      ORDER BY created_at ASC
      LIMIT 10
    `,
      [maxRetries]
    );

    let retried = 0;
    for (const notification of failedNotifications) {
      // Update retry count
      await Database.update(
        "notifications",
        {
          retry_count: (notification.retry_count || 0) + 1,
          status: "pending",
          updated_at: new Date(),
        },
        "id = ?",
        [notification.id]
      );

      const success = await this.processNotification(notification.id);
      if (success) retried++;
    }

    return { total: failedNotifications.length, retried };
  }
}

module.exports = new NotificationService();
