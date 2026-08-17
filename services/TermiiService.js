const axios = require('axios');

const TERMII_API_KEY = process.env.TERMII_API_KEY;
const TERMII_BASE_URL = process.env.TERMII_BASE_URL || 'https://api.termii.com';
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || 'Prove Ownership';
const TERMII_CHANNEL = process.env.TERMII_CHANNEL || 'dnd'; // dnd, generic, whatsapp
const APP_NAME = process.env.APP_NAME || 'Prove Ownership';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

class TermiiService {
  /**
   * Send an SMS via Termii API
   * @param {string} to - Phone number in 234XXXXXXXXXX format
   * @param {string} message - SMS body text
   * @returns {Object} { success, data?, error? }
   */
  static async sendSMS(to, message) {
    if (process.env.NODE_ENV === 'test') {
      return { success: true, data: { message_id: 'test-skip' } };
    }

    if (!TERMII_API_KEY) {
      console.warn('[Termii] API key not configured. SMS not sent.');
      return { success: false, reason: 'TERMII_API_KEY not configured' };
    }

    // Normalize phone number to 234 format
    const normalizedPhone = this.normalizePhone(to);
    if (!normalizedPhone) {
      return { success: false, reason: 'Invalid phone number format' };
    }

    try {
      const response = await axios.post(`${TERMII_BASE_URL}/api/sms/send`, {
        api_key: TERMII_API_KEY,
        to: normalizedPhone,
        from: TERMII_SENDER_ID,
        sms: message,
        type: 'plain',
        channel: TERMII_CHANNEL,
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      console.log('[Termii] SMS sent to:', normalizedPhone);
      return { success: true, data: response.data };
    } catch (error) {
      const errMsg = error.response?.data?.message || error.message;
      console.error('[Termii] SMS failed:', errMsg);
      return { success: false, error: errMsg };
    }
  }

  /**
   * Send device check alert SMS to device owner
   * This is the ONLY SMS sent in the entire system.
   */
  static async sendDeviceCheckAlert(phone, { deviceName, deviceId, status, checkerInfo, location }) {
    const message = this.buildDeviceCheckMessage({
      deviceName,
      deviceId,
      status,
      checkerInfo,
      location,
    });

    return this.sendSMS(phone, message);
  }

  /**
   * Build the device check alert SMS message
   * Template: Dear Owner, your {{Device}} ID {{name and ID}} has been {{STATUS}}. {{Additional message from Company Name}}.
   */
  static buildDeviceCheckMessage({ deviceName, deviceId, status, checkerInfo, location }) {
    const locationText = location
      ? ` at ${location.latitude}, ${location.longitude}`
      : '';

    const checkerText = checkerInfo
      ? ` by ${checkerInfo}`
      : ' by an anonymous user';

    const lines = [
      `Dear Owner,`,
      `Your ${deviceName} ID ${deviceId} has been ${status}${checkerText}${locationText}.`,
      `${APP_NAME} recommends you review this activity immediately. If you did not authorize this, contact law enforcement.`,
      `View details: ${FRONTEND_URL}/devices`,
    ];

    return lines.join(' ');
  }

  /**
   * Normalize phone number to 234XXXXXXXXXX format (Nigerian)
   */
  static normalizePhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');

    // Already 234 format
    if (/^234\d{10}$/.test(cleaned)) return cleaned;

    // 0XXXXXXXXX format (local Nigerian)
    if (/^0\d{10}$/.test(cleaned)) return '234' + cleaned.substring(1);

    // +234 format
    if (/^\+234\d{10}$/.test(cleaned)) return cleaned.substring(1);

    // 10 digit without prefix
    if (/^\d{10}$/.test(cleaned)) return '234' + cleaned;

    console.warn('[Termii] Could not normalize phone number:', phone);
    return null;
  }
}

module.exports = TermiiService;
