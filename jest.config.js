// jest.config.js
// Jest configuration for Block Schema Contract tests

export default {
  testEnvironment: 'node',
  transform: {},
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
