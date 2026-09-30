// Explicit opt-in actual PostgreSQL, separate from disposable PGlite tests.
const path = require('node:path');
module.exports = {
  rootDir: path.resolve(__dirname, '../..'), testEnvironment: 'node', transform: {},
  testMatch: ['**/tests/feedback/venue-feedback-postgres-acceptance.mjs'], testTimeout: 20000,
};
