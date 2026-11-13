# Revue de mission après fusion : mission 8, passerelle locale (`passerelle-locale-01M6NM1S`)

Date : 12/11/2026. Branche `feat/passerelle-locale`, tête 6af9c68b (squash 9d5e4592, lot de correction 65bbc9e5..HEAD).
Revue en lecture seule : aucun commit, aucune commande Spec Kitty qui change un état. Le skill `spec-kitty-mission-review`
n'est pas dans `.claude/skills/` : la démarche du prompt a été appliquée (spec, plan, tâches, matrice, code, tests).

## 1. Verdict

**Publiable avec réserves.** Un constat bloquant au sens de la règle 4 de `CLAUDE.md` (écart non consigné, C1 ci-dessous).
Il se lève par une entrée dans `docs/POINTS_OUVERTS.md` et un ADR : aucun changement de code. Avant la PR vers `main`,
consigner C1. La passerelle reste **inutilisable en production** tant que la mission 12b n'a pas livré le stockage matériel
(onze écarts bloquent la production, voir § 5).

## 2. Constats bloquants

**C1. `pack_verified` est cru de la passerelle, sans entrée OP ni ADR.**
- Code : `apps/api/src/edge/sync/edge-sync.writer.ts:102` (`pack_verified: t.pack_verified === true`) ; le central ne
  détient pas la clé du colis, la valeur reçue passe donc seule. La garde SQL ne contrôle que ce booléen
  (`packages/ledger-sql/migrations/0070_edge_origin_key_padding.sql:247`, même forme en 0061:463 et 0064:301).
- Scénario : une passerelle compromise met `pack_verified: true` sur une vente sans avoir lu le colis de mots de passe.
  Le central ne peut pas le contredire. Les autres preuves (UID, compteur croissant, signature d'originalité, plafonds
  d'ADR-159) restent en place, donc la perte reste bornée ; mais c'est un contrôle que le central ne fait pas, alors que
  ADR-159 écrit « preuve du bracelet vérifiée ».
- Traces existantes : seulement `docs/passation-8/suivi-lots.md:430` (« à consigner ») et un commentaire de code. Rien dans
  `docs/POINTS_OUVERTS.md`, `docs/DECISIONS_ADR.md`, `PROMPTS-A-ENVOYER.md`, `PRD.md`.
- À faire : OP-N122 (numéro libre) + ADR-188 (risque, raison, mission qui le lève, condition de levée), un test qui échoue
  si la confiance s'élargit (par exemple : la garde refuse `pack_verified` absent, déjà prouvé ; ajouter un test qui fige
  que le central n'a aucune autre lecture du colis), report dans `PROMPTS-A-ENVOYER.md` et `PRD.md`. Mission qui le lève :
  12b (le central pourrait recevoir la preuve du colis par le processus des clés) ou 13.

Aucun autre écart affaiblissant sans entrée n'a été trouvé dans le code (recherche de TODO, bouchons, faux, drapeaux ;
lecture des gardes de démarrage, du central et de la passerelle).

## 3. Réserves

1. **CI non démontrée vraie sur la tête.** Dernier run lu : 43266236559 (`ledger` en échec, `gateway-e2e` vert) ; le run
   43286104244 sur `ci/m8-gateway-e2e` était encore en cours. Le balayage Trivy HIGH/CRITICAL de `gateway-e2e` est vert
   dans ce run, mais le job `ledger` n'a jamais été vu vert sur cette tête. Ne pas ouvrir la PR avant un `ledger` vert.
2. **Relectures distinctes manquantes** : `fb8e7b2c` (CI, redémarrage de PostgreSQL) et `6af9c68b` (CI, mot de passe du rôle
   `edge_app`) ne figurent pas comme relus par un agent distinct (`REPRISE.md`, point 2).
3. **Contrat stable : une seule différence n'est pas un ajout facultatif.** `EdgeSyncBatch.operations.minItems` passe de 1
   à 0 (`packages/contracts/openapi.yaml`, commentaire « RELÂCHÉ, décision 50, ADR-187 ») sous `/edge/*`. Elle est admise
   par la liste blanche, consignée (ADR-187) et limitée à `/edge/*`. Le reste : 29 différences, 29 admises, 0 refusée
   (`node tools/contract-stability/check.mjs`, rejoué) ; seul ajout hors `/edge/*` : `Problem.edge_base_url` (ADR-171).
   À signaler au porteur comme relâchement, pas comme ajout.
