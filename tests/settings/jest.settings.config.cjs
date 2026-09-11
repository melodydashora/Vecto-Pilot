module.exports = {
  rootDir: '../..',
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/settings/*.test.ts', '**/tests/settings/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: { target: 'ES2022', module: 'CommonJS', jsx: 'react-jsx', esModuleInterop: true, isolatedModules: true },
    }],
  },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/client/src/$1' },
  setupFiles: ['<rootDir>/tests/settings/setup.cjs'],
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  clearMocks: true,
};
