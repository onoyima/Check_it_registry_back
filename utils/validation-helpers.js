// Simple validation helpers for profile management
const validator = require('validator');

const validateRequired = (value, fieldName) => {
  if (!value || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`${fieldName} is required`);
  }
};

const validateEmail = (email) => {
  if (!validator.isEmail(email)) {
    throw new Error('Invalid email format');
  }
};

const validateLength = (value, min, max, fieldName) => {
  if (value && typeof value === 'string') {
    if (min && value.length < min) {
      throw new Error(`${fieldName} must be at least ${min} characters`);
    }
    if (max && value.length > max) {
      throw new Error(`${fieldName} must be at most ${max} characters`);
    }
  }
};

const validatePassword = (password) => {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    throw new Error('Password must contain at least one lowercase letter, one uppercase letter, and one number');
  }
};

const validatePhone = (phone) => {
  if (phone && !/^\+?[\d\s\-\(\)]+$/.test(phone)) {
    throw new Error('Invalid phone number format');
  }
};

const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str.trim().replace(/[<>\"'&]/g, (match) => {
    const entities = {
      '<': '&lt;',
      '>': '&gt;',
      '\"': '&quot;',
      "'": '&#x27;',
      '&': '&amp;'
    };
    return entities[match];
  });
};

const sanitizeObject = (obj) => {
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'string' ? sanitizeString(item) : item
      );
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

const validateProfileUpdate = (data) => {
  const errors = [];
  
  try {
    validateRequired(data.name, 'Name');
    validateLength(data.name, 2, 100, 'Name');
  } catch (error) {
    errors.push(error.message);
  }
  
  if (data.phone) {
    try {
      validatePhone(data.phone);
    } catch (error) {
      errors.push(error.message);
    }
  }
  
  if (data.region) {
    try {
      validateLength(data.region, 0, 50, 'Region');
    } catch (error) {
      errors.push(error.message);
    }
  }
  
  if (errors.length > 0) {
    const error = new Error('Validation failed');
    error.details = errors;
    throw error;
  }
};

const validatePasswordChange = (data) => {
  const errors = [];
  
  try {
    validateRequired(data.currentPassword, 'Current password');
  } catch (error) {
    errors.push(error.message);
  }
  
  try {
    validateRequired(data.newPassword, 'New password');
    validatePassword(data.newPassword);
  } catch (error) {
    errors.push(error.message);
  }
  
  if (errors.length > 0) {
    const error = new Error('Validation failed');
    error.details = errors;
    throw error;
  }
};

const validateAccountDeletion = (data) => {
  const errors = [];
  
  try {
    validateRequired(data.password, 'Password');
  } catch (error) {
    errors.push(error.message);
  }
  
  if (data.confirmation !== 'DELETE_MY_ACCOUNT') {
    errors.push('Confirmation text must be exactly "DELETE_MY_ACCOUNT"');
  }
  
  if (errors.length > 0) {
    const error = new Error('Validation failed');
    error.details = errors;
    throw error;
  }
};

module.exports = {
  validateRequired,
  validateEmail,
  validateLength,
  validatePassword,
  validatePhone,
  sanitizeString,
  sanitizeObject,
  validateProfileUpdate,
  validatePasswordChange,
  validateAccountDeletion
};