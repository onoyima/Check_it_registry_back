# Check It Device Registry - Backend Documentation

## Overview

The Check It Device Registry backend is a comprehensive Node.js/Express.js application with MySQL database that provides secure device registration, theft reporting, and recovery services. This documentation covers all the enhanced backend features and APIs.

## Architecture

### Technology Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MySQL 8.0+
- **Authentication**: JWT tokens
- **Validation**: express-validator
- **File Upload**: multer
- **Email**: nodemailer
- **SMS**: Twilio
- **Push Notifications**: web-push
- **Testing**: Jest + Supertest

### Project Structure
```
server/
├── app.js                 # Main application file
├── config.js             # Database configuration
├── index.js              # Server entry point
├── middleware/           # Custom middleware
│   ├── auth.js          # Authentication middleware
│   └── validation.js    # Input validation middleware
├── routes/              # API route handlers
│   ├── auth.js          # Authentication routes
│   ├── device-management.js
│   ├── profile-management.js
│   ├── settings-management.js
│   ├── admin-dashboard.js
│   ├── audit-trail.js
│   └── ...
├── services/            # Business logic services
│   ├── NotificationService.js
│   ├── EnhancedNotificationService.js
│   ├── AuditService.js
│   └── BackgroundJobs.js
├── migrations/          # Database migrations
├── tests/              # Test suites
└── uploads/            # File upload directory
```

## Enhanced Features

### 1. Profile Management (`/api/profile`)

Complete user profile management with statistics and activity tracking.

#### Endpoints:
- `GET /profile` - Get user profile with statistics
- `PUT /profile` - Update user profile information
- `POST /profile/image` - Upload profile image
- `PUT /profile/notifications` - Update notification preferences
- `PUT /profile/password` - Change password
- `PUT /profile/2fa` - Enable/disable two-factor authentication
- `GET /profile/activity` - Get user activity log
- `DELETE /profile` - Delete user account (GDPR compliance)
- `GET /profile/export` - Export user data

#### Features:
- Profile image upload with validation
- Comprehensive user statistics
- Activity logging
- Password strength validation
- Two-factor authentication support
- GDPR-compliant data export

### 2. Settings Management (`/api/settings`)

Advanced user preferences and system settings management.

#### Endpoints:
- `GET /preferences` - Get all user preferences
- `PUT /notifications` - Update notification settings
- `PUT /appearance` - Update theme and display preferences
- `PUT /privacy` - Update privacy settings
- `PUT /security` - Update security settings
- `POST /security/revoke-sessions` - Revoke all active sessions
- `GET /api-keys` - List user API keys
- `POST /api-keys` - Create new API key
- `DELETE /api-keys/:id` - Revoke API key
- `GET /data-export/status` - Get data export status
- `POST /data-export` - Request data export
- `GET /data-export/:id/download` - Download exported data
- `GET /system` - Get system settings (admin only)
- `PUT /system` - Update system settings (admin only)

#### Features:
- Granular notification preferences
- Theme and language settings
- Privacy controls
- API key management
- Session management
- Data export for GDPR compliance
- System-wide configuration

### 3. Admin Dashboard (`/api/admin-dashboard`)

Comprehensive administrative interface with real-time metrics.

#### Endpoints:
- `GET /overview` - Dashboard overview with key metrics
- `GET /performance` - System performance metrics
- `GET /users/summary` - User management summary
- `GET /devices/summary` - Device management summary
- `GET /security/overview` - Security overview and alerts
- `POST /devices/:id/verify` - Approve/reject device verification
- `GET /alerts` - Get system alerts
- `POST /alerts/:id/acknowledge` - Acknowledge system alert

#### Features:
- Real-time system statistics
- User and device analytics
- Performance monitoring
- Security event tracking
- Device verification queue
- System alert management
- Activity monitoring

### 4. Audit Trail (`/api/audit`)

Comprehensive activity logging and security monitoring.

#### Endpoints:
- `GET /logs` - Get audit logs with filtering and pagination
- `GET /stats` - Get audit statistics and summaries
- `GET /logs/:id` - Get specific audit log details
- `GET /export` - Export audit logs (CSV/JSON)
- `GET /system-health` - Get system health metrics

