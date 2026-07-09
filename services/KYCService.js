const Database = require('../config');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const NINVerificationService = require('./NINVerificationService');

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.KYC_ENCRYPTION_KEY || 'vOVH6sdmpNWjRRIqCc7rdxs01lwBzfr3';
const IV_LENGTH = 16;

class KYCService {

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
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }

  static async lookupNIN(nin) {
    if (!nin || !/^\d{11}$/.test(nin)) {
      throw new Error('Invalid NIN format. Must be 11 digits.');
    }

    const ninData = await NINVerificationService.verifyNIN(nin);

    return {
      nin: nin,
      first_name: ninData.first_name,
      last_name: ninData.last_name,
      middle_name: ninData.middle_name,
      date_of_birth: ninData.date_of_birth,
      gender: ninData.gender,
      photo_url: ninData.photo_url,
      address: ninData.address,
      provider: ninData.provider
    };
  }

  static async initiateVerification(userId, nin, selfiePath) {
    try {
      console.log(`KYC: Initiating for user ${userId}`);

      const user = await Database.selectOne('users', 'kyc_status', 'id = ?', [userId]);
      if (user && user.kyc_status === 'verified') {
        throw new Error('User is already verified');
      }

      if (!/^\d{11}$/.test(nin)) {
        throw new Error('Invalid NIN format. Must be 11 digits.');
      }

        const verificationId = Database.generateUUID();
        const verificationData = {
          id: verificationId,
          user_id: userId,
          nin: nin,
        nin_status: 'pending',
        created_at: new Date()
      };

      await Database.insert('kyc_verifications', verificationData);

      await Database.update('users', {
        kyc_status: 'pending'
      }, 'id = ?', [userId]);

      this.processVerification(verificationId, userId, nin, selfiePath);

      return {
        success: true,
        verificationId,
        status: 'pending',
        message: 'Verification initiated. Please wait while we verify your identity.'
      };

    } catch (error) {
      console.error('KYC Initiation Error:', error);
      throw error;
    }
  }

  static async processVerification(verificationId, userId, nin, selfiePath) {
    console.log(`KYC Processing: ${verificationId}`);

    try {
      const ninLookup = await NINVerificationService.verifyNIN(nin);

      const faceMatchResult = await this.performFaceMatch(selfiePath, ninLookup.photo_url, ninLookup.provider);

      let newStatus = 'failed';
      let isVerified = false;

      if (faceMatchResult.score > 85 && faceMatchResult.liveness) {
        newStatus = 'verified';
        isVerified = true;
      } else if (faceMatchResult.score >= 60) {
        newStatus = 'pending';
        isVerified = false;
      }

      await Database.update('kyc_verifications', {
        nin_status: newStatus,
        face_match_score: faceMatchResult.score,
        liveness_passed: faceMatchResult.liveness,
        verification_response: JSON.stringify({ match: faceMatchResult, lookup: ninLookup }),
        verified_at: isVerified ? new Date() : null,
        updated_at: new Date()
      }, 'id = ?', [verificationId]);

      if (isVerified) {
        await Database.update('users', {
          kyc_status: 'verified',
          is_verified: true,
          verified_full_name: `${ninLookup.first_name} ${ninLookup.last_name}`,
          verified_dob: ninLookup.date_of_birth,
          verified_gender: ninLookup.gender,
          verified_photo_url: ninLookup.photo_url || null,
          verification_badge_visible: true,
          caution_flag: false,
          updated_at: new Date()
        }, 'id = ?', [userId]);

        await Database.logAudit(userId, 'KYC_VERIFIED', 'kyc_verifications', verificationId, null, { status: 'verified', provider: ninLookup.provider });
        console.log(`KYC Verified: User ${userId}`);

      } else if (newStatus === 'pending') {
        await Database.update('users', {
          kyc_status: 'pending',
          is_verified: false,
          updated_at: new Date()
        }, 'id = ?', [userId]);

        await Database.logAudit(userId, 'KYC_PENDING', 'kyc_verifications', verificationId, null, { status: 'pending', score: faceMatchResult.score });
        console.log(`KYC Pending Review: User ${userId}`);

      } else {
        await Database.update('users', {
          kyc_status: 'failed',
          is_verified: false,
          caution_flag: true,
          updated_at: new Date()
        }, 'id = ?', [userId]);

        await Database.logAudit(userId, 'KYC_FAILED', 'kyc_verifications', verificationId, null, { status: 'failed', reason: 'Face match failed' });
        console.log(`KYC Failed: User ${userId}`);
      }

    } catch (error) {
      console.error('KYC Processing Error:', error);
      await Database.update('kyc_verifications', { nin_status: 'failed', verification_response: JSON.stringify({ error: error.message }) }, 'id = ?', [verificationId]);
      await Database.update('users', { kyc_status: 'failed' }, 'id = ?', [userId]);
    }
  }

  static async performFaceMatch(selfiePath, ninPhotoUrl, provider) {
    if (provider === 'prembly' && process.env.PREMBLY_API_KEY && selfiePath && ninPhotoUrl) {
      try {
        return await this.premblyFaceComparison(selfiePath, ninPhotoUrl);
      } catch (error) {
        console.error('Prembly face comparison failed, falling back to basic check:', error.message);
      }
    }

    if (provider === 'prembly' && process.env.PREMBLY_API_KEY && selfiePath) {
      try {
        const livenessResult = await this.premblyLivenessCheck(selfiePath);
        if (livenessResult.liveness) {
          return { score: 90, liveness: true, method: 'prembly_liveness' };
        }
        return { score: 40, liveness: false, method: 'prembly_liveness_failed' };
      } catch (error) {
        console.error('Prembly liveness check failed:', error.message);
      }
    }

    if (!selfiePath) {
      return { score: 0, liveness: false, method: 'no_selfie' };
    }

    const fileExists = fs.existsSync(selfiePath);
    if (!fileExists) {
      return { score: 0, liveness: false, method: 'file_not_found' };
    }

    return { score: 75, liveness: true, method: 'file_based_basic' };
  }

  static async premblyFaceComparison(selfiePath, ninPhotoUrl) {
    const apiKey = process.env.PREMBLY_API_KEY;
    if (!apiKey) throw new Error('Prembly API key not configured');

    const selfieBuffer = fs.readFileSync(selfiePath);
    const selfieBase64 = selfieBuffer.toString('base64');

    let ninImageBase64 = ninPhotoUrl;
    if (ninPhotoUrl && ninPhotoUrl.startsWith('http')) {
      const imgResponse = await axios.get(ninPhotoUrl, { responseType: 'arraybuffer', timeout: 10000 });
      ninImageBase64 = Buffer.from(imgResponse.data).toString('base64');
    }

    const response = await axios.post(
      'https://api.prembly.com/biometrics/face-compare',
      {
        image1: selfieBase64,
        image2: ninImageBase64
      },
      {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const body = response.data;

    if (!body.status) {
      throw new Error(`Prembly face comparison failed: ${body.message || 'Unknown error'}`);
    }

    const data = body.data || body.detail || {};
    const score = data.score || data.similarity_score || data.percentage || 0;

    return {
      score: typeof score === 'number' ? score : parseFloat(score) || 0,
      liveness: true,
      method: 'prembly_face_compare'
    };
  }

  static async premblyLivenessCheck(selfiePath) {
    const apiKey = process.env.PREMBLY_API_KEY;
    if (!apiKey) throw new Error('Prembly API key not configured');

    const selfieBuffer = fs.readFileSync(selfiePath);
    const selfieBase64 = selfieBuffer.toString('base64');

    const response = await axios.post(
      'https://api.prembly.com/biometrics/face-liveliness',
      {
        image: selfieBase64
      },
      {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const body = response.data;

    if (!body.status) {
      throw new Error(`Prembly liveness check failed: ${body.message || 'Unknown error'}`);
    }

    const data = body.data || body.detail || {};

    return {
      liveness: data.is_live || data.liveness || false,
      score: data.score || data.confidence || 0,
      method: 'prembly_liveness'
    };
  }

  static async getVerificationStatus(userId) {
    const record = await Database.selectOne(
      'kyc_verifications',
      '*',
      'user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    return record;
  }
}

module.exports = KYCService;
