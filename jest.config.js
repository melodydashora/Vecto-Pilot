// jest.config.js
// Jest configuration for Block Schema Contract tests

export default {
  testEnvironment: 'node',
  transform: {},
  // Test-file exclusions alone leave cached packages in Jest's module index.
  modulePathIgnorePatterns: ['<rootDir>/\\.(?:cache|config|local|worktrees)/'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: [
    '**/tests/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  // 2026-06-11: ignore git worktrees so stale test copies under .worktrees/ don't
  // double-run (the logger-tier3 worktree was running an outdated pipeline.test.js
  // alongside the canonical one, polluting the suite signal with date-rotted failures).
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.worktrees/',
    // 2026-09-15: AI-session coordination bundles under .config/ carry test copies too.
    '/.config/',
    // 2026-09-13: opt-in integration suites (jest.integration.config.js +
    // VECTO_RUN_DATABASE_TESTS=1). blocksApi boots a real gateway and rotates the dev
    // server log; tactical-planner-cache needs a real DATABASE_URL.
    '<rootDir>/tests/blocksApi\\.test\\.js$',
    '<rootDir>/tests/strategy/tactical-planner-cache\\.test\\.js$',
  ],
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/**/*.test.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 10000,
  // ESM support
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
};
