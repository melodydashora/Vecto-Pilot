module.exports = {
  rootDir: '../..',
  testEnvironment: 'jsdom',
  modulePathIgnorePatterns: ['<rootDir>/\\.(?:cache|config|local|worktrees)/'],
  testMatch: ['**/tests/settings/*.test.ts', '**/tests/settings/*.test.tsx'],
  // 2026-09-15: never pick up worktree/coordination copies of these suites.
  testPathIgnorePatterns: ['/node_modules/', '/.worktrees/', '/.config/'],
  transform: {
    '^.+\\.[jt]sx?$': ['ts-jest', {
      tsconfig: { target: 'ES2022', module: 'CommonJS', jsx: 'react-jsx', allowJs: true, esModuleInterop: true, isolatedModules: true },
    }],
  },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/client/src/$1', '^@shared/(.*)$': '<rootDir>/shared/$1' },
  setupFiles: ['<rootDir>/tests/settings/setup.cjs'],
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  clearMocks: true,
};
