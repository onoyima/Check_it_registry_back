const Database = require('../config');
const axios = require('axios');
const {
  BASE_URL,
  pick,
  isSuccess,
  firstRecord,
  normalizeDate,
  assertProductionReady,
  errorDetail
} = require('./PremblyUtils');

class CACVerificationService {
  static async getProvider() {
    const row = await Database.selectOne('system_settings', 'setting_value',
      "setting_key = 'cac_verification_provider'");
    return row?.setting_value || 'prembly';
  }

  static async verifyRCNumber(rcNumber, companyName, companyType) {
    if (!rcNumber) throw new Error('RC Number is required');

    const provider = await this.getProvider();
    const providers = this.getProviderChain(provider);

    let lastError = null;
    for (const providerInstance of providers) {
      try {
        console.log(`CAC Verification: Trying provider ${providerInstance.name}`);
        const result = await providerInstance.verify(rcNumber, companyName, companyType);
        console.log(`CAC Verification: Success via ${providerInstance.name}`);
        return result;
      } catch (error) {
        console.error(`CAC Verification: ${providerInstance.name} failed - ${error.message}`);
        lastError = error;
        continue;
      }
    }

    throw lastError || new Error('All CAC verification providers failed');
  }

  static getProviderChain(preferredProvider) {
    const allProviders = [
      new PremblyCACProvider(),
      new PremblyCACAdvanceProvider()
    ];

    const preferred = allProviders.find(p => p.name === preferredProvider);
    const others = allProviders.filter(p => p.name !== preferredProvider);

    if (preferred) {
      return [preferred, ...others];
    }
    return allProviders;
  }

  static async verifyAndLink(userId, rcNumber, businessName, companyType) {
    const cacData = await this.verifyRCNumber(rcNumber, businessName, companyType);

    const verificationId = Database.generateUUID();
    await Database.insert('kyc_verifications', {
      id: verificationId,
      user_id: userId,
      nin_status: 'verified',
      verification_type: 'cac',
      verification_response: JSON.stringify(cacData),
      verified_at: new Date(),
      created_at: new Date()
    });

    await Database.update('users', {
      kyc_status: 'verified',
      is_verified: true,
      verified_full_name: cacData.company_name,
      role: 'business',
      verification_badge_visible: true,
      caution_flag: false,
      updated_at: new Date()
    }, 'id = ?', [userId]);

    await Database.logAudit(userId, 'CAC_VERIFIED', 'kyc_verifications', verificationId,
      null, { rc_number: rcNumber, company: cacData.company_name, provider: cacData.provider });

    return {
      success: true,
      verificationId,
      provider: cacData.provider,
      company: cacData.company_name,
      registration_date: cacData.registration_date,
      status: cacData.status,
      directors: cacData.directors,
      message: 'Business verified successfully via CAC.'
    };
  }

  static async getCommissionSettings() {
    const settings = {};
    const keys = ['marketplace_commission_percent', 'business_verification_fee'];
    const RevenueService = require('./RevenueService');
    for (const key of keys) {
      // null = not set by the admin yet
      settings[key] = await RevenueService.getFee(key).catch(() => null);
    }
    return settings;
  }
}

class PremblyCACProvider {
  constructor() {
    this.name = 'prembly';
    this.baseURL = BASE_URL;
    this.apiKey = process.env.PREMBLY_API_KEY || '';
  }

  async verify(rcNumber, companyName, companyType) {
    if (!this.apiKey) {
      throw new Error('Prembly API key not configured (PREMBLY_API_KEY)');
    }

    const body = {
      rc_number: rcNumber,
      company_type: companyType || 'RC'
    };

    if (companyName) {
      body.company_name = companyName;
    }

    const response = await axios.post(
      `${this.baseURL}/verification/cac`,
      body,
      {
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const res = response.data;

    if (!isSuccess(res)) {
      throw new Error(`Prembly CAC failed: ${errorDetail(res, 'CAC verification failed')}`);
    }

    assertProductionReady(res);

    const data = firstRecord(res.data || res.detail);

    return {
      provider: 'prembly',
      rc_number: pick(data.rc_number, rcNumber),
      company_name: pick(data.company_name, data.companyName, data.name),
      registration_date: normalizeDate(pick(data.registrationDate, data.registration_date, data.date_registered, data.DateRegistered)),
      status: pick(data.company_status, data.status, data.Status, 'unknown'),
      address: pick(data.company_address, data.registered_address, data.address, data.branchAddress, data.Address),
      business_type: pick(data.entity_type, data.company_type, data.type, companyType, 'RC'),
      directors: this.extractDirectors(data),
      verified: true
    };
  }

  extractDirectors(data) {
    const directors = data.directors || data.Directors || data.company_directors || [];
    if (!Array.isArray(directors)) return [];
    return directors.map(d => {
      if (typeof d === 'string') return { name: d, role: 'Director' };
      const nameParts = [d.firstname, d.surname, d.otherName]
        .map(part => String(part || '').trim().replace(/\s+/g, ' '))
        .filter(part => part && part.toUpperCase() !== 'N/A');
      return {
        name: d.name || d.director_name || d.full_name || d.fullName || d.corporationName || nameParts.join(' '),
        role: d.affiliateTypeFk?.name || d.role || d.position || 'Director'
      };
    });
  }
}

class PremblyCACAdvanceProvider {
  constructor() {
    this.name = 'prembly_advance';
    this.baseURL = BASE_URL;
    this.apiKey = process.env.PREMBLY_API_KEY || '';
  }

  async verify(rcNumber, companyName, companyType) {
    if (!this.apiKey) {
      throw new Error('Prembly API key not configured (PREMBLY_API_KEY)');
    }

    const body = {
      rc_number: rcNumber,
      company_type: companyType || 'RC'
    };

    if (companyName) {
      body.company_name = companyName;
    }

    const response = await axios.post(
      `${this.baseURL}/verification/cac_advance`,
      body,
      {
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const res = response.data;

    if (!isSuccess(res)) {
      throw new Error(`Prembly CAC Advance failed: ${errorDetail(res, 'CAC advance verification failed')}`);
    }

    assertProductionReady(res);

    const data = firstRecord(res.data || res.detail);

    return {
      provider: 'prembly_advance',
      rc_number: pick(data.rc_number, rcNumber),
      company_name: pick(data.company_name, data.companyName, data.name),
      registration_date: normalizeDate(pick(data.registrationDate, data.registration_date, data.date_registered, data.DateRegistered)),
      status: pick(data.company_status, data.status, data.Status, 'unknown'),
      address: pick(data.company_address, data.registered_address, data.address, data.branchAddress, data.Address),
      business_type: pick(data.entity_type, data.company_type, data.type, companyType, 'RC'),
      directors: this.extractDirectors(data),
      verified: true
    };
  }

  extractDirectors(data) {
    const directors = data.directors || data.Directors || data.company_directors || [];
    if (!Array.isArray(directors)) return [];
    return directors.map(d => {
      if (typeof d === 'string') return { name: d, role: 'Director' };
      const nameParts = [d.firstname, d.surname, d.otherName]
        .map(part => String(part || '').trim().replace(/\s+/g, ' '))
        .filter(part => part && part.toUpperCase() !== 'N/A');
      return {
        name: d.name || d.director_name || d.full_name || d.fullName || d.corporationName || nameParts.join(' '),
        role: d.affiliateTypeFk?.name || d.role || d.position || 'Director'
      };
    });
  }
}

module.exports = CACVerificationService;
