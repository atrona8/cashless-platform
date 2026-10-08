// Jest de l'API : `npm test -w @cashless/api -- <motif>` filtre par chemin (ex. money, scenario).
const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  // `canonicalize` (JCS, RFC 8785) n'est publié qu'en module ES : SWC le convertit en CommonJS pour Jest.
  transformIgnorePatterns: ['/node_modules/(?!canonicalize/)'],
};
