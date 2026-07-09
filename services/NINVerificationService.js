const Database = require('../config');
const crypto = require('crypto');
const axios = require('axios');

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.KYC_ENCRYPTION_KEY || 'vOVH6sdmpNWjRRIqCc7rdxs01lwBzfr3';
const IV_LENGTH = 16;

class NINVerificationService {
  static encrypt(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  static decrypt(text) {
    if (!text) return null;
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encrypted = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }

  static async getProvider() {
    const row = await Database.selectOne('system_settings', 'setting_value',
      "setting_key = 'nin_verification_provider'");
    return row?.setting_value || 'prembly';
  }

  static async verifyNIN(nin) {
    if (!nin || !/^\d{11}$/.test(nin)) {
      throw new Error('Invalid NIN format. Must be 11 digits.');
    }

    const provider = await this.getProvider();
    const providers = this.getProviderChain(provider);

    let lastError = null;
    for (const providerInstance of providers) {
      try {
        console.log(`NIN Verification: Trying provider ${providerInstance.name}`);
        const result = await providerInstance.verify(nin);
        console.log(`NIN Verification: Success via ${providerInstance.name}`);
        return result;
      } catch (error) {
        console.error(`NIN Verification: ${providerInstance.name} failed - ${error.message}`);
        lastError = error;
        continue;
      }
    }

    throw lastError || new Error('All NIN verification providers failed');
  }

  static getProviderChain(preferredProvider) {
    const allProviders = [
      new PremblyNINProvider(),
      new DojahNINProvider(),
      new VerifyNGNINProvider()
    ];

    const preferred = allProviders.find(p => p.name === preferredProvider);
    const others = allProviders.filter(p => p.name !== preferredProvider);

    if (preferred) {
      return [preferred, ...others];
    }
    return allProviders;
  }

  static async matchIdentity(userId, ninData) {
    const user = await Database.selectOne('users', 'name, email', 'id = ?', [userId]);
    if (!user) throw new Error('User not found');

    const ninFullName = `${ninData.first_name} ${ninData.last_name}`.toLowerCase().trim();
    const accountName = user.name.toLowerCase().trim();

    const nameMatch = ninFullName.includes(accountName) || accountName.includes(ninFullName);
    return {
      matched: nameMatch,
      nin_name: ninFullName,
      account_name: accountName,
      confidence: nameMatch ? 'high' : 'low'
    };
  }

  static async verifyAndLink(userId, nin) {
    const ninData = await this.verifyNIN(nin);
    const matchResult = await this.matchIdentity(userId, ninData);

    const verificationId = Database.generateUUID();

    await Database.insert('kyc_verifications', {
      id: verificationId,
      user_id: userId,
      nin: nin,
      nin_status: matchResult.matched ? 'verified' : 'failed',
      verification_response: JSON.stringify({ ninData, matchResult, provider: ninData.provider }),
      verified_at: matchResult.matched ? new Date() : null,
      created_at: new Date()
    });

    if (matchResult.matched) {
      const lastDigits = nin.slice(-4);
      await Database.update('users', {
        kyc_status: 'verified',
        is_verified: true,
        nin_verified_at: new Date(),
        nin_last_digits: lastDigits,
        verified_full_name: `${ninData.first_name} ${ninData.last_name}`,
        verified_dob: ninData.date_of_birth,
        verified_gender: ninData.gender,
        verified_photo_url: ninData.photo_url || null,
        verification_badge_visible: true,
        caution_flag: false,
        updated_at: new Date()
      }, 'id = ?', [userId]);

      await Database.query(
        `UPDATE devices SET status = 'verified', verified_at = NOW(), updated_at = NOW() WHERE user_id = ? AND status = 'unverified'`,
        [userId]
      );
    } else {
      await Database.update('users', {
        kyc_status: 'failed',
        caution_flag: true,
        updated_at: new Date()
      }, 'id = ?', [userId]);
    }

    await Database.logAudit(userId,
      matchResult.matched ? 'NIN_VERIFIED' : 'NIN_FAILED',
      'kyc_verifications', verificationId,
      null, { match: matchResult, provider: ninData.provider });

    return {
      success: matchResult.matched,
      verificationId,
      match: matchResult,
      provider: ninData.provider,
      message: matchResult.matched
        ? 'Identity verified successfully. All your devices are now verified.'
        : 'NIN found but name does not match your account. Please contact support.'
    };
  }
}

class PremblyNINProvider {
  constructor() {
    this.name = 'prembly';
    this.baseURL = 'https://api.prembly.com';
    this.apiKey = process.env.PREMBLY_API_KEY || '';
  }