#### Features:
- Comprehensive activity logging
- Advanced filtering and search
- Security event tracking
- Performance metrics
- Data export capabilities
- Real-time monitoring
- Suspicious activity detection

### 5. Enhanced Notifications

Multi-channel notification system with preferences.

#### Channels:
- **Email**: HTML templates with personalization
- **SMS**: Critical alerts via Twilio
- **Push**: Web push notifications
- **In-app**: Real-time notifications

#### Notification Types:
- Device verification updates
- Device check alerts
- Suspicious activity warnings
- Report status updates
- Welcome emails
- Security alerts
- System notifications

#### Features:
- User preference management
- Template-based emails
- Rate limiting
- Delivery tracking
- Bulk notifications
- Personalization

### 6. KYC Service (`/api/kyc`)

NIN-based identity verification system with face match and liveness detection.

#### Endpoints:
- `POST /verify` - Submit NIN and Live Selfie for verification
- `GET /status` - Check current verification status

#### Features:
- **NIN Encryption**: AES-256-CBC encryption for sensitive ID data
- **Face Liveness**: Verifies the selfie is from a live person
- **Face Matching**: Matches selfie against official NIN photo
- **Batch Processing**: Async handling of verification requests
- **Audit Logging**: Tracks every verification attempt and result

#### Data Privacy:
- NINs are stored encrypted in the `kyc_verifications` table
- External API calls are performed securely
- User profile is updated only upon successful verification

## Database Schema

### Enhanced Tables

#### `users` (Enhanced)
```sql
-- New columns added:
profile_image_url VARCHAR(255)
phone VARCHAR(20)
region VARCHAR(50)
two_factor_enabled BOOLEAN DEFAULT FALSE
theme_preference ENUM('light', 'dark', 'auto') DEFAULT 'light'
language_preference VARCHAR(5) DEFAULT 'en'
timezone VARCHAR(50) DEFAULT 'Africa/Lagos'
email_notifications BOOLEAN DEFAULT TRUE
sms_notifications BOOLEAN DEFAULT FALSE
push_notifications BOOLEAN DEFAULT TRUE
device_alerts BOOLEAN DEFAULT TRUE
transfer_notifications BOOLEAN DEFAULT TRUE
verification_notifications BOOLEAN DEFAULT TRUE
report_updates BOOLEAN DEFAULT TRUE
marketing_emails BOOLEAN DEFAULT FALSE
-- ... additional preference columns
```

