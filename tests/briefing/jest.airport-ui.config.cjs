// Focused TSX harness; leaves the shared client-test configuration untouched.
const path = require('node:path');
module.exports = {
  rootDir: path.resolve(__dirname, '../..'),
  testEnvironment: 'jsdom',
  modulePathIgnorePatterns: ['<rootDir>/\\.(?:cache|config|local|worktrees)/'],
  testMatch: ['**/tests/briefing/airport-status.ui.test.tsx'],
  // 2026-09-15: never pick up worktree/coordination copies of these suites.
  testPathIgnorePatterns: ['/node_modules/', '/.worktrees/', '/.config/'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/client/src/$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', module: 'CommonJS', target: 'ES2020', esModuleInterop: true, isolatedModules: true }, diagnostics: false }] },
};
