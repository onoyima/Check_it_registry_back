// Notification Service - Email, SMS, and Push Notifications
const nodemailer = require("nodemailer");
const Database = require("../config");

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
        from: `"${process.env.MAIL_FROM_NAME || 'Check It Registry'}" <${process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER}>`,
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
        from: `"${process.env.MAIL_FROM_NAME || 'Check It Registry'}" <${process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER}>`,
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

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Check It - Device Registry</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #646cff; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
          .button { display: inline-block; padding: 10px 20px; background: #646cff; color: white; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Check It - Device Registry</h1>
          </div>
          <div class="content">
            ${message}
            ${
              data.caseId
                ? `<p><strong>Case ID:</strong> ${data.caseId}</p>`
                : ""
            }
            ${
              data.deviceInfo
                ? `<p><strong>Device:</strong> ${data.deviceInfo}</p>`
                : ""
            }
            ${
              data.actionUrl
                ? `<p><a href="${data.actionUrl}" class="button">Take Action</a></p>`
                : ""
            }
          </div>
          <div class="footer">
            <p>This is an automated message from Check It Device Registry.</p>
            <p>If you have questions, please contact support.</p>
          </div>
        </div>
      </body>
      </html>
    `;
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
    const message = `
      <h2>Great news!</h2>
      <p>Your device <strong>${deviceInfo.brand} ${
      deviceInfo.model
    }</strong> has been verified and approved.</p>
      <p>Your device is now protected in our registry. If it's ever reported stolen or lost, we'll help with recovery efforts.</p>
      <p>IMEI/Serial: ${deviceInfo.imei || deviceInfo.serial}</p>
    `;

    await this.queueNotification(
      userId,
      "email",
      user.email,
      subject,
      message,
      {
        deviceInfo: `${deviceInfo.brand} ${deviceInfo.model}`,
        type: "device_verified",
      }
    );

    if (user.phone) {
      const smsMessage = `Check It: Your ${deviceInfo.brand} ${deviceInfo.model} has been verified and is now protected. Case any issues, contact support.`;
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
    const message = `
      <h2>Device Verification Update</h2>
      <p>Unfortunately, we couldn't verify your device <strong>${
        deviceInfo.brand
      } ${deviceInfo.model}</strong>.</p>
      <p><strong>Reason:</strong> ${
        reason || "Insufficient proof of ownership"
      }</p>
      <p>Please upload a clearer proof of purchase and try again.</p>
      <p>IMEI/Serial: ${deviceInfo.imei || deviceInfo.serial}</p>
    `;

    await this.queueNotification(
      userId,
      "email",
      user.email,
      subject,
      message,
      {
        deviceInfo: `${deviceInfo.brand} ${deviceInfo.model}`,
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
    const message = `
      <h2>Device Theft Report Confirmed</h2>
      <p>Your device <strong>${deviceInfo.brand} ${
      deviceInfo.model
    }</strong> has been marked as stolen in our system.</p>
      <p><strong>Case ID:</strong> ${caseId}</p>
      <p>Law enforcement has been notified. We'll contact you if there are any updates.</p>
      <p>IMEI/Serial: ${deviceInfo.imei || deviceInfo.serial}</p>
    `;

    await this.queueNotification(
      userId,
      "email",
      user.email,
      subject,
      message,
      {
        caseId: caseId,
        deviceInfo: `${deviceInfo.brand} ${deviceInfo.model}`,
        type: "device_stolen",
      }
    );

    if (user.phone) {
      const smsMessage = `Check It: Your ${deviceInfo.brand} ${deviceInfo.model} reported stolen. Case ID: ${caseId}. LEA notified.`;
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
      <h2>New Case Assignment</h2>
      <p>A new ${
        caseInfo.report_type
      } case has been assigned to your agency.</p>
      <p><strong>Case ID:</strong> ${caseInfo.case_id}</p>
      <p><strong>Device:</strong> ${caseInfo.device_brand} ${
      caseInfo.device_model
    }</p>
      <p><strong>IMEI:</strong> ${caseInfo.device_imei || "Not provided"}</p>
      <p><strong>Location:</strong> ${caseInfo.location || "Not specified"}</p>
      <p><strong>Occurred:</strong> ${new Date(
        caseInfo.occurred_at
      ).toLocaleString()}</p>
      <p>Please log into the LEA portal to review case details and take action.</p>
    `;

    await this.queueNotification(
      null,
      "email",
      lea.contact_email,
      subject,
      message,
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
    const message = `
      <h2>Great News!</h2>
      <p>Someone has reported finding a device matching your <strong>${
        deviceInfo.brand
      } ${deviceInfo.model}</strong>.</p>
      <p><strong>Case ID:</strong> ${caseId}</p>
      <p><strong>Finder Contact:</strong> ${
        finderInfo.contact || "Available through LEA"
      }</p>
      <p>Law enforcement has been notified to coordinate the return. They will contact you soon.</p>
      <p>IMEI/Serial: ${deviceInfo.imei || deviceInfo.serial}</p>
    `;

    await this.queueNotification(
      userId,
      "email",
      user.email,
      subject,
      message,
      {
        caseId: caseId,
        deviceInfo: `${deviceInfo.brand} ${deviceInfo.model}`,
        type: "device_found",
      }
    );

    if (user.phone) {
      const smsMessage = `Check It: Your ${deviceInfo.brand} ${deviceInfo.model} may have been found! Case: ${caseId}. LEA will contact you.`;
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
