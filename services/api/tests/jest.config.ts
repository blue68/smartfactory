import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '<rootDir>/unit/**/*.test.ts',
    '<rootDir>/integration/**/*.test.ts',
    '<rootDir>/e2e/**/*.test.ts',
  ],
  setupFilesAfterFramework: [],
  globalSetup: '<rootDir>/setup.ts',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'CommonJS',
        target: 'ES2020',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: false,
      },
    }],
  },
  coverageDirectory: '<rootDir>/coverage',
  collectCoverageFrom: [
    '../src/modules/**/*.ts',
    '../src/shared/**/*.ts',
    '!**/*.d.ts',
  ],
  testTimeout: 30000,
  verbose: true,
};

export default config;
