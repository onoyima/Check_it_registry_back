// Device Category Service - Enhanced categorization and validation
const Database = require('../config');

class DeviceCategoryService {
  constructor() {
    this.categories = {
      mobile_phone: {
        name: 'Mobile Phone',
        requiredFields: ['imei', 'brand', 'model'],
        optionalFields: ['imei2', 'networkCarrier', 'operatingSystem', 'storageCapacity'],
        identifierFormat: /^\d{15}$/, // IMEI format
        validationRules: {
          imei: this.validateIMEI,
          imei2: this.validateIMEI
        }
      },
      computer: {
        name: 'Computer',
        requiredFields: ['serialNumber', 'brand', 'model'],
        optionalFields: ['macAddress', 'processorType', 'operatingSystem', 'ramSize'],
        identifierFormat: /^[A-Z0-9]{6,20}$/, // Serial number format
        validationRules: {
          macAddress: this.validateMACAddress,
          serialNumber: this.validateSerialNumber
        }
      },
      smart_watch: {
        name: 'Smart Watch',
        requiredFields: ['serialNumber', 'brand', 'model'],
        optionalFields: ['imei', 'bluetoothMac', 'operatingSystem', 'color'],
        identifierFormat: /^[A-Z0-9]{6,20}$/, // Serial number format
        validationRules: {
          serialNumber: this.validateSerialNumber,
          imei: this.validateIMEI
        }
      },
      vehicle: {
        name: 'Vehicle',
        requiredFields: ['vin', 'brand', 'model'],
        optionalFields: ['engineNumber', 'registrationState', 'color'],
        identifierFormat: /^[A-HJ-NPR-Z0-9]{17}$/, // VIN format
        validationRules: {
          vin: this.validateVIN,
          year: this.validateYear,
          licensePlate: this.validateLicensePlate
        }
      },
      electronics: {
        name: 'Electronics',
        requiredFields: ['serialNumber', 'brand', 'model'],
        optionalFields: ['modelNumber', 'manufactureDate', 'warranty'],
        identifierFormat: /^[A-Z0-9]{4,30}$/, // Generic serial format
        validationRules: {
          serialNumber: this.validateSerialNumber
        }
      },
      jewelry: {
        name: 'Jewelry',
        requiredFields: ['description', 'material', 'estimatedValue'],
        optionalFields: ['certificateNumber', 'appraisalDate', 'insurance'],
        identifierFormat: /^[A-Z0-9]{4,20}$/, // Certificate or ID format
        validationRules: {
          estimatedValue: this.validateCurrency,
          certificateNumber: this.validateCertificate
        }
      },
      others: {
        name: 'Others',
        requiredFields: ['description', 'brand', 'model'],
        optionalFields: ['serialNumber', 'modelNumber', 'estimatedValue'],
        identifierFormat: /^.{3,50}$/, // Flexible format
        validationRules: {
          estimatedValue: this.validateCurrency
        }
      }
    };
  }

  // Get category configuration
  getCategoryConfig(category) {
    return this.categories[category] || null;
  }

  // Get all categories
  getAllCategories() {
    return Object.keys(this.categories).map(key => ({
      value: key,
      name: this.categories[key].name,
      requiredFields: this.categories[key].requiredFields,
      optionalFields: this.categories[key].optionalFields
    }));
  }

