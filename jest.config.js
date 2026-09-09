// Jest Configuration
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  collectCoverageFrom: [
    'routes/**/*.js',
    'services/**/*.js',
    'middleware/**/*.js',
    'config.js',
    '!**/node_modules/**',
    '!**/tests/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  setupFiles: [
    '<rootDir>/tests/db-check.js'
  ],
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.js'
  ],
  testTimeout: 30000,
  verbose: true,
  maxWorkers: 1
};