4. **Documentation en retard.** `docs/06-docs-status.md:165` dit encore « NON acceptée, NON consolidée, NON fusionnée » alors
   que la mission est acceptée (311af360) et consolidée (9d5e4592). Invoquer `spec-kitty-docs-maintain` pour le jalon
   post-fusion et la ligne du journal.
5. **Consignation incomplète côté documents.**
   - ADR-175 à ADR-181 : numéros absents de `docs/DECISIONS_ADR.md` (saut de 174 à 182) ; à expliquer ou combler.
   - OP-N115, OP-N116, OP-N117 n'ont qu'une ligne de tableau et une ligne de détail, pas de section `### OP-N…`.
   - OP-N116 n'a pas d'ADR ; OP-N114 n'a pas de report dans `PROMPTS-A-ENVOYER.md` ; seul OP-N100, N110 à N119 ont un report
     dans `PRD.md` (OP-N101 à N109 : zéro mention dans `PRD.md`). La règle 3 exige le report dans les deux fichiers.
   - ADR-182 (oracle d'un bit `edge_tap_proof`) et ADR-184 (clé de contenu dérivée sans graine par passerelle, levée en 12b)
     portent un risque réel mais n'ont aucun OP-N.
6. **Outil d'inscription** : `--by` n'authentifie pas la personne (`suivi-lots.md:426`, « à consigner ») ; rattaché de fait à
   OP-N105/OP-N112 mais non écrit dans ces entrées. Ajouter une phrase à OP-N105.
7. **Qualité des tests** : alias `Loose` = `any` dans les tests (lint de 142 erreurs contourné, typage réel à faire) ;
   `startup-guard.spec.ts` instable en batterie complète (`REPRISE.md`, point 6).
8. **NFR-001** : prouvé en CI à 108 débits/s avec un plancher de 100 (`.github/workflows/ledger-tests.yml:310`,
   `ci-workflow.spec.ts` interdit de l'abaisser). Les 59 à 66 débits/s mesurés en local restent sous 100 : la preuve ne
   vaut que sur l'exécuteur de la CI. NFR-005 n'est plus en cause (p95 13 ms en série, 57 ms à concurrence 10).

## 4. Couverture des exigences

La matrice `kitty-specs/passerelle-locale-01M6NM1S/acceptance-matrix.json` : 59 critères, 59 « pass », 5 invariants
négatifs (NI-001 à NI-005) avec commande de vérification. Ses preuves citent des fichiers de tests ; la matrice
précise elle-même que les tests ne citent pas tous « FR-0xx ». Échantillon de 16 FR vérifié dans le code et les tests :

| FR / NFR | Comportement dans le code | Preuve |
|---|---|---|
| FR-013 refus central sous EDGE | `payments.service.ts:124` (refus anticipé, 409) ; dernier recours SQL `0060_edge_sync_registry.sql:386` (`CL006`, tout débit de portefeuille hors `EDGE_SYNC`) ; inventaire `debit-authority/debit-paths.ts` | `apps/api/test/integration/debit-authority/debit-paths-refused.spec.ts:99-145` (la suite lit l'inventaire) ; `payments-edge-early-refusal.spec.ts` ; `unit/errors/sqlstate-map.spec.ts:23` |
| FR-012 exclusion par l'époque | `apps/gateway/src/authority/authority.service.ts:200-215` (`FOR SHARE`, `STALE_AUTHORITY_EPOCH`, `MOVING`) ; en-tête `X-Authority-Epoch` obligatoire (`sales-support.ts:131-135`) | `apps/gateway/test/authority/epochs.spec.ts:31-55` ; `e2e/exclusion-under-load.spec.ts:57` (20 bascules, 100 débits/s) |
| FR-023 pas de reprise après RELEASING | `authority-transitions.ts:21-25` (retour à `ACTIVE` seulement même époque après échec) | `authority/restart-cases.spec.ts:38` (les quatre cas) |
| FR-024 autorité avant clôture | `CL019`, `0008_event_ledger.sql:106` | `packages/ledger-sql/tests/tests_event_ledger.sql:249` |
| FR-030 STANDBY | `authority.service.ts` (refus), `standby/standby.service.ts` | `apps/gateway/test/purge/standby.spec.ts:17,34` (aucune écriture directe ne mène STANDBY à ACTIVE) |
| FR-031 certificat et périmètre | `apps/api/src/edge/auth/edge-mtls.guard.ts`, `edge-identity.service.ts` | `integration/edge/routes/edge-cloistering.spec.ts:56,72,83` ; `process/edge-mtls-guard.spec.ts` ; `sync/sync-gateway-isolation.spec.ts` |
| FR-032 port matériel, faux refusé | `key-store/hardware-keystore.factory.ts` (sans adaptateur : échec, pas de repli sur le faux) ; `startup-guard.ts` | `test/startup/keystore.spec.ts:8-65` ; `e2e/production-refusals.spec.ts:296` |
| FR-035 / NFR-013 purge | `purge/purge.service.ts` (MARKER, QUIESCE, KEYS, DATA, VACUUM, FINAL_KEYS) ; ordre manuel à deux, versé avant destruction | `test/purge/purge-canary.spec.ts:19,46` ; `purge-manual.spec.ts:40-263` ; `purge-with-link.spec.ts:57` ; `e2e/purge-end-to-end.spec.ts` |
| FR-037 alerte et délai | `edge/packs/edge-packs.service.ts`, `pack-sealing.ts` | `integration/edge/packs/register-alert.spec.ts:33,53` ; `pack-delay.spec.ts:17,27,53` ; `pack-standby.spec.ts` |
| FR-039 jeton d'appareil sans rotation | `gateway/src/device/refresh.service.ts`, `device-token.service.ts` | `test/device/refresh.spec.ts:49,98,106` |
| FR-036 audit de la tolérance | `staff/tolerance-audit.ts`, `queue/staff-audit-feed.ts` | `test/staff/` absent ; preuve par `test/sales`/`e2e/consignation` : à confirmer (réserve mineure : aucun test nommé par fichier lu) |
| FR-038 bornes du rejeu `EDGE_ONLINE` | `0061/0064/0070` (type, comptes, preuve, plafonds, rognage) | `integration/edge/sync/sync-spend-order.spec.ts:72` ; `tests_edge_post_transaction.sql` ; `sync-boundaries.spec.ts` |
| FR-019 refus de la file | `edge/sync/edge-sync-chain.ts`, `0066:152` | `sync/sync-chain-order.spec.ts:29,44,102` |
| FR-020 rejeu impossible | `0068_open_offline_anomaly_edge_replay.sql` | `packages/ledger-sql/tests/tests_edge_replay_anomaly.sql:41` |
| NFR-003 aucune double écriture | clé d'origine canonique (0070) | `sync/sync-replay-hundred.spec.ts:47,62` ; `e2e/replay-100.spec.ts` |
| NFR-009 aucun faux en production | voir § 6 | `e2e/production-refusals.spec.ts` |
| NFR-012 contrat stable | `tools/contract-stability/check.mjs` | rejoué : 29 admises, 0 refusée ; `e2e/contract-stability.spec.ts` |

Remarque FR-036 : je n'ai pas localisé de fichier de test portant le nom du comportement (pas de dossier `test/staff`).
Le code existe (`tolerance-audit.ts`, `staff-audit-feed.ts`). À vérifier par un coup de sonde avant la PR : un test qui
échoue si un usage toléré n'est pas versé.

## 5. Dérives plan/spec et livré

- Décisions 1 à 58 de `docs/passation-8/contexte-m8.md` : les écarts relevés dans `suivi-lots.md` sont tous consignés,
  sauf C1 et le point 6 des réserves.
- Dérives acceptées et tracées : « mêmes modules » au lieu de « même moteur » (ADR-164) ; clé TLS client en fichier
  (ADR-168) ; lot d'ordres seuls (ADR-187, relâchement de `minItems`) ; `spend_order` répliqué (ADR-185, ajout facultatif) ;
  `edge_tap_proof` (ADR-182, 6e fonction hors décision 39).
- Contrat : voir réserve 3. Pas d'énumération modifiée, pas de route nouvelle hors `/edge/*`.
- Option 1 (refus avant le travail de la vente dans `createPayment`) : renforce la sécurité (CL006 inchangé), consigné.

## 6. Écarts de sécurité ouverts (règle 4)

18 écarts ouverts (OP-N100 à N119 moins OP-N117 et N119, levés le 11/11 par WP25 partie A), plus C1 à consigner. **Onze
bloquent la production** (colonne « Bloque » de `docs/POINTS_OUVERTS.md`).

| OP | ADR | Objet | État | Lève | Bloque la production |
|---|---|---|---|---|---|
| N100 | 155 | Faux du stockage matériel et de l'autorité des passerelles | ouvert | 12b | oui |
| N101 | 156 | Jetons d'appareil signés par une clé propre, hors KMS | ouvert | 12b | oui |
| N102 | 157 | Jeton de rafraîchissement sans rotation sur la passerelle | ouvert | porteur (contrat) | oui |
| N103 | 158 | Jeton de personne expiré toléré 12 h | ouvert | porteur | oui |
| N104 | 159 | Ventes `EDGE_ONLINE` sans signature du terminal, perte maximale chiffrée | ouvert | porteur (plafonds) | oui |
| N105 | 160 | Inscription par une seule personne, alerte et délai | ouvert | porteur (délai) | oui |
| N106 | 161 | Mini-PC volé avant la purge | ouvert | exploitation | oui |
| N107 | 162 | Pas de rejeu automatique des activations et cautions | ouvert | 13 | non |
| N108 | 163 | Dépassement temporaire d'un plafond au rejeu d'une recharge | ouvert | juriste | oui |
| N109 | 164 | « Mêmes modules » | ouvert | porteur | non |
| N110 | 165 | `STALE` persisté si confirmé ou plausible | ouvert | porteur | non |
| N111 | 166 | Rôle unique `edge_app` propriétaire des tables | ouvert | 13 | oui |
| N112 | 167 | Deux clés de site détenues par une seule personne | ouvert | porteur | non |
| N113 | 168 | Clé TLS client en fichier | ouvert | 12b | oui |
| N114 | 170 | Seconde demande `CENTRAL` abandonne le rendu | ouvert | porteur | non |
| N115 | 184 | Page de 200 bracelets illisibles arrête le service | ouvert | 12b | non |
| N116 | aucun | `register --ledger` non vérifié | ouvert | 11a | non |
| N118 | 186 | Purge : WAL, blocs libres, tables d'ajout seul, hors transaction | ouvert | 12b | oui |
| (C1) | à créer | `pack_verified` cru de la passerelle | non consigné | à fixer | à fixer |

Avec test de borne : N111 (`e2e/security-bounds.spec.ts:23,52,67`, liste figée des rôles, sensibilité), N112
(`security-bounds.spec.ts:86`), N113 (`test/startup/client-key-file.spec.ts`), N118 (`purge-canary.spec.ts`, liste figée des
tables non vidées). Pour N116 et N115 la preuve de borne n'a pas été relue.

## 7. Faux en production (règle 2)

Chaque règle de `apps/gateway/src/processes/startup-guard.ts` (intégrées et enregistrées) a un démarrage réel dans
`apps/gateway/test/e2e/production-refusals.spec.ts` :
- test d'énumération `:189` (« chaque règle a un cas, chaque cas a sa règle »), contrôle positif `:206` (la configuration saine
  démarre, sinon rien n'est prouvé), un démarrage réel par règle `:212`, plusieurs violations à la fois `:240` ;
- règles : `HARDWARE_KEYSTORE=fake`, `EDGE_CA`, `GATEWAY_IDENTITY_VERIFIER`, `GATEWAY_DEV_KEY_FILE`, `EDGE_FAILPOINT`,
  `EDGE_ALLOW_FAILPOINTS`, `CORS_ALLOW_ALL`, TLS absent, joker d'autorité, secret de test dans l'URL de base, https du
  central et du JWKS, `GATEWAY_ADMIN_TLS` (`purge/admin-tls.ts:39`), `IDENTITY_KEYS_IN_MEMORY`
  (`staff/identity-keys.service.ts:26`) ; serveur local (`fsync`, `full_page_writes`, `synchronous_commit`, superutilisateur)
  `:254-322` ; objets instanciés (bouchon de rattrapage, purge des deltas) `:286,:305` ; `NODE_ENV` inconnu refusé par
  `loadConfig`.
- `HARDWARE_KEYSTORE=hardware` sans adaptateur : échec franc (`hardware-keystore.factory.ts`), test `:296`. Donc, en
  production, la passerelle ne démarre pas du tout (cohérent avec OP-N100).
- Central : chaque faux est rattaché à un démarrage réel ou à une suite existante (`:384-440`) ; le faux `EDGE_CA` refuse le
  processus `edge` en production (`:442`, `FakeInProductionError`).
- Limite : la liste des mots de passe de test (`TEST_SECRETS`) est non exhaustive ; un mot de passe faible hors liste est
  accepté (assumé par le commentaire, `startup-guard.ts`).

## 8. Fichiers à faire relire par une personne

Un agent qui a écrit le code ne vaut pas relecture indépendante. `.github/CODEOWNERS` liste déjà ces chemins pour `@atrona8` ;
activer l'option « exiger la revue des propriétaires » pour que la règle soit opposable. Priorité :

1. **Droits de la base et SQL sensible** : `packages/ledger-sql/migrations/0058` (en entier), `0059`, `0060` (garde CL006
   dans `post_transaction`), `0061` (en entier), `0062`, `0063`, `0064`, `0065`, `0066` (fonctions `SECURITY DEFINER`, dont
   `edge_tap_proof`), `0067`, `0068`, `0069`, `0070`, `0071`, `0072` ; `post-roles.sql` §9 ; `apps/gateway/migrations/edge-0001`
   à `edge-0010` (rôle unique `edge_app`, déclencheurs d'ajout seul).
2. **Clés et cryptographie** : `apps/gateway/src/key-store/`, `authority/site-order.ts`, `device/device-token.service.ts`,
   `device/refresh.service.ts`, `device/device-key.ts`, `config/client-key-file.ts`, `operations/offline/pack-crypto.ts`,
   `media-auth-key.service.ts`, `apps/api/src/edge/packs/pack-sealing.ts`, `apps/api/src/edge/ca/`, `apps/api/src/edge/auth/`,
   `packages/shared-rules/src/edge-content.ts`, `edge-chain.ts`.
3. **Purge** : `apps/gateway/src/purge/` (surtout `purge.service.ts`, `purge-trigger.ts`, `admin-tls.ts`), `standby/`.
4. **Autorité et rejeu** : `apps/gateway/src/authority/authority.service.ts`, `queue/drain.service.ts`, `batch-builder.ts`,
   `apps/api/src/debit-authority/`, `payments/payments.service.ts`, `edge/sync/edge-sync.writer.ts` (C1).
5. **CI et image** : `.github/workflows/ledger-tests.yml` (étape de redémarrage de PostgreSQL, balayage Trivy, mot de passe de
   `edge_app`), `apps/gateway/Dockerfile`, `.github/CODEOWNERS`, `tools/contract-stability/check.mjs` et
   `contract-baseline.json` (la liste blanche est modifiable par la même branche : un seul relecteur humain doit la lire).

## 9. Suites à donner (dans l'ordre)

1. Consigner C1 (OP-N122, ADR-188, reports `PROMPTS-A-ENVOYER.md` et `PRD.md`).
2. Attendre le run `ci/m8-gateway-e2e` : `ledger` et `gateway-e2e` verts ; faire relire `fb8e7b2c` et `6af9c68b` par un agent distinct.
3. `spec-kitty-docs-maintain` pour le jalon post-fusion (`docs/06-docs-status.md:165`) ; combler ou expliquer ADR-175 à 181.
4. Au porteur : relâchement de `minItems` (réserve 3), OP-N108 au juriste, relecture humaine (§ 8), règle `main protege`.
