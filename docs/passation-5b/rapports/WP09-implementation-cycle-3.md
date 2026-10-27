# Compte rendu du lot WP09, cycle 3

Prompt du runtime obtenu par `spec-kitty agent action implement WP09` (accepté). Commit lane-i : voir `git log` (message `fix(WP09): verrou d'essai pris avant l'argon2…`). Base `cashless_wp09`, supprimée.

## Changements
1. Témoin d'égalité (constat 1) : `vendor-sessions.spec.ts`, test unique sur les trois routes (ouverture, `setVendorPin`, `createVendor`) : empreinte stockée != HMAC du corps en clair ET == HMAC du corps dérivé (`hasher.idempotencyBody`).
2. Verrou avant argon2 (constat 2) : nouveau `src/idempotency/request-lock.ts` (`@RequestLock`, `RequestLockInterceptor`), enregistré en `APP_INTERCEPTOR` AVANT `IdempotencyInterceptor` (`idempotency.module.ts`). Verrou consultatif de session pris sans attente, tenu par `finalize` jusqu'à la fin de la chaîne (succès, refus, erreur). `SessionLock.tryAcquire` ajouté (`tryRun` s'appuie dessus). `PinAttemptLock` (classe) supprimée, remplacée par `PIN_ATTEMPT_REQUEST_LOCK` ; le service d'ouverture ne prend plus le verrou. `nonFinal: ['RATE_LIMITED']` conservé (cas 23505).
3. Secret (constat 3) : `VENDOR_PIN_IDEMPOTENCY_SECRET` / `vendorPinIdempotencySecret` (`config.ts`, mêmes règles : 32 octets, hex/base64, obligatoire en production, secret de test refusé, distinct des 4 autres via `assertDistinctHmacKeys`). `VendorPinHasher(secret, idempotencySecret, impl?)` : le dérivé n'utilise que ce secret ; construction refusée si <32 octets ou égal à `VENDOR_PIN_SECRET`. Environnements : `test/support/tls.ts`, `tools/dev-db/env.sh`, `tools/dev-db/env.test.example`.
4. Mineur (constat 5) : test transverse « un 429 hors nonFinal est enregistré puis rejoué ; avec nonFinal relâché » (routes de test `limited`, `limited-final`, note `trop-vite`).

## Retouches hors carte
- `src/idempotency/` (nouveau `request-lock.ts`, `idempotency.module.ts`), `src/db/session-lock.ts`, `src/config/config.ts` : autorisées par le prompt.
- `test/integration/transverse/{idempotency.spec.ts,test-route.module.ts}` : test du constat 5 (routes de test).
- `tools/dev-db/env.sh`, `env.test.example` : environnements de test (demandé).
- Docs non touchées (`docs/08-pile-logicielle.md`, POINTS_OUVERTS, ADR, PRD, PROMPTS) mentionnent `VENDOR_PIN_SECRET` : à compléter par l'orchestrateur (nouveau secret + variable d'exploitation).

## Mutations
- M1 retirer `pinFields` de `createVendor` : 1 test échoue (le témoin d'égalité). Annulée.
- M2 verrou ordonné APRES `IdempotencyInterceptor` (donc après le dérivé) : 3 échecs (« AVANT le dérivé », « retenu dans argon2 », « verrou tenu ») . Annulée.
- M3a verrou relâché aussitôt pris : 2 échecs. Annulée.
- M3b verrou jamais relâché : le test « libre après… » ne termine pas (connexions de verrou tenues, `pool.end()` bloqué) : détecté comme échec par blocage, jamais vert. Annulée.
- M8 tout 429 traité comme non définitif dans l'intercepteur : 1 échec (nouveau test transverse). Annulée.

## Tests (depuis la lane, `cashless_wp09`, toutes `DATABASE_URL_*` posées)
- `tsc --noEmit -p apps/api/tsconfig.json` : 0 erreur ; Prettier : inchangé ; ESLint (src, unit, vendors, transverse) : 0 problème.
- Jest `--runInBand` sur vendors, vendor-pin, idempotence (unit+transverse), device-route, engine, devices (admin, config), platform-tx, config, architecture, device-auth-matrix : 31 suites, 462 verts, 1 échec : `devices/config.spec.ts` « NFR-009 p95 ≤ 200 ms sur 200 lectures » (délai Jest de 5 s, connu et antérieur, déjà signalé au cycle 1).
- Concurrence, 5 exécutions de suite : `-t "simultanés|un essai à la fois|AVANT le dérivé|libre après"` : 6 verts à chaque fois.
- Preuves du cycle 2 conservées : verrou libre après succès, refus, 500, 422, plus 500 dans le dérivé et 409 de clé réutilisée ; un seul essai compté.

## Points soumis au porteur
- Le `429` d'un essai concurrent est maintenant rendu AVANT le contrôle de clé d'idempotence, de mode et de corps (donc jamais enregistré, même sans `nonFinal`). Aucun affaiblissement : seul le moment du refus change.
- Un terminal qui abandonne sa connexion : le verrou est relâché à la fin de la chaîne de traitement (pas à la déconnexion), donc pas de relâchement anticipé.
- Le verrou reprend une connexion du pool dédié par essai en cours (inchangé).

## Fichiers à faire relire par une personne
`apps/api/src/config/config.ts` (secrets), `apps/api/src/vendor-pin/vendor-pin.hasher.ts` (cryptographie, dérivé), `apps/api/src/idempotency/request-lock.ts` et `apps/api/src/db/session-lock.ts` (verrous, ordre des intercepteurs).