  // Validate device data based on category
  validateDeviceData(category, deviceData) {
    const config = this.getCategoryConfig(category);
    if (!config) {
      return { valid: false, errors: ['Invalid device category'] };
    }

    const errors = [];

    // Check required fields
    for (const field of config.requiredFields) {
      if (!deviceData[field] || deviceData[field].toString().trim() === '') {
        errors.push(`${field} is required for ${config.name}`);
      }
    }

    // Validate field formats and rules
    for (const [field, value] of Object.entries(deviceData)) {
      if (value && config.validationRules[field]) {
        const validationResult = config.validationRules[field](value);
        if (!validationResult.valid) {
          errors.push(validationResult.error);
        }
      }
    }

    // Validate primary identifier format
    const primaryIdentifier = this.getPrimaryIdentifier(category, deviceData);
    if (!primaryIdentifier || primaryIdentifier.toString().trim() === '') {
      errors.push(`${this.getPrimaryIdentifierName(category)} is required`);
    }
    if (primaryIdentifier && !config.identifierFormat.test(primaryIdentifier)) {
      errors.push(`Invalid ${this.getPrimaryIdentifierName(category)} format`);
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  // Get primary identifier for category
  getPrimaryIdentifier(category, deviceData) {
    switch (category) {
      case 'mobile_phone':
        return deviceData.imei;
      case 'computer':
      case 'electronics':
        return deviceData.serialNumber;
      case 'smart_watch':
        return deviceData.serialNumber || deviceData.imei;
      case 'vehicle':
        return deviceData.vin;
      case 'jewelry':
        return deviceData.certificateNumber || deviceData.description;
      case 'others':
        return deviceData.serialNumber || deviceData.description;
      default:
        return null;
    }
  }

  // Get primary identifier name for category
  getPrimaryIdentifierName(category) {
    switch (category) {
      case 'mobile_phone':
        return 'IMEI';
      case 'computer':
      case 'electronics':
      case 'smart_watch':
        return 'Serial Number';
      case 'vehicle':
        return 'VIN';
      case 'jewelry':
        return 'Certificate Number';
      case 'others':
        return 'Identifier';
      default:
        return 'Identifier';
    }
  }

  // Validation functions
  validateIMEI(imei) {
    if (!/^\d{15}$/.test(imei)) {
      return { valid: false, error: 'IMEI must be exactly 15 digits' };
    }

    // Luhn algorithm check for IMEI
    const digits = imei.split('').map(Number);
    let sum = 0;
    
    for (let i = 0; i < 14; i++) {
      let digit = digits[i];
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    
    const checkDigit = (10 - (sum % 10)) % 10;
    if (checkDigit !== digits[14]) {
      return { valid: false, error: 'Invalid IMEI checksum' };
    }

    return { valid: true };
  }

  validateMACAddress(mac) {
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    if (!macRegex.test(mac)) {
      return { valid: false, error: 'Invalid MAC address format' };
    }
    return { valid: true };
  }

  validateVIN(vin) {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
      return { valid: false, error: 'VIN must be 17 characters (excluding I, O, Q)' };
    }

    // VIN check digit validation (simplified)
    const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    const values = {
      'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8,
      'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'P': 7, 'R': 9, 'S': 2,
      'T': 3, 'U': 4, 'V': 5, 'W': 6, 'X': 7, 'Y': 8, 'Z': 9,
      '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9
    };

    let sum = 0;
    for (let i = 0; i < 17; i++) {
      if (i !== 8) { // Skip check digit position
        sum += (values[vin[i]] || 0) * weights[i];
      }
    }

    const checkDigit = sum % 11;
    const expectedCheck = checkDigit === 10 ? 'X' : checkDigit.toString();
    
    if (vin[8] !== expectedCheck) {
      return { valid: false, error: 'Invalid VIN check digit' };
    }

    return { valid: true };
  }

  validateSerialNumber(serial) {
    if (!serial || serial.length < 3 || serial.length > 30) {
      return { valid: false, error: 'Serial number must be 3-30 characters' };
    }
    return { valid: true };
  }

  validateYear(year) {
    const currentYear = new Date().getFullYear();
    const yearNum = parseInt(year);
    
    if (isNaN(yearNum) || yearNum < 1900 || yearNum > currentYear + 1) {
      return { valid: false, error: `Year must be between 1900 and ${currentYear + 1}` };
    }
    return { valid: true };
  }

  validateLicensePlate(plate) {
    if (!plate || plate.length < 2 || plate.length > 10) {
      return { valid: false, error: 'License plate must be 2-10 characters' };
    }
    return { valid: true };
  }

  validateCurrency(amount) {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 0) {
      return { valid: false, error: 'Amount must be a positive number' };
    }
    return { valid: true };
  }

  validateCertificate(cert) {
    if (!cert || cert.length < 4 || cert.length > 20) {
      return { valid: false, error: 'Certificate number must be 4-20 characters' };
    }
    return { valid: true };
  }

  // Format category data for storage
  formatCategoryData(category, deviceData) {
    const config = this.getCategoryConfig(category);
    if (!config) return {};

    const categoryData = {};
    const allFields = [...config.requiredFields, ...config.optionalFields];

    for (const field of allFields) {
      if (deviceData[field] !== undefined && deviceData[field] !== null && deviceData[field] !== '') {
        categoryData[field] = deviceData[field];
      }
    }

    return categoryData;
  }

  // Get secondary identifiers for category
  getSecondaryIdentifiers(category, deviceData) {
    const secondaryIds = {};

    switch (category) {
      case 'mobile_phone':
        if (deviceData.imei2) secondaryIds.imei2 = deviceData.imei2;
        if (deviceData.networkCarrier) secondaryIds.networkCarrier = deviceData.networkCarrier;
        break;
      case 'computer':
        if (deviceData.macAddress) secondaryIds.macAddress = deviceData.macAddress;
        break;
      case 'smart_watch':
        if (deviceData.imei) secondaryIds.imei = deviceData.imei;
        if (deviceData.bluetoothMac) secondaryIds.bluetoothMac = deviceData.bluetoothMac;
        break;
      case 'vehicle':
        if (deviceData.licensePlate) secondaryIds.licensePlate = deviceData.licensePlate;
        if (deviceData.engineNumber) secondaryIds.engineNumber = deviceData.engineNumber;
        break;
      case 'jewelry':
        if (deviceData.certificateNumber) secondaryIds.certificateNumber = deviceData.certificateNumber;
        break;
    }

    return secondaryIds;
  }

  // Search devices by category and identifiers
  async searchDevicesByCategory(category, searchTerm) {
    try {
      const config = this.getCategoryConfig(category);
      if (!config) {
        throw new Error('Invalid category');
      }

      // Search in primary identifier, secondary identifiers, and category data
      const devices = await Database.query(`
        SELECT d.*, u.name as owner_name, u.email as owner_email
        FROM devices d
        JOIN users u ON d.user_id = u.id
        WHERE d.category = ?
        AND (
          d.imei LIKE ? OR 
          d.serial LIKE ? OR
          JSON_UNQUOTE(JSON_EXTRACT(d.secondary_identifiers, '$.*')) LIKE ? OR
          JSON_UNQUOTE(JSON_EXTRACT(d.category_data, '$.*')) LIKE ?
        )
        ORDER BY d.created_at DESC
      `, [category, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`]);

      return devices;
    } catch (error) {
      console.error('Category search error:', error);
      throw error;
    }
  }

  // Get category statistics
  async getCategoryStatistics() {
    try {
      const stats = await Database.query(`
        SELECT 
          category,
          COUNT(*) as total_devices,
          SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified_devices,
          SUM(CASE WHEN status = 'stolen' THEN 1 ELSE 0 END) as stolen_devices,
          SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_devices
        FROM devices
        GROUP BY category
        ORDER BY total_devices DESC
      `);

      return stats.map(stat => ({
        ...stat,
        category_name: this.categories[stat.category]?.name || stat.category
      }));
    } catch (error) {
      console.error('Category statistics error:', error);
      throw error;
    }
  }
}

module.exports = new DeviceCategoryService();