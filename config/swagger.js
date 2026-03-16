// Swagger/OpenAPI Configuration
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Check It - Device Registry API',
      version: '1.0.0',
      description: 'Smart Device Registry & Recovery System API',
      contact: {
        name: 'Check It Support',
        email: 'support@checkit.local'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.BASE_URL || 'http://localhost:3006',
        description: 'Development server'
      },
      {
        url: 'https://api.checkit.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'User unique identifier'
            },
            name: {
              type: 'string',
              description: 'User full name'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address'
            },
            role: {
              type: 'string',
              enum: ['user', 'business', 'admin', 'lea'],
              description: 'User role'
            },
            region: {
              type: 'string',
              description: 'User region (for LEA assignment)'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Account creation timestamp'
            }
          }
        },
        Device: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Device unique identifier'
            },
            user_id: {
              type: 'string',
              format: 'uuid',
              description: 'Owner user ID'
            },
            imei: {
              type: 'string',
              pattern: '^[0-9]{15}$',
              description: 'Device IMEI (15 digits)'
            },
            serial: {
              type: 'string',
              description: 'Device serial number'
            },
            brand: {
              type: 'string',
              description: 'Device brand/manufacturer'
            },
            model: {
              type: 'string',
              description: 'Device model'
            },
            color: {
              type: 'string',
              description: 'Device color'
            },
            proof_url: {
              type: 'string',
              format: 'uri',
              description: 'Proof of ownership document URL'
            },
            status: {
              type: 'string',
              enum: ['verified', 'unverified', 'stolen', 'lost', 'found', 'pending_transfer'],
              description: 'Device status'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Registration timestamp'
            }
          }
        },
        Report: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Report unique identifier'
            },
            device_id: {
              type: 'string',
              format: 'uuid',
              description: 'Related device ID'
            },
            report_type: {
              type: 'string',
              enum: ['stolen', 'lost', 'found'],
              description: 'Type of report'
            },
            case_id: {
              type: 'string',
              pattern: '^CASE-[0-9]{4}-[0-9]{6}$',
              description: 'System-generated case ID'
            },
            status: {
              type: 'string',
              enum: ['open', 'under_review', 'resolved', 'dismissed'],
              description: 'Report status'
            },
            description: {
              type: 'string',
              description: 'Report description'
            },
            location: {
              type: 'string',
              description: 'Incident location'
            },
            occurred_at: {
              type: 'string',
              format: 'date-time',
              description: 'When incident occurred'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Report creation timestamp'
            }
          }
        },
        PublicCheckResult: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['clean', 'stolen', 'lost', 'unverified', 'not_found'],
              description: 'Device status'
            },
            message: {
              type: 'string',
              description: 'Human-readable status message'
            },
            case_id: {
              type: 'string',
              description: 'Case ID if device is reported'
            },
            recovery_instructions: {
              type: 'string',
              description: 'Instructions if device is stolen/lost'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            },
            message: {
              type: 'string',
              description: 'Detailed error description'
            }
          }
        },
        CaptchaChallenge: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Challenge unique identifier'
            },
            question: {
              type: 'string',
              description: 'CAPTCHA question'
            },
            type: {
              type: 'string',
              enum: ['math', 'word'],
              description: 'Challenge type'
            },
            expiresAt: {
              type: 'number',
              description: 'Expiration timestamp'
            }
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        ForbiddenError: {
          description: 'Access denied',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        RateLimitError: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/Error' },
                  {
                    type: 'object',
                    properties: {
                      retryAfter: {
                        type: 'number',
                        description: 'Seconds to wait before retry'
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization'
      },
      {
        name: 'Public Check',
        description: 'Public device status checking'
      },
      {
        name: 'Device Management',
        description: 'Device registration and management'
      },
      {
        name: 'Report Management',
        description: 'Theft/loss/found reporting'
      },
      {
        name: 'Admin Portal',
        description: 'Administrative functions'
      },
      {
        name: 'LEA Portal',
        description: 'Law enforcement functions'
      },
      {
        name: 'Device Transfer',
        description: 'Ownership transfer system'
      },
      {
        name: 'Found Device',
        description: 'Found device reporting'
      },
      {
        name: 'File Management',
        description: 'File upload and management'
      },
      {
        name: 'CAPTCHA',
        description: 'CAPTCHA verification system'
      }
    ]
  },
  apis: [
    './routes/*.js', // Path to the API files
    './app.js'       // Main app file
  ]
};

const specs = swaggerJsdoc(options);

module.exports = specs;