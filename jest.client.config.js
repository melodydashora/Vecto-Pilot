export default {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      // 2026-09-10: tests need the jest + jest-dom ambient types that client/tsconfig.json
      // (built for the app) does not declare; tsconfig.jest.json extends it for tests only.
      tsconfig: 'tsconfig.jest.json',
      // Vite's import.meta.env does not exist under Jest — see the transformer header.
      astTransformers: { before: [{ path: '<rootDir>/tests/transformers/import-meta-env.cjs' }] },
    }],
  },
  // jest-dom matchers (toBeInTheDocument, toHaveTextContent) used by the Briefing suites.
  setupFiles: ['<rootDir>/tests/setup/vite-env.ts'],
  setupFilesAfterEnv: ['@testing-library/jest-dom/jest-globals'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/client/src/$1',
    // 2026-09-10: client code imports the shared adapters via @shared (vite/tsconfig alias);
    // without this mapping every suite that touches dayparts fails to resolve.
    '^@shared/(.*)$': '<rootDir>/shared/$1',
  },
  moduleDirectories: ['node_modules', 'client/src'],
  testMatch: [
    '**/tests/**/*.test.tsx'
  ],
  // 2026-09-10: mirror jest.config.js — stale worktree copies under .worktrees/
  // were being selected as duplicate suites (VP-016 verification).
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.worktrees/',
  ],
  collectCoverageFrom: [
    'client/src/**/*.{ts,tsx}',
    '!client/src/**/*.test.{ts,tsx}',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage-client',
  verbose: true,
};