const Database = require('../config');
const crypto = require('crypto');

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
    const providerService = this.getProviderService(provider);
    return providerService.verify(nin);
  }

  static getProviderService(provider) {
    switch (provider) {
      case 'prembly':
        return new PremblyProvider();
      case 'dojah':
        return new DojahProvider();
      case 'verifyng':
        return new VerifyNGProvider();
      case 'smileid':
        return new SmileIDProvider();
      default:
        return new PremblyProvider();
    }
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
    const encryptedNIN = this.encrypt(nin);

    await Database.insert('kyc_verifications', {
      id: verificationId,
      user_id: userId,
      nin: encryptedNIN,
      nin_status: matchResult.matched ? 'verified' : 'failed',
      verification_response: JSON.stringify({ ninData, matchResult, provider: await this.getProvider() }),
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
      null, { match: matchResult, provider: await this.getProvider() });

    return {
      success: matchResult.matched,
      verificationId,
      match: matchResult,
      message: matchResult.matched
        ? 'Identity verified successfully. All your devices are now verified.'
        : 'NIN found but name does not match your account. Please contact support.'
    };
  }
}

class PremblyProvider {
  async verify(nin) {
    await new Promise(r => setTimeout(r, 2000));
    const isValid = nin.startsWith('1') || nin.startsWith('2');
    if (!isValid) throw new Error('NIN not found in national database');

    return {
      provider: 'prembly',
      nin,
      first_name: 'John',
      last_name: 'Doe',
      middle_name: 'K',
      date_of_birth: '1990-01-01',
      gender: 'M',
      photo_url: 'https://ui-avatars.com/api/?name=John+Doe&background=random&size=200',
      address: '123 Sample Street',
      verified: true
    };
  }
}

class DojahProvider {
  async verify(nin) {
    await new Promise(r => setTimeout(r, 1500));
    const isValid = nin.startsWith('1') || nin.startsWith('2');
    if (!isValid) throw new Error('NIN verification failed via Dojah');
    return {
      provider: 'dojah', nin,
      first_name: 'Jane', last_name: 'Smith',
      date_of_birth: '1988-05-15', gender: 'F',
      photo_url: null, address: '456 Test Avenue',
      verified: true
    };
  }
}

class VerifyNGProvider {
  async verify(nin) {
    await new Promise(r => setTimeout(r, 1000));
    const isValid = nin.startsWith('1') || nin.startsWith('2');
    if (!isValid) throw new Error('NIN not found via Verify.ng');
    return {
      provider: 'verifyng', nin,
      first_name: 'Alice', last_name: 'Johnson',
      date_of_birth: '1992-11-20', gender: 'F',
      photo_url: null, address: '789 Sample Road',
      verified: true
    };
  }
}

class SmileIDProvider {
  async verify(nin) {
    await new Promise(r => setTimeout(r, 2500));
    const isValid = nin.startsWith('1') || nin.startsWith('2');
    if (!isValid) throw new Error('NIN verification failed via SmileID');
    return {
      provider: 'smileid', nin,
      first_name: 'Bob', last_name: 'Williams',
      date_of_birth: '1985-03-10', gender: 'M',
      photo_url: null, address: '321 Test Blvd',
      verified: true
    };
  }
}

module.exports = NINVerificationService;
