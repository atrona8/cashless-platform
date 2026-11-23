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
  // de la passe parallèle ; la CI les lance seules ensuite. Même chose pour les suites de concurrence de la mission
  // recharges-caisses-psp (jusqu'à 100 connexions simultanées) : en parallèle, elles épuisent les 100 connexions
  // de la base de la CI ; elles tournent seules, en série, juste après. Idem pour les suites qui lancent les
  // travailleurs `psp-poller` (interrogation, reprise, purge) : ils voient les recharges de tous les prestataires
  // (OP-N86) et agiraient sur celles des suites voisines.
  // Mission hors-ligne-snapshots-lots (WP21) : la concurrence des lots (100 rejeux, 50 envois concurrents,
  // pool de verrous réduit) épuise aussi les connexions de la base de la CI en parallèle ; les deux suites de
  // mesures (lot de 500 opérations, snapshots de 50 000 bracelets) ne valent que serveur seul. Les parcours
  // `offline-journey` et `offline-minimal` lancent les travailleurs de snapshots, qui voient les grands livres de
  // toutes les suites : ils tournent aussi seuls. Les suites de rotation des clés de signature des snapshots
  // vident la table des clés (globale, au plus deux clés valides) : une suite voisine qui publie un snapshot la
  // référence ; elles tournent seules. Toutes ces suites tournent en série, juste après la passe parallèle.
  // Mission versements-rapprochements-cloture (WP12, WP14) : `controls-alerts` et `seal-and-verify` recréent la base
  // (`resetDatabase()`) pour que les contrôles permanents et le scellement, qui lisent TOUS les grands livres et
  // toutes les chaînes d'audit, ne voient que leurs données. Elles détruiraient la base des autres travailleurs : elles
  // tournent seules, en série, sur base recréée, après la passe parallèle (workflow CI).
  // Mission serveur-app-festivalier (WP07) : `claim-rotation` pose des lignes en version 2 du secret des codes de
  // rattachement ; cette version est globale à la base et une API de version inférieure refuse de démarrer : seule.
  // WP08 : `cli/reissue-claim-codes` pose aussi des versions > 1 (commande lancée en version 2) : seule, même étape.
  testPathIgnorePatterns: [
    '/node_modules/',
    ...(process.env.SKIP_LATENCY
      ? [
          'configuration-latency',
          'media-latency',
          'claims-timing',
          'end-to-end/psp-concurrency',
          'end-to-end/cash-concurrency',
          'topups/psp-concurrency',
          'chargebacks/chargeback-concurrency',
          'cash-sessions/close-concurrency',
          'end-to-end/topup-journey',
          'end-to-end/topup-secrets',
          'webhooks/receive',
          'webhooks/retry',
          'topups/poller-',
          'end-to-end/offline-concurrency',
          'end-to-end/offline-journey',
          'end-to-end/offline-minimal',
          'end-to-end/offline-latency',
          'end-to-end/snapshot-latency',
          'snapshot-keys/rotation',
          'snapshot-keys/key-admin-worker',
          'controls/controls-alerts',
          'sealing/seal-and-verify',
          'vendors/vendor-pin-latency',
          'media/claim-rotation',
          'cli/reissue-claim-codes',
        ]
      : []),
  ],
  transformIgnorePatterns: ['/node_modules/(?!(canonicalize|jose|cbor2|@cto\\.af)/)'],
};
