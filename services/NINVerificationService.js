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

  /**
   * Verify NIN via Prembly only. No fallback providers.
   * Prembly is the sole KYC API for this system.
   */
  static async verifyNIN(nin) {
    if (!nin || !/^\d{11}$/.test(nin)) {
      throw new Error('Invalid NIN format. Must be 11 digits.');
    }

    const apiKey = process.env.PREMBLY_API_KEY;
    if (!apiKey) {
      throw new Error('Prembly API key not configured (PREMBLY_API_KEY)');
    }

    const response = await axios.post(
      'https://api.prembly.com/verification/identitypass/nin',
      { id_number: nin },
      {
        headers: {
          'x-api-key': apiKey,
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

  /**
   * Perform identity matching between Prembly response and user data.
   * Checks surname, first name, middle name, gender.
   * Requires at least 2 name fields to match (or surname + any other).
   */
  static async matchIdentity(userId, ninData) {
    const user = await Database.selectOne(
      'users',
      'name, first_name, middle_name, last_name, email, verified_gender',
      'id = ?',
      [userId]
    );
    if (!user) throw new Error('User not found');

    const normalize = (str) => (str || '').toLowerCase().trim().replace(/\s+/g, ' ');

    const userSurname = normalize(user.last_name);
    const userFirstName = normalize(user.first_name);
    const userMiddleName = normalize(user.middle_name);
    const userName = normalize(user.name);

    const ninSurname = normalize(ninData.last_name);
    const ninFirstName = normalize(ninData.first_name);
    const ninMiddleName = normalize(ninData.middle_name);
    const ninGender = normalize(ninData.gender);

    const matchedFields = [];
    const failedFields = [];

    // Compare surname
    if (userSurname && ninSurname) {
      if (userSurname === ninSurname || userName.includes(ninSurname) || ninSurname.includes(userName.split(' ')[0] || '')) {
        matchedFields.push('surname');
      } else {
        failedFields.push('surname');
      }
    }

    // Compare first name
    if (userFirstName && ninFirstName) {
      if (userFirstName === ninFirstName || ninFirstName.includes(userFirstName) || userFirstName.includes(ninFirstName)) {
        matchedFields.push('first_name');
      } else {
        failedFields.push('first_name');
      }
    }

    // Compare middle name (skip if either side is empty)
    if (userMiddleName && ninMiddleName) {
      if (userMiddleName === ninMiddleName || ninMiddleName.includes(userMiddleName) || userMiddleName.includes(ninMiddleName)) {
        matchedFields.push('middle_name');
      } else {
        failedFields.push('middle_name');
      }
    }

    // Compare gender (skip if either side is empty)
    const userGender = normalize(user.verified_gender || '');
    if (userGender && ninGender) {
      if (userGender === ninGender || ninGender.startsWith(userGender) || userGender.startsWith(ninGender)) {
        matchedFields.push('gender');
      }
    }

    // Decision: at least 2 name fields must match, OR surname + any other field
    let matched = false;
    let reason = '';

    const nameMatches = matchedFields.filter(f => ['surname', 'first_name', 'middle_name'].includes(f));

    if (nameMatches.length >= 2) {
      matched = true;
      reason = `Identity verified: ${nameMatches.join(' and ')} matched`;
    } else if (matchedFields.includes('surname') && matchedFields.length >= 2) {
      matched = true;
      reason = `Identity verified: surname and ${matchedFields.filter(f => f !== 'surname')[0]} matched`;
    } else if (matchedFields.length === 0) {
      matched = false;
      reason = 'Identity verification failed: no identity fields matched the information on your account';
    } else {
      matched = false;
      reason = `Identity verification failed: only ${matchedFields.join(', ')} matched, which is insufficient for verification`;
    }

    return {
      matched,
      reason,
      matchedFields,
      failedFields,
      confidence: nameMatches.length >= 2 ? 'high' : nameMatches.length === 1 ? 'medium' : 'low'
    };
  }

  /**
   * Verify NIN, match identity, save to DB, update user.
   * Called only after successful payment.
   * Prembly is called only once per user — caller must check kyc_status first.
   */
  static async verifyAndLink(userId, nin) {
    const ninData = await this.verifyNIN(nin);
    const matchResult = await this.matchIdentity(userId, ninData);

    const verificationId = Database.generateUUID();

    await Database.insert('kyc_verifications', {
      id: verificationId,
      user_id: userId,
      nin: this.encrypt(nin),
      nin_status: matchResult.matched ? 'verified' : 'failed',
      provider: 'prembly',
      verification_response: JSON.stringify({ ninData, matchResult, provider: 'prembly' }),
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
        verified_dob: ninData.date_of_birth || null,
        verified_gender: ninData.gender || null,
        verified_photo_url: ninData.photo_url || null,
        verification_badge_visible: true,
        caution_flag: false,
        updated_at: new Date()
      }, 'id = ?', [userId]);

      // Auto-verify user's unverified devices
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
      null, { match: matchResult, provider: 'prembly' });

    return {
      success: matchResult.matched,
      verificationId,
      match: matchResult,
      provider: 'prembly',
      message: matchResult.matched
        ? 'Identity verified successfully. All your devices are now verified.'
        : 'Identity verification failed. The information retrieved could not be sufficiently matched with your account details.'
    };
  }
}

module.exports = NINVerificationService;
