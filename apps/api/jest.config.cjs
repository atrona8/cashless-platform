// Jest de l'API : `npm test -w @cashless/api -- <motif>` filtre par chemin (ex. money, scenario).
const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  // `canonicalize` (JCS, RFC 8785) et `jose` (JWT, OIDC) ne sont publiés qu'en module ES : SWC les convertit en
  // CommonJS pour Jest.
  transformIgnorePatterns: ['/node_modules/(?!(canonicalize|jose)/)'],
};
