const path = require('node:path');
module.exports = {
  rootDir: path.resolve(__dirname, '../..'), testEnvironment: 'jsdom',
  testMatch: ['**/tests/feedback/*.ui.test.tsx'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/client/src/$1', '^@shared/(.*)$': '<rootDir>/shared/$1' },
  transform: { '^.+\\.[jt]sx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', module: 'CommonJS', target: 'ES2020', allowJs: true, esModuleInterop: true, isolatedModules: true }, diagnostics: false }] },
};
