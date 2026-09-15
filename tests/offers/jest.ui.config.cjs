// Isolated feature harness; does not replace the live CLI's shared Jest setup.
const path = require('node:path');
module.exports = {
  rootDir: path.resolve(__dirname, '../..'), testEnvironment: 'jsdom',
  testMatch: ['**/tests/offers/*.ui.test.tsx'],
  // 2026-09-15: never pick up worktree/coordination copies of these suites.
  testPathIgnorePatterns: ['/node_modules/', '/.worktrees/', '/.config/'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/client/src/$1', '^@shared/(.*)$': '<rootDir>/shared/$1' },
  transform: { '^.+\\.[jt]sx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', module: 'CommonJS', target: 'ES2020', allowJs: true, esModuleInterop: true, isolatedModules: true }, diagnostics: false }] },
};
