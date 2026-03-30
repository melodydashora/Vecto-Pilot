export default {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      tsconfig: 'client/tsconfig.json'
    }],
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/client/src/$1',
  },
  moduleDirectories: ['node_modules', 'client/src'],
  testMatch: [
    '**/tests/**/*.test.tsx'
  ],
  verbose: true,
};