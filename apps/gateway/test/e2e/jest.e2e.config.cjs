// Jest des preuves de bout en bout (WP25) : toujours `--runInBand --forceExit` (mémoire du poste),
// délais longs, bases jetables `cashless_m8_*` créées par les suites elles-mêmes.
// Lancement : `npx jest -c test/e2e/jest.e2e.config.cjs --runInBand --forceExit` depuis apps/gateway.
const preset = require('../../../../jest.preset.cjs');

module.exports = {
  ...preset,
  rootDir: '../..',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.spec.ts'],
  testTimeout: 600_000,
  maxWorkers: 1,
  setupFiles: ['<rootDir>/test/e2e/env-setup.cjs'],
  transformIgnorePatterns: ['/node_modules/(?!(canonicalize|jose|cbor2|@cto\\.af)/)'],
};
