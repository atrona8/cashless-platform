// Jest de l'API : `npm test -w @cashless/api -- <motif>` filtre par chemin (ex. money, scenario).
const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  // `canonicalize` (JCS, RFC 8785), `jose` (JWT, OIDC) et `cbor2` (objet App Attest, avec sa
  // dépendance `@cto.af/wtf8`) ne sont publiés qu'en module ES : SWC les convertit en CommonJS.
  // `SKIP_LATENCY=1` : les mesures de temps (latence NFR-003 et NFR-006, indistinction des codes NFR-007) sont écartées
  // de la passe parallèle ; la CI les lance seules ensuite.
  testPathIgnorePatterns: [
    '/node_modules/',
    ...(process.env.SKIP_LATENCY
      ? ['configuration-latency', 'media-latency', 'claims-timing']
      : []),
  ],
  transformIgnorePatterns: ['/node_modules/(?!(canonicalize|jose|cbor2|@cto\\.af)/)'],
};
