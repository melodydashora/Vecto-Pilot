// Explicit opt-in only. The test refuses every database except disposable preview.
const path = require('node:path');
module.exports = {
  rootDir: path.resolve(__dirname, '../..'), testEnvironment: 'node', transform: {},
  testMatch: ['**/tests/briefing/briefing-postgres-acceptance.mjs'], testTimeout: 20000,
};
