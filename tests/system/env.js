// Environment for the system tests. Reads the backend .env for database
// credentials, then forces safe test settings. The tests use their OWN
// database (TEST_DB_NAME, default "proveownership_system_test"), which is
// dropped and rebuilt on every run — never point it at real data.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = process.env.TEST_DB_NAME || 'proveownership_system_test';
if (process.env.TEST_DB_HOST) process.env.DB_HOST = process.env.TEST_DB_HOST;
if (process.env.TEST_DB_PORT) process.env.DB_PORT = process.env.TEST_DB_PORT;
if (process.env.TEST_DB_USER) process.env.DB_USER = process.env.TEST_DB_USER;
if (process.env.TEST_DB_PASSWORD !== undefined) process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'system-test-secret-system-test-secret-123';
process.env.KYC_ENCRYPTION_KEY = process.env.KYC_ENCRYPTION_KEY || 'system-test-kyc-key-system-test-kyc-1234';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_system_tests_only';
process.env.RATE_LIMIT_MAX = '1000000';
process.env.AUTH_RATE_LIMIT_MAX = '1000000';
// The tests send hundreds of deliberately bad requests from one address;
// don't let the network-block guard shut them out.
process.env.IP_BLOCK_THRESHOLD = '1000000';
process.env.ENABLE_EMAIL_OTP = 'false';
process.env.EMAIL_OUTBOX = 'memory';
process.env.MAIL_FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS || 'tests@proveownership.local';
// Never send real email or SMS from tests
delete process.env.RESEND_API_KEY;
delete process.env.TERMII_API_KEY;
delete process.env.PREMBLY_API_KEY;
if (process.env.PO_REAL_DB_NAME === undefined) process.env.PO_REAL_DB_NAME = process.env.DB_NAME || '';
if (process.env.TEST_DB_NAME === process.env.PO_REAL_DB_NAME) {
  throw new Error('TEST_DB_NAME must not be your real database name');
}
// Some services (OTP, audit, email verification) open their own pool with
// DB_NAME, so point that at the test database too.
process.env.DB_NAME = process.env.TEST_DB_NAME;

module.exports = {
  STATE_FILE: path.join(__dirname, '.state.json'),
  FIXTURE_SCHEMA: path.join(__dirname, '..', 'fixtures', 'schema.sql'),
};