#### `audit_logs` (New)
```sql
CREATE TABLE audit_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(36),
    action VARCHAR(100) NOT NULL,
    resource_type ENUM('user', 'device', 'report', 'auth', 'system', 'api'),
    resource_id VARCHAR(36),
    details TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'low',
    status ENUM('success', 'failed', 'warning') DEFAULT 'success',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `api_keys` (New)
```sql
CREATE TABLE api_keys (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    key_hash VARCHAR(64) NOT NULL,
    permissions JSON,
    expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `system_settings` (New)
```sql
CREATE TABLE system_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT,
    category VARCHAR(50) DEFAULT 'general',
    data_type ENUM('string', 'number', 'boolean', 'json'),
    is_public BOOLEAN DEFAULT FALSE
);
```

### Additional Tables
- `user_sessions` - Session management
- `data_exports` - GDPR compliance
- `system_alerts` - Admin notifications
- `push_subscriptions` - Web push notifications
- `notification_queue` - Queued notifications
- `device_checks` - Public check tracking

## Security Features

### Authentication & Authorization
- JWT-based authentication
- Role-based access control (RBAC)
- Session management
- Two-factor authentication support
- API key authentication

### Input Validation & Sanitization
- Comprehensive input validation using express-validator
- XSS protection through input sanitization
- SQL injection prevention
- File upload validation
- Rate limiting

### Security Headers
- Content Security Policy (CSP)
- X-Frame-Options
- X-Content-Type-Options
- X-XSS-Protection
- Referrer Policy

### Audit & Monitoring
- Comprehensive activity logging
- Security event tracking
- Suspicious activity detection
- Failed login monitoring
- IP-based threat detection

## API Documentation

### Authentication
All protected endpoints require a valid JWT token in the Authorization header:
```
Authorization: Bearer <jwt_token>
```

### Response Format
All API responses follow a consistent format:

**Success Response:**
```json
{
  "data": { ... },
  "message": "Success message",
  "timestamp": "2024-01-21T10:30:00Z"
}
```

**Error Response:**
```json
{
  "error": "Error type",
  "message": "Detailed error message",
  "details": [ ... ], // For validation errors
  "timestamp": "2024-01-21T10:30:00Z"
}
```

### Pagination
List endpoints support pagination with the following parameters:
- `page` (default: 1)
- `limit` (default: 20, max: 100)
- `sort_by` (field to sort by)
- `sort_order` (ASC/DESC)

### Filtering
Many endpoints support filtering with query parameters:
- `search` - Text search
- `status` - Filter by status
- `type` - Filter by type
- `start_date` / `end_date` - Date range filtering

## Configuration

### Environment Variables
```bash
# Database
DB_HOST=localhost
DB_PORT=3306
DB_NAME=checkit_db
DB_USER=checkit_user
DB_PASS=secure_password

# JWT
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=24h

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=noreply@checkit.com

# SMS (Twilio)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1234567890

# Push Notifications
VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key

# Application
APP_NAME=Check It Device Registry
FRONTEND_URL=http://localhost:5173
ADMIN_EMAIL=admin@checkit.com
```

### System Settings
Key system settings that can be configured via the admin panel:
- `maintenance_mode` - Enable/disable maintenance mode
- `registration_enabled` - Allow new user registrations
- `max_devices_per_user` - Device limits per user type
- `session_timeout_minutes` - Session timeout duration
- `api_rate_limit_per_minute` - API rate limiting
- `notification_rate_limit` - Notification rate limiting

## Testing

### Running Tests
```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run specific test suite
npm test -- enhanced-features.test.js

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Test Coverage
The test suite covers:
- Authentication and authorization
- Profile management
- Settings management
- Admin dashboard functionality
- Audit trail features
- Input validation
- Error handling
- Security features
- Performance benchmarks

## Deployment

### Database Migration
Run the enhanced features migration:
```bash
mysql -u username -p database_name < migrations/add_enhanced_features.sql
```

### Production Considerations
1. **Database Optimization**
   - Enable query caching
   - Set up proper indexes
   - Configure connection pooling
   - Regular backup schedule

2. **Security Hardening**
   - Use HTTPS in production
   - Configure proper CORS settings
   - Set up rate limiting
   - Enable audit logging

3. **Performance Monitoring**
   - Set up application monitoring
   - Configure log aggregation
   - Monitor database performance
   - Set up alerting

4. **Scalability**
   - Configure load balancing
   - Set up database replication
   - Implement caching strategy
   - Consider microservices architecture

## Troubleshooting

### Common Issues

1. **Database Connection Issues**
   - Check database credentials
   - Verify database server is running
   - Check network connectivity
   - Review connection pool settings

2. **Authentication Problems**
   - Verify JWT secret configuration
   - Check token expiration settings
   - Review user permissions
   - Check session management

3. **Notification Delivery Issues**
   - Verify SMTP/Twilio credentials
   - Check user notification preferences
   - Review rate limiting settings
   - Monitor notification queue

4. **Performance Issues**
   - Check database query performance
   - Review API response times
   - Monitor memory usage
   - Check for memory leaks

### Logging
The application uses structured logging with different levels:
- `error` - Error conditions
- `warn` - Warning conditions
- `info` - Informational messages
- `debug` - Debug information

Logs are written to:
- Console (development)
- File system (production)
- External logging service (optional)

## Support

For technical support or questions about the backend implementation:
1. Check this documentation
2. Review the test suite for examples
3. Check the audit logs for debugging
4. Contact the development team

## Changelog

### Version 2.0.0 (Enhanced Features)
- Added comprehensive profile management
- Implemented advanced settings management
- Created admin dashboard with real-time metrics
- Added comprehensive audit trail
- Enhanced notification system
- Implemented API key management
- Added GDPR compliance features
- Enhanced security features
- Added comprehensive test suite
- Improved error handling and validation

### Version 1.0.0 (Initial Release)
- Basic device registration
- User authentication
- Report management
- Public device checking
- Basic admin features