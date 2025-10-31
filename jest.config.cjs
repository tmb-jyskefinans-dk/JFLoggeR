module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/electron/__tests__/**/*.spec.ts'],
  moduleNameMapper: {
    '^electron$': '<rootDir>/electron/__mocks__/electron.ts',
    '^lowdb$': '<rootDir>/electron/__mocks__/lowdb.ts',
    '^lowdb/node$': '<rootDir>/electron/__mocks__/lowdb-node.ts'
  },
  clearMocks: true
};
