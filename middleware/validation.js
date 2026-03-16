const validator = require('validator');
const { body, param, query, validationResult } = require('express-validator');

// Custom validation middleware
const validateInput = (field, options = {}) => {
  let validation = body(field);

  // Required validation
  if (options.required) {
    validation = validation.notEmpty().withMessage(`${field} is required`);
  }

  // Type validation
  if (options.type === 'email') {
    validation = validation.isEmail().withMessage(`${field} must be a valid email`);
  } else if (options.type === 'number') {
    validation = validation.isNumeric().withMessage(`${field} must be a number`);
    if (options.min !== undefined) {
      validation = validation.isFloat({ min: options.min }).withMessage(`${field} must be at least ${options.min}`);
    }
    if (options.max !== undefined) {
      validation = validation.isFloat({ max: options.max }).withMessage(`${field} must be at most ${options.max}`);
    }
  } else if (options.type === 'boolean') {
    validation = validation.isBoolean().withMessage(`${field} must be a boolean`);
  } else if (options.type === 'array') {
    validation = validation.isArray().withMessage(`${field} must be an array`);
  } else if (options.type === 'uuid') {
    validation = validation.isUUID().withMessage(`${field} must be a valid UUID`);
  }

  // Length validation
  if (options.minLength) {
    validation = validation.isLength({ min: options.minLength }).withMessage(`${field} must be at least ${options.minLength} characters`);
  }
  if (options.maxLength) {
    validation = validation.isLength({ max: options.maxLength }).withMessage(`${field} must be at most ${options.maxLength} characters`);
  }

  // Pattern validation
  if (options.pattern) {
    validation = validation.matches(options.pattern).withMessage(`${field} format is invalid`);
  }

  // Enum validation
  if (options.enum) {
    validation = validation.isIn(options.enum).withMessage(`${field} must be one of: ${options.enum.join(', ')}`);
  }

  // Exact match validation
  if (options.exact) {
    validation = validation.equals(options.exact).withMessage(`${field} must be exactly "${options.exact}"`);
  }

  // Custom validation
  if (options.custom) {
    validation = validation.custom(options.custom);
  }

  return validation;
};

// Sanitization functions
const sanitizeInput = (data) => {
  const sanitized = {};
  
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      // Basic HTML sanitization
      sanitized[key] = validator.escape(value.trim());
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'string' ? validator.escape(item.trim()) : item
      );
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
};

// Validation result handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.param,
      message: error.msg,
      value: error.value
    }));

    return res.status(400).json({
      error: 'Validation failed',
      details: formattedErrors
    });
  }
  
  next();
};

