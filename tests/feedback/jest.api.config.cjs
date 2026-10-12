// Actual routers and SQL in disposable PGlite, supplied by an existing install.
const path = require('node:path');
module.exports = {
  modulePathIgnorePatterns: ['<rootDir>/astra/recovery/', '<rootDir>/\\.(?:cache|config|local|worktrees)/'],
  testPathIgnorePatterns: ['/node_modules/', '/.worktrees/', '/.config/', '<rootDir>/astra/recovery/'],
  rootDir: path.resolve(__dirname, '../..'), testEnvironment: 'node', transform: {},
  testMatch: ['**/tests/feedback/venue-feedback.api.integration.mjs'], testTimeout: 20000,
};
