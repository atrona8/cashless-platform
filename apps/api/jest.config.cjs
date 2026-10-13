// Jest de l'API : `npm test -w @cashless/api -- <motif>` filtre par chemin (ex. money, scenario).
const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  // `canonicalize` (JCS, RFC 8785) et `jose` (JWT, OIDC) ne sont publiés qu'en module ES : SWC les convertit en
  // CommonJS pour Jest.
  // `SKIP_LATENCY=1` : la mesure de latence (NFR-003) est écartée de la passe parallèle ; la CI la lance seule ensuite.
  testPathIgnorePatterns: ['/node_modules/', ...(process.env.SKIP_LATENCY ? ['configuration-latency'] : [])],
  transformIgnorePatterns: ['/node_modules/(?!(canonicalize|jose)/)'],
};