  async verify(nin) {
    if (!this.apiKey) {
      throw new Error('Prembly API key not configured (PREMBLY_API_KEY)');
    }

    const response = await axios.post(
      `${this.baseURL}/verification/identitypass/nin`,
      { id_number: nin },
      {
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const body = response.data;

    if (!body.status || body.status_code !== '00') {
      const detail = body.detail || body.message || 'Verification failed';
      throw new Error(`Prembly NIN verification failed: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    }

    const data = body.data || body.detail || {};

    return {
      provider: 'prembly',
      nin,
      first_name: data.first_name || data.FirstName || '',
      last_name: data.last_name || data.LastName || '',
      middle_name: data.middle_name || data.MiddleName || '',
      date_of_birth: data.dob || data.date_of_birth || data.DOB || '',
      gender: data.gender || data.Gender || '',
      photo_url: data.photo || data.image || data.Photo || null,
      address: data.address || data.Address || '',
      verified: true
    };
  }
}

class DojahNINProvider {
  constructor() {
    this.name = 'dojah';
    this.baseURL = 'https://api.dojah.io';
    this.appId = process.env.DOJAH_APP_ID || '';
    this.apiKey = process.env.DOJAH_API_KEY || '';
  }

  async verify(nin) {
    if (!this.appId || !this.apiKey) {
      throw new Error('Dojah credentials not configured (DOJAH_APP_ID, DOJAH_API_KEY)');
    }

    const response = await axios.post(
      `${this.baseURL}/api/v1/id/nin`,
      { nin },
      {
        headers: {
          'Authorization': `${this.appId}:${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const body = response.data;

    if (!body.success && !body.entity) {
      throw new Error(`Dojah NIN verification failed: ${body.error || body.message || 'Unknown error'}`);
    }

    const data = body.entity || {};

    return {
      provider: 'dojah',
      nin,
      first_name: data.first_name || data.FirstName || '',
      last_name: data.last_name || data.LastName || '',
      middle_name: data.middle_name || data.MiddleName || '',
      date_of_birth: data.dob || data.date_of_birth || '',
      gender: data.gender || '',
      photo_url: data.image_base64 || null,
      address: data.address || '',
      verified: true
    };
  }
}

class VerifyNGNINProvider {
  constructor() {
    this.name = 'verifyng';
    this.baseURL = 'https://api.verifyng.com';
    this.apiKey = process.env.VERIFYNG_API_KEY || '';
  }

  async verify(nin) {
    if (!this.apiKey) {
      throw new Error('VerifyNG API key not configured (VERIFYNG_API_KEY)');
    }

    const response = await axios.post(
      `${this.baseURL}/api/v1/identity/nin`,
      { id_number: nin },
      {
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const body = response.data;

    if (!body.status && !body.success) {
      throw new Error(`VerifyNG NIN verification failed: ${body.message || body.error || 'Unknown error'}`);
    }

    const data = body.data || body.entity || {};

    return {
      provider: 'verifyng',
      nin,
      first_name: data.first_name || data.FirstName || '',
      last_name: data.last_name || data.LastName || '',
      middle_name: data.middle_name || data.MiddleName || '',
      date_of_birth: data.dob || data.date_of_birth || '',
      gender: data.gender || '',
      photo_url: data.photo || data.image || null,
      address: data.address || '',
      verified: true
    };
  }
}

module.exports = NINVerificationService;
