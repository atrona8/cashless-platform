# Compte rendu de WP18 — Preuves de bout en bout, CI, consignation (21/10/2026)

Lane : `.worktrees/identite-enrolement-terminaux-01M52R6H-lane-r` (WP01 à WP17 fusionnés). Trois implémenteurs (A1, A2,
B) sur des fichiers disjoints ; T086 et T087 faits par l'orchestrateur.

## Vérification (orchestrateur, en série, 21/10 après-midi)
- `npm run lint`, `npm run typecheck` : verts.
- `reset-db` puis pgTAP : 33 fichiers, 2072 tests, PASS.
- `reset-db` puis Jest de l'API (`SKIP_LATENCY=1`) : 101 suites, 1704 réussis, 6 ignorés, 0 échec.
- Mesures en série : `device-latency`, `media-latency`, `configuration-latency` : 17/17. NFR-009 : surcoût des trois
  preuves p95 17,3 ms (seuil 20) ; enrôlement p95 61 ms (1 s) ; configuration 44 ms, battement 46 ms (200 ms).
- CI : non lancée sur GitHub depuis ce poste (le workflow est modifié, pas exécuté).

## Ce qui est livré
- T083 : `device-journey.spec.ts` (SC-001, parcours par l'API, ré-enrôlement du `serial` après révocation par le
  back-office, IP et `X-Request-Id` dans l'audit des transitions) ; `device-auth-matrix.spec.ts` (NFR-002, SC-002 :
  routes de terminal croisées entre le contrat et `DeviceGuard`, chaque preuve absente/fausse/expirée/autre
  terminal/rejouée/autre autorité ; suspendu et révoqué sur chaque route ; OP-N70).
- T084 : `device-isolation.spec.ts`, `device-secrets.spec.ts`, `device-latency.spec.ts` (garde de production par faux).
- T085 : `.github/workflows/ledger-tests.yml` (historique complet, `ignore-scripts` vérifié, réglages de test,
  `check:generated` et `npm run generate` sans écart, suites pgTAP, mesures en série, délai 45 min).
- Reports des relectures : ADR-116/OP-N71 (A1), OP-N54 personnalisation (A1), M1/M3 de WP12 (A1), verrou de
  `migrate.ts` (A1), `request_id` de `DEVICE_TOKEN_REUSE` (A1) ; 0029 (A2), 0030 / ADR-117 N-a N-b N-c (A2), test de
  borne des purges ADR-114 (A2), course `media-tap-use:` (A2), `openapi.yaml` (A2), `enrollment-codes.spec.ts` (A2) ;
  `deviceScope` OPERATOR_ADMIN (B).
- T086 : sur `feat/identite-enrolement-terminaux`, commits `51b3bb4e` (POINTS_OUVERTS, DECISIONS_ADR, PROMPTS, PRD) et
  `00e0911d` (contrats `enrollment.md`, `device-lifecycle.md`, `data-model.md` alignés sur 0029 et 0030).

## Écarts au plan (sens)
- 0029 testée hors de `gen_tests.py` (`tests_config_served_guard.sql`) : décision du porteur ; neutre.
- 0029 refuse aussi une `config_version` de niveau `PLATFORM` : renforcement, gardé par le porteur.
- Rafale d'enrôlement : codes HTTP d'origine gardés, seules les écritures sont bornées (décision du porteur) ; neutre.
- ADR-116 : `409` au lieu de « 422 » (statut d'`openapi.yaml` et du code ; décision du porteur).
- M4 de WP12 (contrôle de 64 octets de `request-signature.ts`) non retiré : borne indépendante de la clé ; neutre.
- `deviceScope` exige une attribution OPERATOR_ADMIN du prestataire : renforcement.

## Retouches hors carte (justification)
- `apps/api/test/integration/end-to-end/media-port-swap.spec.ts` (mission 4) : ne compte que les nonces de ses deux
  terminaux (instable en batterie complète, d'autres suites écrivent en parallèle).
- `kitty-specs/fondations-grand-livre-01M4AY8M/contracts/idempotency.md` règle 3 (ADR-116, mission close).
- Code applicatif hors terminaux (A1 : idempotence, personnalisation, garde d'authentification ; B : `device-admin`)
  et migrations 0029, 0030 (A2) : demandés par les reports du prompt.

## Points soumis au porteur
- Tranchés le 21/10 : 409 (ADR-116) ; purge `api_idempotency` option (a) à T + 720 h ; test de 0029 hors
  `gen_tests.py` ; codes HTTP de la rafale ; `config_version` `PLATFORM` refusée.
- **Ouvert : OP-N72** (pas de limite en amont de `POST /v1/device-enrollments` ; chaîne d'audit de la plateforme
  sollicitée par les refus de codes inconnus) : mission 13 proposée, à confirmer.

## Écarts de sécurité encore ouverts (pour la revue post-fusion)
OP-N64 (iOS, mission 12), OP-N65 (grâce 60 s, mission 13), OP-N67 (Android, liste logicielle, mission 13), OP-N68
(droit par défaut des fonctions futures, mission 7), OP-N69 (colonnes de `device`, mission 7), OP-N72 (à confirmer) ;
droits plus larges acceptés : ADR-114 (purges par `cashless_app`, borné par `tests_device_purge_window.sql`), ADR-115
(famille non opposée à l'étape 3 pour un terminal `REVOKED`), écriture par `cashless_app` dans la chaîne d'audit de la
plateforme (0027). Dettes levées : OP-N42, N44, N50, N54, N59, N62, N63, N70, N71.

## T087 — Fichiers à faire relire par une personne (clés, droits de la base, cryptographie)
- Base : `packages/ledger-sql/post-roles.sql`, `packages/ledger-sql/gen_tests.py`, `packages/ledger-sql/src/migrate.ts`,
  migrations `0021` à `0027`, `0029`, `0030`, `tests/tests_enrollment_refusal.sql` (attentes modifiées).
- Démarrage et dépendances : `apps/api/src/processes/bootstrap.ts`, `.npmrc`, `package.json` (`overrides`).
- Identité du terminal : `apps/api/src/device-identity/{real-device-identity,request-signature,device.guard}.ts`,
  `apps/api/src/device-ca/*`, `apps/api/src/device-tokens/*`, `apps/api/src/attestation/*`.
- Idempotence et personnalisation : `apps/api/src/idempotency/{request-hash,idempotency.interceptor}.ts`,
  `apps/api/src/media/personalization/{personalization.dto,personalization.service}.ts`.
- Droits applicatifs : `apps/api/src/devices/admin/device-admin.service.ts` (`deviceScope`).
