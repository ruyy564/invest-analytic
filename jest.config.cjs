const baseConfig = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', useESM: true }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  clearMocks: true,
};

module.exports = {
  ...baseConfig,
  testRegex: 'test/(unit|contract)/.*\\.spec\\.ts$',
  collectCoverageFrom: ['src/**/*.ts'],
};
