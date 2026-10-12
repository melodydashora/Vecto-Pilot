// Opt-in SQL integration harness: use an existing PGlite installation via NODE_PATH.
// Shared Jest/package wiring remains owned by the coordinated CLI work.
const path = require('node:path');
module.exports = {
  modulePathIgnorePatterns: ['<rootDir>/astra/recovery/', '<rootDir>/\\.(?:cache|config|local|worktrees)/'],
  testPathIgnorePatterns: ['/node_modules/', '/.worktrees/', '/.config/', '<rootDir>/astra/recovery/'],
  rootDir: path.resolve(__dirname, '../..'), testEnvironment: 'node', transform: {},
  testMatch: ['**/tests/offers/outcome-api.integration.mjs'], testTimeout: 20000,
};
