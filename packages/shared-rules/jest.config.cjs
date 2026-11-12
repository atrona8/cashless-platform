// Jest du paquet de règles partagées : `npm test -w @cashless/shared-rules`.
const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  // `canonicalize` (JCS, RFC 8785) n'est publié qu'en module ES : SWC le convertit en CommonJS (comme l'API).
  transformIgnorePatterns: ['/node_modules/(?!(canonicalize)/)'],
};
