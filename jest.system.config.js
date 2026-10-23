// System tests: the whole backend against a real (throwaway) MySQL database.
// Run: npm run test:system
module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/system/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/system/env.js'],
  globalSetup: '<rootDir>/tests/system/global-setup.js',
  globalTeardown: '<rootDir>/tests/system/global-teardown.js',
  testTimeout: 60000,
  maxWorkers: 1,
  forceExit: true,
  verbose: true,
};
