const Database = require('../config');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Constants for encryption
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.KYC_ENCRYPTION_KEY || 'vOVH6sdmpNWjRRIqCc7rdxs01lwBzfr3'; // Fallback for dev - MUST BE 32 CHARS
const IV_LENGTH = 16;

class KYCService {

  /**
   * Encrypts the NIN before storage
   * @param {string} text 
   * @returns {string} iv:encryptedText
   */
  static encrypt(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  /**
   * Decrypts the NIN for processing
   * @param {string} text 
   * @returns {string} decryptedText
   */
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

  /**
   * Initiates the KYC verification process
   * @param {string} userId 
   * @param {string} nin 
   * @param {string} selfiePath 
   */
  // Simulate fetching NIN details from external provider without full verification
  static async lookupNIN(nin) {
    if (!nin || nin.length !== 11) {
      throw new Error('Invalid NIN format');
    }

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Mock response based on NIN
    const isValid = nin.startsWith('1') || nin.startsWith('2');
    
    if (!isValid) {
      throw new Error('NIN not found in national database');
    }

    // Return mocked data
    return {
      nin: nin,
      first_name: 'John',
      last_name: 'Doe',
      middle_name: 'K',
      date_of_birth: '1990-01-01',
      gender: 'M',
      photo_url: 'https://ui-avatars.com/api/?name=John+Doe&background=random&size=200', // Mock photo
      address: '123 Lagos Street, Ikeja, Lagos'
    };
  }

  static async initiateVerification(userId, nin, selfiePath) {
    try {
      console.log(`🔐 KYC: Initiating for user ${userId}`);

      // 1. Check if user already verified
      const user = await Database.selectOne('users', 'kyc_status', 'id = ?', [userId]);
      if (user && user.kyc_status === 'verified') {
        throw new Error('User is already verified');
      }

      // 2. Validate NIN format (Simplistic check for 11 digits)
      if (!/^\d{11}$/.test(nin)) {
        throw new Error('Invalid NIN format. Must be 11 digits.');
      }

      // 3. Encrypt NIN
      const encryptedNIN = this.encrypt(nin);

      // 4. Create Verification Record
      const verificationId = Database.generateUUID();
      const verificationData = {
        id: verificationId,
        user_id: userId,
        nin: encryptedNIN,
        nin_status: 'pending',
        created_at: new Date()
      };

      await Database.insert('kyc_verifications', verificationData);

      // 5. Update User Status to Pending
      await Database.update('users', {
        kyc_status: 'pending'
      }, 'id = ?', [userId]);

      // 6. Process immediately (or add to queue in a real batch system)
      // We will simulate async processing here
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

  /**
   * Processes a single verification (Simulates External API)
   * @param {string} verificationId 
   * @param {string} userId 
   * @param {string} nin 
   * @param {string} selfiePath 
   */
  static async processVerification(verificationId, userId, nin, selfiePath) {
    console.log(`⚙️ KYC Processing: ${verificationId}`);
    
    // Simulate delay
    setTimeout(async () => {
      try {
        // --- MOCK EXTERNAL API CALL START ---
        // In production, call SmileID / Dojah / verify.ng here
        const ninLookup = await this.mockExternalNINLookup(nin);
        const faceMatchResult = await this.mockFaceMatch(selfiePath, ninLookup.photo_url);
        // --- MOCK EXTERNAL API CALL END ---

        // Logic:
        // If score > 85 => Auto Verify
        // If score >= 60 && score <= 85 => Pending (Manual Review)
        // If score < 60 => Failed
        
        let newStatus = 'failed';
        let isVerified = false;

        if (faceMatchResult.score > 85 && faceMatchResult.liveness) {
          newStatus = 'verified';
          isVerified = true;
        } else if (faceMatchResult.score >= 60) {
          newStatus = 'pending'; // Manual review required
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

        // Update User Profile based on result
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

          // Log Audit
          await Database.logAudit(userId, 'KYC_VERIFIED', 'kyc_verifications', verificationId, null, { status: 'verified' });
          console.log(`✅ KYC Verified: User ${userId}`);

        } else if (newStatus === 'pending') {
          // Keep user status as pending for admin review
          await Database.update('users', {
            kyc_status: 'pending',
            is_verified: false,
            updated_at: new Date()
          }, 'id = ?', [userId]);
          
          await Database.logAudit(userId, 'KYC_PENDING', 'kyc_verifications', verificationId, null, { status: 'pending', score: faceMatchResult.score });
           console.log(`⏳ KYC Pending Review: User ${userId}`);

        } else {
          // Failed
          await Database.update('users', {
            kyc_status: 'failed',
            is_verified: false,
            caution_flag: true,
            updated_at: new Date()
          }, 'id = ?', [userId]);
          
          await Database.logAudit(userId, 'KYC_FAILED', 'kyc_verifications', verificationId, null, { status: 'failed', reason: 'Face match failed' });
          console.log(`❌ KYC Failed: User ${userId}`);
        }

      } catch (error) {
        console.error('KYC Processing Error:', error);
        await Database.update('kyc_verifications', { nin_status: 'failed' }, 'id = ?', [verificationId]);
        await Database.update('users', { kyc_status: 'failed' }, 'id = ?', [userId]);
      }
    }, 5000); // 5 second simulation delay
  }

  // --- MOCK HELPERS ---

  static async mockExternalNINLookup(nin) {
    // Deterministic mock based on NIN content
    const isValid = nin.startsWith('1') || nin.startsWith('2'); // Valid if starts with 1 or 2
    if (!isValid) throw new Error('NIN not found in database');

    return {
      first_name: 'Verified',
      last_name: 'User',
      middle_name: 'Mock',
      date_of_birth: '1990-01-01',
      gender: 'M',
      photo_url: 'https://ui-avatars.com/api/?name=Verified+User&background=random&size=200',
      address: '123 Verified Lane',
      nin: nin
    };
  }

  static async mockFaceMatch(selfiePath, ninPhotoUrl) {
    // In a real scenario, compare the images
    // Mock: Always return high score for now
    return {
      score: 92.5,
      liveness: true
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
