// Jest de la bibliothèque de format : `npm test -w @cashless/tag-format`.
const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
};
