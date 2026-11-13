// Jest de l'outil d'administration : `npm test -w @cashless/edge-admin` (base : PGDATABASE/env.sh, comme l'API).
const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  // Les suites sur base réutilisent les fixtures de l'API (modules ES convertis comme dans apps/api).
  transformIgnorePatterns: ['/node_modules/(?!(canonicalize|jose|cbor2|@cto\\.af)/)'],
};
