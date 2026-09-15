// Opt-in integration runner (2026-09-13). These two suites boot a real gateway
// (blocksApi rotates the dev server log) or write to DATABASE_URL, so the unit
// config ignores them. Run: VECTO_RUN_DATABASE_TESTS=1 npm run test:integration
import unit from './jest.config.js';

const INTEGRATION_SUITES = ['tests/blocksApi.test.js', 'tests/strategy/tactical-planner-cache.test.js'];

export default {
  ...unit,
  globalSetup: '<rootDir>/tests/setup/require-database-test-opt-in.js',
  testMatch: INTEGRATION_SUITES.map(suite => `<rootDir>/${suite}`),
  // Inherit the unit ignore list minus the entries that exclude these suites.
  testPathIgnorePatterns: unit.testPathIgnorePatterns.filter(
    pattern => !INTEGRATION_SUITES.some(suite => pattern.includes(suite.split('/').pop().replace('.test.js', ''))),
  ),
};
