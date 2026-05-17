/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/apps/api/**/*.test.ts',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/apps/client/'],
  setupFiles: ['<rootDir>/test/setup/env.ts'],
  moduleNameMapper: {
    '^@repo/db$': '<rootDir>/src/db/index.ts',
    '^@repo/db/schemas$': '<rootDir>/src/db/index.ts',
    '^@repo/db/(.*)$': '<rootDir>/src/db/$1',
    '^@repo/vendors$': '<rootDir>/src/vendors/index.ts',
    '^@repo/ordering$': '<rootDir>/src/ordering/index.ts',
    '^@repo/ordering/(.*)$': '<rootDir>/src/ordering/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      diagnostics: false,  // skip type-checking during tests (IDE/tsc handles that)
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'node',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: false,
      },
    }],
  },
};
