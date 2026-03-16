// Device Security Service for tracking and managing trusted devices
const crypto = require('crypto');
const Database = require('../config');
const OTPService = require('./OTPService');

class DeviceSecurityService {
  // Generate device fingerprint from request headers and IP
  generateDeviceFingerprint(req) {
    const userAgent = req.get('User-Agent') || '';
    const acceptLanguage = req.get('Accept-Language') || '';
    const acceptEncoding = req.get('Accept-Encoding') || '';
    // Exclude IP to keep fingerprint stable across networks
    // Add a coarse-grained platform signal from UA to improve uniqueness
    const platformHint = (userAgent.match(/(Windows|Mac OS|Linux|Android|iOS)/) || [''])[0];

    // Create a fingerprint based on stable device characteristics
    const fingerprintData = `${userAgent}|${acceptLanguage}|${acceptEncoding}|${platformHint}`;
    return crypto.createHash('sha256').update(fingerprintData).digest('hex');
  }

  // Check if device is trusted for the user
  async isDeviceTrusted(userId, deviceFingerprint) {
    try {
      const trustedDevice = await Database.selectOne(
        'user_sessions',
        'id, is_trusted, last_activity, expires_at',
        'user_id = ? AND device_fingerprint = ? AND is_trusted = ? AND is_active = ?',
        [userId, deviceFingerprint, true, true]
      );

      if (!trustedDevice) {
        return false;
      }

      // Check expiry and activity against a 90-day trust window
      const now = new Date();
      const lastActivity = new Date(trustedDevice.last_activity);
      const trustDays = parseInt(process.env.TRUSTED_DEVICE_DAYS || '30');
      const cutoffDate = new Date(Date.now() - trustDays * 24 * 60 * 60 * 1000);

      const expired = trustedDevice.expires_at && new Date(trustedDevice.expires_at) < now;
      const inactiveTooLong = lastActivity < cutoffDate;

      if (expired || inactiveTooLong) {
        // Mark as inactive if expired or too old
        await Database.update(
          'user_sessions',
          { is_active: false, updated_at: new Date(), is_trusted: false },
          'id = ?',
          [trustedDevice.id]
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error checking trusted device:', error);
      return false;
    }
  }

  // Create a new device session
  async createDeviceSession(userId, req, isTrusted = false) {
    try {
      const deviceFingerprint = this.generateDeviceFingerprint(req);
      const userAgent = req.get('User-Agent') || '';
      const ipAddress = req.ip || req.connection.remoteAddress || '';
      
      // Deactivate old sessions for this device
      await Database.query(
        'UPDATE user_sessions SET is_active = false WHERE user_id = ? AND device_fingerprint = ?',
        [userId, deviceFingerprint]
      );

      // Create new session
      const sessionId = Database.generateUUID();
      const sessionData = {
        id: sessionId,
        user_id: userId,
        ip_address: ipAddress,
        user_agent: userAgent,
        device_fingerprint: deviceFingerprint,
        is_trusted: isTrusted,
        is_active: true,
        created_at: new Date(),
        last_activity: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      };

      await Database.insert('user_sessions', sessionData);

      return {
        sessionId,
        deviceFingerprint,
        isTrusted
      };
    } catch (error) {
      console.error('Error creating device session:', error);
      throw error;
    }
  }

  // Update session activity
  async updateSessionActivity(userId, deviceFingerprint) {
    try {
      await Database.update(
        'user_sessions',
        { last_activity: new Date() },
        'user_id = ? AND device_fingerprint = ? AND is_active = ?',
        [userId, deviceFingerprint, true]
      );
    } catch (error) {
      console.error('Error updating session activity:', error);
    }
  }

  // Trust a device after OTP verification
  async trustDevice(userId, deviceFingerprint) {
    try {
      await Database.update(
        'user_sessions',
        { 
          is_trusted: true, 
          updated_at: new Date(),
          expires_at: new Date(Date.now() + parseInt(process.env.TRUSTED_DEVICE_DAYS || '30') * 24 * 60 * 60 * 1000) // Configurable trust window
        },
        'user_id = ? AND device_fingerprint = ? AND is_active = ?',
        [userId, deviceFingerprint, true]
      );

      // Log device trust event
      await Database.insert('audit_logs', {
        id: Database.generateUUID(),
        user_id: userId,
        action: 'device_trusted',
        resource_type: 'security',
        resource_id: deviceFingerprint,
        details: 'Device marked as trusted after OTP verification',
        severity: 'medium',
        status: 'success',
        created_at: new Date()
      });

      return true;
    } catch (error) {
      console.error('Error trusting device:', error);
      return false;
    }
  }

  // Get user's trusted devices
  async getTrustedDevices(userId) {
    try {
      const devices = await Database.query(`
        SELECT 
          id,
          ip_address,
          user_agent,
          created_at,
          last_activity,
          is_active
        FROM user_sessions 
        WHERE user_id = ? AND is_trusted = ? AND is_active = ?
        ORDER BY last_activity DESC
      `, [userId, true, true]);

      return devices.map(device => ({
        ...device,
        device_info: this.parseUserAgent(device.user_agent),
        location: device.ip_address // Could be enhanced with geolocation
      }));
    } catch (error) {
      console.error('Error getting trusted devices:', error);
      return [];
    }
  }

  // Revoke trust for a device
  async revokeTrustedDevice(userId, sessionId) {
    try {
      const result = await Database.update(
        'user_sessions',
        { is_trusted: false, is_active: false, updated_at: new Date() },
        'id = ? AND user_id = ?',
        [sessionId, userId]
      );

      if (result.affectedRows > 0) {
        // Log device trust revocation
        await Database.insert('audit_logs', {
          id: Database.generateUUID(),
          user_id: userId,
          action: 'device_trust_revoked',
          resource_type: 'security',
          resource_id: sessionId,
          details: 'User revoked trust for device',
          severity: 'medium',
          status: 'success',
          created_at: new Date()
        });
      }

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error revoking trusted device:', error);
      return false;
    }
  }

  // Parse user agent to extract device info
  parseUserAgent(userAgent) {
    if (!userAgent) return { browser: 'Unknown', os: 'Unknown', device: 'Unknown' };

    let browser = 'Unknown';
    let os = 'Unknown';
    let device = 'Desktop';

    // Browser detection
    if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else if (userAgent.includes('Edge')) browser = 'Edge';
    else if (userAgent.includes('Opera')) browser = 'Opera';

    // OS detection
    if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Mac OS')) os = 'macOS';
    else if (userAgent.includes('Linux')) os = 'Linux';
    else if (userAgent.includes('Android')) os = 'Android';
    else if (userAgent.includes('iOS')) os = 'iOS';

    // Device type detection
    if (userAgent.includes('Mobile') || userAgent.includes('Android')) device = 'Mobile';
    else if (userAgent.includes('Tablet') || userAgent.includes('iPad')) device = 'Tablet';

    return { browser, os, device };
  }

  // Clean up old sessions
  async cleanupOldSessions() {
    try {
      const result = await Database.query(
        'DELETE FROM user_sessions WHERE expires_at < NOW() OR (last_activity < DATE_SUB(NOW(), INTERVAL 90 DAY) AND is_trusted = false)'
      );

      console.log(`Cleaned up ${result.affectedRows} old device sessions`);
      return result.affectedRows;
    } catch (error) {
      console.error('Error cleaning up old sessions:', error);
      return 0;
    }
  }

  // Send device login notification
  async sendDeviceLoginNotification(userId, deviceInfo, ipAddress, isNewDevice = false) {
    try {
      const user = await Database.selectOne('users', 'name, email', 'id = ?', [userId]);
      if (!user) return;

      const subject = isNewDevice ? 
        'New Device Login - Check It Registry' : 
        'Device Login - Check It Registry';

      const template = `
        <h2>${isNewDevice ? 'New Device Login Detected' : 'Device Login'}</h2>
        <p>Hello ${user.name},</p>
        <p>A ${isNewDevice ? 'new' : ''} login was detected on your account:</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Device:</strong> ${deviceInfo.device}</p>
          <p><strong>Browser:</strong> ${deviceInfo.browser}</p>
          <p><strong>Operating System:</strong> ${deviceInfo.os}</p>
          <p><strong>IP Address:</strong> ${ipAddress}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        </div>
        ${isNewDevice ? `
          <p style="color: #ff6b35;"><strong>If this wasn't you, please:</strong></p>
          <ul>
            <li>Change your password immediately</li>
            <li>Review your trusted devices</li>
            <li>Contact support if needed</li>
          </ul>
        ` : ''}
        <p>Stay secure!</p>
      `;

      const NotificationService = require('./NotificationService');
      await NotificationService.sendEmail(user.email, subject, template);
    } catch (error) {
      console.error('Error sending device login notification:', error);
    }
  }
}

module.exports = new DeviceSecurityService();