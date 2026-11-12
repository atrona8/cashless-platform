// Jest de la passerelle : `npm test -w @cashless/gateway -- <motif>` filtre par chemin.
// Les preuves de bout en bout (`test/e2e/`, WP25) ont leur propre configuration et tournent en
// série dans une étape
// dédiée de la CI ; `test/support/` ne contient que des aides, jamais de suite.
const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/test/e2e/', '/test/support/'],
  // `canonicalize` (JCS), `jose` (JWT) et `cbor2` ne sont publiés qu'en module ES : SWC les
  // convertit en CommonJS.
  transformIgnorePatterns: ['/node_modules/(?!(canonicalize|jose|cbor2|@cto\\.af)/)'],
};