// Common validation chains
const commonValidations = {
  // User validation
  userRegistration: [
    validateInput('name', { required: true, minLength: 2, maxLength: 100 }),
    validateInput('email', { required: true, type: 'email' }),
    validateInput('password', { 
      required: true, 
      minLength: 8, 
      pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/ 
    }),
    validateInput('role', { enum: ['user', 'business', 'lea'] }),
    validateInput('region', { maxLength: 50 }),
    handleValidationErrors
  ],

  userLogin: [
    validateInput('email', { required: true, type: 'email' }),
    validateInput('password', { required: true, minLength: 6 }),
    handleValidationErrors
  ],

  // Device validation
  deviceRegistration: [
    validateInput('brand', { required: true, minLength: 2, maxLength: 50 }),
    validateInput('model', { required: true, minLength: 1, maxLength: 100 }),
    validateInput('color', { maxLength: 30 }),
    validateInput('imei', { 
      pattern: /^\d{15}$/, 
      custom: (value) => {
        if (value && !validator.isNumeric(value)) {
          throw new Error('IMEI must contain only numbers');
        }
        return true;
      }
    }),
    validateInput('serial_number', { maxLength: 50 }),
    validateInput('purchase_date', { type: 'date' }),
    validateInput('purchase_price', { type: 'number', min: 0 }),
    handleValidationErrors
  ],

  // Report validation
  reportCreation: [
    validateInput('device_id', { required: true, type: 'uuid' }),
    validateInput('report_type', { required: true, enum: ['theft', 'loss'] }),
    validateInput('occurred_at', { required: true }),
    validateInput('location', { required: true, minLength: 3, maxLength: 200 }),
    validateInput('description', { required: true, minLength: 10, maxLength: 2000 }),
    validateInput('police_report_number', { maxLength: 100 }),
    validateInput('circumstances', { maxLength: 2000 }),
    validateInput('witness_info', { maxLength: 1000 }),
    validateInput('recovery_instructions', { maxLength: 1000 }),
    handleValidationErrors
  ],

  // ID parameter validation
  validateId: [
    param('id').isUUID().withMessage('Invalid ID format'),
    handleValidationErrors
  ],

  // Pagination validation
  validatePagination: [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors
  ],

  // Search validation
  validateSearch: [
    query('search').optional().isLength({ min: 2, max: 100 }).withMessage('Search term must be 2-100 characters'),
    query('sort_by').optional().isIn(['created_at', 'updated_at', 'name', 'email', 'status']).withMessage('Invalid sort field'),
    query('sort_order').optional().isIn(['ASC', 'DESC']).withMessage('Sort order must be ASC or DESC'),
    handleValidationErrors
  ]
};

// File upload validation
const validateFileUpload = (options = {}) => {
  return (req, res, next) => {
    if (!req.file && options.required) {
      return res.status(400).json({ error: 'File is required' });
    }

    if (req.file) {
      // Check file size
      const maxSize = options.maxSize || 5 * 1024 * 1024; // 5MB default
      if (req.file.size > maxSize) {
        return res.status(400).json({ 
          error: `File size too large. Maximum size is ${maxSize / 1024 / 1024}MB` 
        });
      }

      // Check file type
      const allowedTypes = options.allowedTypes || ['image/jpeg', 'image/png', 'image/gif'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({ 
          error: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}` 
        });
      }

      // Check filename
      if (req.file.originalname.length > 255) {
        return res.status(400).json({ error: 'Filename too long' });
      }

      // Sanitize filename
      req.file.sanitizedName = req.file.originalname
        .replace(/[^a-zA-Z0-9.-]/g, '_')
        .toLowerCase();
    }

    next();
  };
};

// Rate limiting validation
const validateRateLimit = (windowMs = 15 * 60 * 1000, max = 100) => {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip + (req.user?.id || '');
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    for (const [k, timestamps] of requests.entries()) {
      requests.set(k, timestamps.filter(t => t > windowStart));
      if (requests.get(k).length === 0) {
        requests.delete(k);
      }
    }

    // Check current requests
    const userRequests = requests.get(key) || [];
    if (userRequests.length >= max) {
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil(windowMs / 1000 / 60)} minutes.`,
        retryAfter: Math.ceil((userRequests[0] + windowMs - now) / 1000)
      });
    }

    // Add current request
    userRequests.push(now);
    requests.set(key, userRequests);

    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': max,
      'X-RateLimit-Remaining': max - userRequests.length,
      'X-RateLimit-Reset': new Date(now + windowMs).toISOString()
    });

    next();
  };
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
  });
  next();
};

// Input sanitization middleware
const sanitizeBody = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeInput(req.body);
  }
  next();
};

// Custom error handler for validation
const validationErrorHandler = (error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Invalid JSON format',
      message: 'Request body contains invalid JSON'
    });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Request too large',
      message: 'Request body exceeds maximum size limit'
    });
  }

  next(error);
};

module.exports = {
  validateInput,
  sanitizeInput,
  handleValidationErrors,
  commonValidations,
  validateFileUpload,
  validateRateLimit,
  securityHeaders,
  sanitizeBody,
  validationErrorHandler
};