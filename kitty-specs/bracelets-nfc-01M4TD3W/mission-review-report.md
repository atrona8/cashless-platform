# Mission Review Report: bracelets-nfc-01M4TD3W

**Reviewer**: claude (revue post-merge, skill `spec-kitty-mission-review` ; n'a écrit aucun code de la mission)
**Date**: 2026-10-16
**Mission**: `bracelets-nfc-01M4TD3W` — Bracelets NFC (format, clés, lots, cycle de vie)
**Baseline commit**: `cae401d` (`baseline_merge_commit` de `meta.json`, juste avant le squash merge `7b1b8c2`)
**HEAD at review**: `d890861` (local ; branche `feat/bracelets-nfc` jamais poussée, aucune exécution GitHub Actions).
Après le squash : `64c8bdd` (correctif de fusion de `media-public.module.ts`), `2f9d0fd` (Prettier, largeur 100),
`d890861` (documentation seulement).
**WPs reviewed**: WP01..WP20 (20/20 `done`). WP01 à WP19 : un cycle de revue chacun, approuvé. WP20 : 12 cycles,
5 rejets et 8 retours arrière forcés (dont 3 après une approbation), sur décisions du porteur et constats des
relectures (voir RISK-1).

> Limite d'indépendance : implémentation, revues des lots, acceptation et présente revue viennent d'agents Claude
> (acceptation « par délégation du porteur »). Cette revue ne vaut pas relecture humaine (règle 4 de `CLAUDE.md`).

---

## Gate Results

Les portes 1 à 3 du skill visent le dépôt Spec Kitty ; leurs équivalents propres au projet ont été exécutés par
l'orchestrateur sur la branche fusionnée (`2f9d0fd`), et ne sont pas relancés ici.

### Gate 1 — Contract tests
- Commandes équivalentes : `npm run check -w @cashless/contracts` (types TypeScript et Dart = `openapi.yaml`) ;
  `npm run check:generated -w @cashless/ledger-sql` (fichiers `.sql` générés du kit inchangés).
- Exit code : 0 et 0.
- Result: **PASS**.
- Vérification propre à la revue : `git diff main HEAD -- packages/ledger-sql` ne touche que `migrations/0010` à
  `0019`, `tests/tests_*.sql` (nouvelles suites écrites à la main), `post-roles.sql`, `src/migrate.ts` et
  `src/bootstrap-admin.ts` (ce dernier : Prettier seulement). `schema_grand_livre_cashless.sql`, `roles.sql`,
  `tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`, `scenario_reference.json` et les générateurs sont
  inchangés. **Aucun `.sql` généré modifié.**

### Gate 2 — Architectural tests
- Commande équivalente : `test/unit/architecture.spec.ts` (aucun port de clé atteignable depuis l'API publique, droit
  de créer ou désactiver une clé réservé à la commande d'administration, pools par processus, garde de production
  appliquée par chaque point d'entrée), `test/unit/processes.spec.ts`, dans `npm test`.
- Exit code : 0 (Jest 75 suites, 1 246 tests ; lint et typecheck verts).
- Result: **PASS**.

### Gate 3 — Cross-repo E2E
- Sans objet (un seul dépôt). Équivalents : `media-journey.spec.ts` (SC-002, parcours complet par l'API),
  `media-isolation.spec.ts` (39 opérations à deux prestataires), `media-secrets.spec.ts` (NFR-002),
  `media-port-swap.spec.ts` (SC-008), pgTAP 1380/1380 ; tag-format TypeScript 38/38, 1 ignoré.
- Result: **PASS** (équivalent), avec une note : le test ignoré est `kit-vectors.spec.ts` (régénération de
  `vectors.json` par `vecteurs_test_bracelet.py`), sauté faute du module Python `cryptography` sur le poste. Il a été
  exécuté sur la tête de lane (`acceptance-matrix.json`, NFR-001) et `vectors.json`, `scripts/`, le script du kit et
  le paquet Dart sont identiques entre la tête de lane `b658961` et `HEAD` ; en CI il est obligatoire (variable `CI`).
  Dart (30/30) n'a pas été relancé sur la branche fusionnée (aucun fichier Dart modifié depuis la lane).

### Gate 4 — Issue Matrix
- Fichier : absent. `spec.md` ne référence aucune issue GitHub.
- Result: **SANS OBJET**.

---

## FR Coverage Matrix

Contrôles au hasard faits par la revue (au-delà de `acceptance-matrix.json`) : FR-018 (`auth-keys.service.ts`),
FR-019/FR-020 (`tap.service.ts`), FR-031 (`claims.spec.ts:256-286`), NFR-003 (`dek-cache.ts`), NFR-010
(`production-guard.ts`, `kms.module.ts`, modules d'identité, `bootstrap.ts`), FR-036 (comparaison programmatique
d'`openapi.yaml` avant et après). Les tests d'intégration passent par HTTP sur l'application réelle et une vraie base ;
aucun n'a été trouvé qui fabrique à la main la forme attendue.

| FR ID | Description (bref) | WP | Test(s) | Adéquation | Constat |
|---|---|---|---|---|---|
| FR-001 | Format B 1.0 | WP01, WP02 | `format-b.spec.ts`, `format_b_test.dart` | ADEQUATE | — |
| FR-002 | Message de dérivation | WP01, WP02 | `kdf-envelope.spec.ts`, `kdf_envelope_test.dart`, `fake-kms.spec.ts` | ADEQUATE | — |
| FR-003 | Chiffrement de PWD‖PACK | WP01, WP02 | idem | ADEQUATE | — |
| FR-004 | Code de rattachement | WP01, WP02 | `claim-code.spec.ts`, `claim_code_test.dart`, `kms-module.spec.ts` | ADEQUATE | — |
| FR-005 | Deux implémentations conformes | WP01, WP02 | `kit-vectors.spec.ts`, `cross-impl.spec.ts`, `cross_impl_test.dart` | ADEQUATE | régénération ignorée en local (Gate 3) |
| FR-006 | Service de clés substituable | WP08 | `fake-kms.spec.ts`, `kms-module.spec.ts`, `personalization.spec.ts` | ADEQUATE | OP-N41 |
| FR-007 | Clés de bracelet, à deux | WP10 | `keys.spec.ts`, `tests_tag_key_jobs.sql` | PARTIAL | **SEC-1** (à deux dans l'API seulement) |
| FR-008 | Rotation de la clé de données | WP11 | `keys.spec.ts`, `data-keys.spec.ts` | PARTIAL | SEC-1 ; OP-N61 (tranches) |
| FR-009 | Retrait d'une clé dédiée | WP11 | `data-keys.spec.ts`, `keys.spec.ts` | PARTIAL | **SEC-1** |
| FR-010 | Contrôle quotidien | WP19 | `daily-check.spec.ts` | ADEQUATE | — |
| FR-011 | Lots | WP12 | `batches.spec.ts` | ADEQUATE | OP-N60 |
| FR-012 | Cycle de vie d'un lot | WP05, WP12 | `batches.spec.ts`, `tests_media_reinstate.sql` | ADEQUATE | OP-N60 |
| FR-013 | Clôture et rattrapages | WP12 | `batches.spec.ts`, `claim-code-order.spec.ts` | ADEQUATE | OP-N61 |
| FR-014 | Inventaire | WP12 | `batches.spec.ts` | ADEQUATE | — |
| FR-015 | Codes générés à la commande | WP03, WP12 | `claim-code-order.spec.ts`, `tests_media_claims.sql` | ADEQUATE | OP-N48 |
| FR-016 | Enregistrement d'un bracelet personnalisé | WP13 | `personalization.spec.ts`, `tests_personalization_definer.sql` | ADEQUATE | OP-N46 |
| FR-017 | Association du code à la puce | WP13, WP12 | `personalization.spec.ts`, `claim-code-order.spec.ts` | ADEQUATE | — |
| FR-018 | Mot de passe pour un terminal | WP14 | `auth-keys.spec.ts` | ADEQUATE | OP-N42 |
| FR-019 | Lecture d'un bracelet | WP14 | `taps.spec.ts` | ADEQUATE | OP-N42 |
| FR-020 | Effets de sécurité durables | WP14 | `taps.spec.ts`, `deposit.spec.ts`, `release.spec.ts` | ADEQUATE | — |
| FR-021 | Activation | WP15 | `activation.spec.ts`, `claims.spec.ts`, `tests_event_wallet.sql` | ADEQUATE | DRIFT-2 (contrat) |
| FR-022 | Caution | WP15 | `deposit.spec.ts` | ADEQUATE | OP-N49 |
| FR-023 | Prise d'une caution due | WP15 | `deposit.spec.ts` | ADEQUATE | — |
| FR-024 | Consultation d'un bracelet | WP15 | `activation.spec.ts`, `architecture.spec.ts` | ADEQUATE | — |
| FR-025 | Restitution et réattribution | WP16 | `release.spec.ts` | ADEQUATE | OP-N51, ADR-93 |
| FR-026 | Espèces dues | WP16 | `cash-due.spec.ts` | ADEQUATE | OP-N49, OP-N55 |
| FR-027 | Remplacement | WP16 | `replace.spec.ts` | ADEQUATE | OP-N55 ; DRIFT-2 (contrat) |
| FR-028 | Perte et bracelet retrouvé | WP16 | `replace.spec.ts` | ADEQUATE | — |
| FR-029 | Liste noire, sortie à deux | WP05, WP18, WP20 | `blacklist.spec.ts`, `tests_media_reinstate.sql` | ADEQUATE | OP-N56 |
| FR-030 | Rattachement par code | WP17 | `claims.spec.ts`, `media-isolation.spec.ts`, `tests_media_claims.sql` | ADEQUATE | OP-N43 |
| FR-031 | Limites d'essais | WP17 | `claims.spec.ts` | ADEQUATE | — |
| FR-032 | Confirmation au guichet | WP17 | `claims.spec.ts`, `tests_media_claim_tap.sql` | ADEQUATE | OP-N50 |
| FR-033 | Consultation anonyme | WP17 | `claims.spec.ts`, `claims-address-limit.spec.ts` | ADEQUATE | ADR-90, ADR-95 |
| FR-034 | Identités substituables | WP08, WP20 | `media-port-swap.spec.ts`, `identity-guards.spec.ts` | ADEQUATE | OP-N42, OP-N43 |
| FR-035 | Audit et historique | toutes | suites de chaque module, `tests_media_reinstate.sql` | ADEQUATE | OP-N56 (attribution) |
| FR-036 | Contrat d'API et types | WP07 | `check -w @cashless/contracts`, `media-isolation.spec.ts` | ADEQUATE | DRIFT-2 |

| NFR | Seuil | Preuve | Adéquation | Constat |
|---|---|---|---|---|
| NFR-001 | 100 % des vecteurs, deux langages, CI | tag-format TS, Dart 30/30 (lane) | ADEQUATE | CI jamais exécutée (RISK-2) |
| NFR-002 | aucun secret en clair au repos | `media-secrets.spec.ts` (avec contrôle du contrôle) | ADEQUATE | OP-N54 |
| NFR-003 | secret en mémoire borné, 1 déchiffrement | `dek-cache.spec.ts`, `auth-keys.spec.ts`, `data-keys.spec.ts` | ADEQUATE | durée absolue (plus strict que « sans utilisation ») |
| NFR-004 | isolation entre prestataires | `media-isolation.spec.ts`, RLS forcée sur les 5 nouvelles tables | ADEQUATE | OP-N59 |
| NFR-005 | séparation des droits sur les clés | `architecture.spec.ts`, `tests_media_roles.sql` | PARTIAL | **SEC-1**, OP-N45 |
| NFR-006 | latence | `media-latency.spec.ts` sur 100 000 bracelets (p95 16/25/65 ms) | ADEQUATE | mesure côté client |
| NFR-007 | pas d'énumération | `claims-timing.spec.ts` (écart 0,2 ms) | ADEQUATE | — |
| NFR-008 | tranches, 5 000 bracelets | 600 cautions, 1 200 rechiffrements, 3 préchargements | PARTIAL | OP-N61 (consigné) |
| NFR-009 | tests existants verts | pgTAP 1380, Jest 1246 | ADEQUATE | — |
| NFR-010 | aucun faux en production | `production-guard.spec.ts`, `processes.spec.ts` | ADEQUATE | RISK-3 (définition de la production) |

---

## Constats de sécurité (règle 4 de `CLAUDE.md`)

### SEC-1 (BLOQUANT, non consigné) : la règle « à deux » des actions de clé n'est tenue que par l'API publique ; la file `tag_key_job` est écrite librement par `cashless_app`

**Type**: écart affaiblissant la sécurité non consigné (ADR-83, SC-007, `contracts/key-services.md`)
**Severity**: HIGH
**Location**: `packages/ledger-sql/migrations/0012_tag_key_jobs.sql` (aucun contrôle d'insertion ; `approval_request_id`
facultatif), `packages/ledger-sql/post-roles.sql` (seul `UPDATE` est borné pour `cashless_app` ; `INSERT` de `roles.sql`
gardé), `apps/api/src/media/keys/key-admin.worker.ts:40-119`, `apps/api/src/media/keys/dek.worker.ts:40-109`.

**Evidence**:
- ADR-83 : « Une faille de l'API publique n'atteint aucune opération de clé ». `contracts/key-services.md` :
  `CREATE_KEY` est « créé par approbation `TAG_KEY_CREATE` », `RETIRE_KEY` par `TAG_KEY_RETIRE`, `DISABLE_KMS_KEY`
  « par `RETIRE_KEY` ». SC-007 : aucune création, rotation ou aucun retrait de clé effectif avec une seule personne.
- Aucun exécutant ne vérifie la demande d'approbation : ni `KeyAdminWorker` (`CREATE_KEY`, `DISABLE_KMS_KEY`) ni
  `DekWorker` (`ROTATE_DEK`, `RETIRE_KEY`) ne lisent `approval_request` ; `disableKey` ne vérifie pas non plus que la
  clé est `RETIRED`.
- Démonstration en base (transaction annulée, puis `reset-db`) :
  ```sql
  SET LOCAL ROLE cashless_app; SELECT set_config('app.operator_id', '<prestataire>', true);
  INSERT INTO tag_key_job (operator_id, key_index, kind) VALUES ('<prestataire>', 1, 'DISABLE_KMS_KEY');
    -- DISABLE_KMS_KEY | PENDING | approval_request_id NULL
  SET LOCAL ROLE cashless_keyadmin;
  SELECT kind, status FROM claim_tag_key_job_for(ARRAY['<prestataire>']::uuid[], ARRAY['CREATE_KEY','DISABLE_KMS_KEY']);
    -- DISABLE_KMS_KEY | RUNNING  (sur une clé PARTAGÉE ACTIVE)
  ```
  `RETIRE_KEY` et `CREATE_KEY` s'insèrent de même depuis `cashless_app`.

**Analysis**: avec la connexion de l'API compromise (défaut d'une autre route, injection), c'est-à-dire le modèle de
menace retenu pour OP-N52 et OP-N60, une seule personne, voire aucune, fait :
- désactiver dans le KMS la clé de dérivation d'une série **active** au prochain passage de la commande
  d'administration (`--once` exécute tout ce qui attend, sans confirmation par travail). Plus aucune personnalisation
  ni aucun contrôle quotidien sur cet index, alors que la clé n'est pas retirée en base ;
- retirer une clé dédiée (mots de passe effacés, bracelets en fin de vie) sans décision à deux ; `retire_dedicated_key`
  exige quand même des lots clos ;
- créer des clés et basculer la clé partagée active en `DECRYPT_ONLY`.

La RLS limite cela au prestataire de la session, que la session choisit. Les tests pgTAP (`tests_media_roles.sql`) ne
couvrent que les rôles des processus des clés, pas `cashless_app`. La relecture de WP10 (« aucune clé ni travail créés
par une seule personne ») ne l'a vérifié que par l'API, et la recherche d'OP-N60 (« Les rôles des processus des clés
n'ont plus de cas ; restent ceux du rôle de l'API ») ne nomme pas `tag_key_job`. Aucune fiche OP ni aucun ADR ne
consigne cette limite. **Règle 4 : constat bloquant.** Règle 1 : à soumettre au porteur avant tout codage, avec trois
options :
- (A) consigner : OP-N62, ADR, mission de levée, test qui fige les droits d'`INSERT` de `cashless_app` sur `tag_key_job` ;
- (B) corriger en base : politique restrictive d'`INSERT` pour `cashless_app` exigeant une `approval_request` APPROVED
  de l'action et du prestataire concordants, refus de `DISABLE_KMS_KEY` sans parent `RETIRE_KEY` et sans `tag_key`
  `RETIRED` ;
- (C) faire vérifier l'approbation par les exécutants, en défense en profondeur.

### Liste des écarts de sécurité ouverts (OP-N41 à OP-N61, ADR-83 à ADR-101)

Fiches lues dans `docs/POINTS_OUVERTS.md` et `docs/DECISIONS_ADR.md` à `d890861`.

| Point | Sujet | ADR | Bloque la production | Levé par | Test qui borne la limite |
|---|---|---|---|---|---|
| OP-N41 | KMS : faux seulement (graine dans le code) | ADR-88, ADR-101 | **Oui** | Mission 7 (après OP-N11) | `production-guard.spec.ts`, `processes.spec.ts` |
| OP-N42 | Identité du terminal : faux qui croit des en-têtes ; requêtes non signées | ADR-88 | **Oui** | Mission 5 | idem |
| OP-N43 | Identité du festivalier : faux | ADR-88 | **Oui** | Mission 10 | idem |
| OP-N44 | `EXECUTE` hérité de `PUBLIC` pour les 4 rôles des processus des clés | ADR-84, ADR-101 | Non (limite acceptée) | Mission 5 (avec OP-N59) | `tests_media_roles.sql` |
| OP-N45 | Aucun aiguillage des routes vers leur processus | ADR-83, ADR-101 | **Oui** | Mission 13 (recette V1) | `media-isolation.spec.ts` |
| OP-N46 | Signature NXP vérifiée par le poste seulement | ADR-85, ADR-101 | Non | Mission 12 | — |
| OP-N47 | Rotation de `CLAIM_CODE_HMAC_KEY` non outillée | ADR-87 | Non | « Exploitation » (aucune mission : voir NOTE-1) | — |
| OP-N48 | Fichier de commande perdu : pas de réémission | — | Non | Agent, à revoir en exploitation | — (disponibilité, pas un affaiblissement) |
| OP-N49 | Caution et espèces dues sans caisse (`409`) | ADR-89 | **Oui** | Mission « Recharges, caisses et PSP » | `deposit.spec.ts`, `cash-due.spec.ts` |
| OP-N50 | Lecture qui a confirmé une demande encore utilisable par `consume_tap` | ADR-90, ADR-101 | Non (limite acceptée) | Mission 5 | `tests_media_claim_tap.sql` |
| OP-N51 | Guichet de retour sans enchaînement (`422`) | ADR-91 | Non | Mission 9 | `release.spec.ts` (fonctionnel) |
| OP-N52 | Valideur de sortie de liste noire non vérifié par la base | ADR-94 | **Levé** (0017-0019), reste OP-N56 | — | `tests_media_reinstate.sql` |
| OP-N53 | Limite par adresse sans `trust proxy` | ADR-95 | **Levé** (`TRUST_PROXY_HOPS`) | Exploitation : valeur du déploiement | `claims-address-limit.spec.ts`, `config.spec.ts` |
| OP-N54 | `request_hash` SHA-256 sans clé contenant le code imprimé | ADR-99 | Non | Mission 5 | `media-secrets.spec.ts` |
| OP-N55 | Espèces dues non transférées au remplacement | ADR-100 | Non | Mission 9 | — (opération absente) |
| OP-N56 | La base n'authentifie pas qui décide une approbation | ADR-94 | Non (limite acceptée) | Mission 11 | `tests_media_reinstate.sql`, `blacklist.spec.ts` |
| OP-N57 | `offline_snapshot` : version plantée, déni de service | — (fiche OP) | **Oui** | Mission 7 | `tests_definer_trigger_writers.sql` |
| OP-N58 | `offline_policy_history` falsifiable | — (fiche OP) | **Oui** | Mission 7 | `tests_definer_trigger_writers.sql` |
| OP-N59 | 77 fonctions SECURITY DEFINER sans `pg_temp` | ADR-96 | **Oui** | Mission 5 | `tests_definer_trigger_writers.sql` (≤ 77) |
| OP-N60 | Écritures directes de `cashless_app` sur `media_batch` et `media.status` | ADR-97 | **Oui** | Mission 11 | `tests_definer_trigger_writers.sql` |
| OP-N61 | NFR-008 non prouvée sur 5 000 bracelets | ADR-98 | **Oui** | Mission 13 | aucun (manque de preuve, justifié) |
| **SEC-1** | **File `tag_key_job` écrite sans approbation par `cashless_app`** | **aucun** | à décider (proposé : **Oui**) | **à décider** | **aucun** |

Sans OP propre : ADR-86 (mot de passe jamais en clair), ADR-92 (contrôle quotidien par audit) et ADR-93 (route
`reassignPoolMedia`) sont des décisions sans dette. ADR-91 point 3 (jeton sur place au-delà de
`cash_refund_single_max` seulement) est conforme à FR-026, §8.5 et ADR-53. Le porteur a annulé le 15/10 la demande de
le durcir (WP20, cycle 4) : ce n'est pas un écart. OP-N57 et OP-N58 sont antérieurs à la mission (kit) et n'ont pas
d'ADR propre, seulement leur fiche complète. C'est acceptable puisqu'ils ne sont pas des écarts de la mission, mais à
noter pour la règle 3.

---

## Drift Findings

### DRIFT-1 : la fusion a cassé un fichier et retiré une décision de `research.md`

**Type**: CROSS-WP-INTEGRATION (fusion)
**Severity**: LOW
**Evidence**: `git diff b658961 7b1b8c2 -- apps packages` : seul `apps/api/src/media/media-public.module.ts` diffère
(décorateur inséré au milieu des imports, deux imports perdus), rétabli par `64c8bdd`. Après ce correctif, le code de
`HEAD` est identique à la tête approuvée de la lane, au reformatage près. `kitty-specs/…/research.md` : la ligne de la
décision n° 9 (`EXECUTE` hérité de `PUBLIC`) a disparu dans le squash (présente à `cae401d` et à `b658961`).
**Analysis**: le squash `7b1b8c2` ne compilait pas. Le correctif est vérifié. La décision n° 9 reste consignée en
ADR-84 et OP-N44, donc la perte est seulement documentaire. À rétablir dans `research.md`.

### DRIFT-2 : routes déjà décrites au contrat modifiées sans ADR

**Type**: LOCKED-DECISION (FR-036 : « celles déjà décrites servies telles quelles » ; §0.3 : contradiction à signaler)
**Severity**: MEDIUM
**Evidence**: comparaison programmatique d'`openapi.yaml` entre `cae401d` et `HEAD` : 132 → 159 opérations, aucune
retirée, 27 ajoutées, 3 existantes modifiées. `activateMedia` (`tap_id` → `tap` embarqué obligatoire ; `tap_id`
déprécié, seul il est refusé en `422`), `replaceMedia` (`new_media_tap_id` → `new_media_tap`, plus `403`, `422`,
`security`), `lookupBalanceByClaimCode` (réduite, ADR-90). Schémas : `CashDueRefundRequest` (`cash_session_id` n'est
plus obligatoire, ADR-89), `StaffRole` (+`PERSONALIZER`, ADR-85).
**Analysis**: la cause est réelle. Un bracelet jamais activé n'a pas de `tap_id` (`register_tap` répond
`NOT_ACTIVATED` sans enregistrer de lecture), donc le contrat contredisait le schéma de référence, qui prime. La
contradiction est expliquée dans la description de l'opération, mais aucune ADR, aucune fiche ni `06-docs-status.md` ne
la consigne (`new_media_tap` est introuvable dans `docs/` et `kitty-specs/`). Le changement n'affaiblit pas la
sécurité, la lecture étant vérifiée dans la transaction. En revanche, il casse le contrat pour l'app terminal et doit
être tracé.

### DRIFT-3 : écarts documentés (information)

**Severity**: LOW
**Evidence**: migrations `0014` à `0019` en plus du plan (`0010`-`0013`) ; 27 opérations nouvelles au lieu
d'« environ 20 » ; `reassignPoolMedia` (ADR-93) ; consultation anonyme réduite (ADR-90) ; durée de cache absolue au
lieu de « sans utilisation » (plus strict). Tous sont consignés dans `06-docs-status.md` et les ADR, et vont vers plus
de contrôle.

---

## Risk Findings

### RISK-1 : relecture indépendante limitée, WP20 très contesté

**Type**: PROCESS
**Severity**: MEDIUM
**Location**: `status.events.jsonl` (WP20 : 102 événements, 5 rejets, 8 retours forcés), `tasks/WP20-*/review-cycle-*.md`
**Analysis**: tous les relecteurs sont des agents. Les cycles 3 à 8 de WP20 ont révélé des contournements successifs,
chacun démontré en base : historique réécrivable, ligne d'historique plantée, `cashless_perso` élargi par 0018,
`register_personalized_media` sans contrôle de lot. Leur densité indique que la surface des droits de la base n'a pas
été couverte de façon exhaustive : SEC-1 en est un reste. Une relecture humaine des droits (`post-roles.sql`) et
des fonctions SECURITY DEFINER s'impose avant la production.

### RISK-2 : CI jamais exécutée

**Type**: CROSS-WP-INTEGRATION
**Severity**: MEDIUM
**Spec reference**: NFR-001, NFR-009 (« en CI à chaque commit »)
**Analysis**: la branche n'est pas poussée. `ledger-tests.yml` a gagné le pas Dart, la régénération obligatoire des
vecteurs (Python `cryptography==44.0.3`), quatre rôles de base et des mesures isolées : rien de cela n'a tourné sur
GitHub. À lever au premier push.

### RISK-3 : la garde « aucun faux en production » dépend de `NODE_ENV=production` seulement

**Type**: BOUNDARY-CONDITION
**Severity**: MEDIUM
**Location**: `apps/api/src/config/config.ts:172` (`production = env.NODE_ENV === 'production'`)
**Trigger condition**: un déploiement avec `NODE_ENV` absent ou différent (`staging`, `prod`).
**Analysis**: tout autre valeur démarre avec le faux KMS (graine publique), le faux terminal et le faux festivalier,
qui croient des en-têtes `X-Test-*`, ainsi qu'avec le secret de test `CLAIM_CODE_HMAC_KEY` et `TRUST_PROXY_HOPS=0`.
C'est conforme à la lettre du contrat (`key-services.md` : « si `NODE_ENV=production` ») et à la convention des
missions 1 à 3, donc ce n'est pas un écart. La garde reste toutefois en échec ouvert. Piste : refuser le démarrage
quand des marqueurs de production sont présents (URL de base distante, `OIDC_*` réels) et que les faux sont branchés,
ou exiger un drapeau explicite pour les faux.

### RISK-4 : valeurs de production vides non refusées au chargement

**Type**: BOUNDARY-CONDITION
**Severity**: LOW
**Location**: `config.ts` (`tagWrappingKeyRef` vaut `''` en production ; `claimCodeDomain` vaut `''`, refusé plus tard
par `claim-codes.service.ts:50`)
**Analysis**: sans effet aujourd'hui, puisque le KMS ne se construit pas en production. À valider au démarrage quand
l'adaptateur AWS arrivera (mission 7).

---

## Silent Failure Candidates

| Emplacement | Condition | Résultat | Impact |
|---|---|---|---|
| `processes/bootstrap.ts` `optional()` | résolution d'un fournisseur en erreur | `null` (la garde l'ignore) | Aucun en pratique : les fabriques des faux lèvent déjà en production, avant la garde |
| `daily-check.service.ts` `openDek` | `KmsKeyError` | `null`, l'écart est compté | Documenté (ADR-92), corrigé et testé au cycle 2 de WP20 |
| `serve()`, travailleurs à intervalle | erreur d'un passage | `console.error`, puis passage suivant | Les travaux en échec restent `FAILED`, visibles dans `listTagKeyJobs` |

---

## Security Notes

| Constat | Emplacement | Classe | Recommandation |
|---|---|---|---|
| SEC-1 : file de travaux de clé sans approbation vérifiée | `0012`, `post-roles.sql`, workers | contournement de la règle à deux | **Bloquant** : soumettre au porteur (options A/B/C) |
| `cashless_tagcheck_keys` : `FOR SELECT … USING (true)` sur `tag_key` | `post-roles.sql` | cloisonnement (processus privilégié) | Lecture tous prestataires, voulue pour le contrôle quotidien ; pas de secret dans `tag_key`. À dire dans ADR-84 |
| Enveloppe ECDH : HKDF sans sel, `info` = AAD, clé éphémère hors de l'`info` | `tag-format/src/device-envelope.ts` | cryptographie | Sûr avec GCM et une clé éphémère par message ; à faire confirmer par l'auditeur (lier `epk` dans `info` est l'usage ECIES) |
| Délai constant de 80 ms sur `MEDIA_UNKNOWN` seulement | `auth-keys.service.ts` | canal temporel | Un déchiffrement hors cache peut dépasser 80 ms ; la spécification n'exige que la même réponse |
| Secrets de test dans la CI | `ledger-tests.yml` | secrets | Valeurs de test, sans usage ailleurs : acceptable |
| Aucune suppression de règle de lint ou de type, aucun test désactivé (hors `kit-vectors` sans Python, obligatoire en CI) | code ajouté | — | — |

### Fichiers à faire relire par une personne (clés, droits de la base, cryptographie)

- **Droits de la base** : `packages/ledger-sql/post-roles.sql` (en priorité) ; `packages/ledger-sql/src/migrate.ts`
  (mots de passe des rôles, ordre `roles.sql` puis `post-roles.sql`) ; migrations `0010_media_claims.sql`,
  `0011_personalizer_role.sql`, `0012_tag_key_jobs.sql`, `0014_tag_key_job_scope.sql` (politiques de `tag_key_job`,
  SEC-1), `0016_media_claim_tap.sql`, `0017_media_reinstate_approval.sql`, `0018_status_history_definer.sql`,
  `0019_personalization_definer.sql` (fonctions SECURITY DEFINER), ainsi que `0013_media_api.sql` et
  `0015_event_wallet.sql`.
- **Clés et KMS** : `apps/api/src/kms/{kms.ports,kms.module,production-guard,claim-hash,zeroize}.ts` ;
  `apps/api/src/media/keys/{dek-cache,session-data-key,data-key.repository,dek.worker,reencrypt.worker,key-admin.worker,key-approval-actions}.ts` ;
  `apps/api/src/media/auth-keys/auth-keys.service.ts` ; `apps/api/src/media/personalization/personalization.service.ts` ;
  `apps/api/src/media/daily-check/daily-check.service.ts` ; `apps/api/src/processes/{bootstrap,process-base}.ts` ;
  `apps/api/src/db/process-db.module.ts` ; `apps/api/src/config/config.ts`.
- **Cryptographie** : `packages/tag-format/src/{format-b,kdf,envelope,device-envelope,claim-code}.ts` et
  `packages/tag-format/dart/lib/src/{format_b,kdf,envelope,claim_code}.dart` (plus `pubspec.lock`, avec
  `pointycastle`).

---

## Final Verdict

**FAIL**

### Verdict rationale

La fidélité fonctionnelle est bonne. Les 36 exigences fonctionnelles ont une chaîne spec → lot → test → code par des
tests qui exercent l'application réelle et la vraie base. NFR-001 à NFR-007, NFR-009 et NFR-010 sont tenues.
NFR-008 est partielle mais consignée (OP-N61). Aucun `.sql` généré n'a été modifié. Aucun faux n'est constructible ni
démarrable avec `NODE_ENV=production`. Les portes équivalentes sont vertes sur le code fusionné. En revanche, la revue
a trouvé et démontré en base un écart de sécurité **non consigné** (SEC-1) : la règle « à deux » de la création, du
retrait et de la désactivation des clés n'est tenue que par l'API publique. La file `tag_key_job`, que la connexion de
l'API écrit librement, est exécutée par les processus des clés sans vérification d'approbation. Cela contredit
ADR-83 et SC-007 sous le modèle de menace que la mission applique elle-même (OP-N52, OP-N60). La règle 4 de
`CLAUDE.md` en fait un constat bloquant. Le verdict passe à **PASS WITH NOTES** dès que SEC-1 est soit consigné
(OP, ADR, mission de levée, test qui fige la limite, reports dans `PROMPTS-A-ENVOYER.md` et `PRD.md`), soit corrigé,
sur décision du porteur (règle 1).

### Open items (non-blocking)

1. DRIFT-2 : ADR ou fiche pour le changement de `activateMedia` et `replaceMedia` (lecture embarquée), signalé comme
   contradiction §0.3.
2. NOTE-1 : OP-N47 (rotation du secret des codes) n'a pas de mission de levée ni de report dans
   `PROMPTS-A-ENVOYER.md` et `PRD.md` (règle 3). Mineur : le statut d'ADR-99 dit à la fois « confirmée » et « mission
   à confirmer ».
3. DRIFT-1 : rétablir la décision n° 9 dans `research.md`.
4. RISK-2 : pousser la branche et obtenir une CI verte, avec le test des vecteurs du kit exécuté.
5. RISK-3, RISK-4 : durcir la définition de la production, et valider `TAG_WRAPPING_KEY_REF` avec l'adaptateur KMS.
6. RISK-1 : relecture humaine des fichiers listés ci-dessus avant la production.

## Retrospective Reminder

Séquence après fusion : revue de mission → rétrospective → constats. `retrospective.yaml` a été capturé à la fusion
(commit `421130b`, `kitty-specs/bracelets-nfc-01M4TD3W/retrospective.yaml`). Pour la relire :

- `spec-kitty retrospect summary` : vue d'ensemble des missions (lecture seule)
- `spec-kitty agent retrospect synthesize --mission bracelets-nfc-01M4TD3W` : propositions (à blanc par défaut ;
  `--apply` pour les appliquer)

## Suivi après la revue (16/10/2026)

**Verdict révisé : PASS WITH NOTES.** Le constat bloquant SEC-1 est corrigé :
- correctif post-fusion n° 1 (`be8594e`, `38b3943`, `00fb6ae`), approuvé par une relecture distincte (`post-merge-fix-1-review.md`) ;
- tests au moment du correctif : pgTAP 1432/1432, Jest 1267/1267.

Ce même correctif traite aussi :
- RISK-3 : `NODE_ENV` est obligatoire ;
- RISK-4 : `TAG_WRAPPING_KEY_REF` et `CLAIM_CODE_DOMAIN` sont exigés en production ;
- DRIFT-2 : ADR-103 ;
- NOTE-1 : ADR-104, avec OP-N47 rattaché à la mission 10.

Les nouveaux points sont consignés selon la règle 3 (`3209eb5`, relu et approuvé ; pgTAP 1439/1439) :

| Point | Statut | Levée |
|---|---|---|
| OP-N62 | Ne bloque pas la production | Mission 5 |
| OP-N63 (ADR-105) | Bloque la production | Mission 5 |
| Délai d'une demande approuvée (ADR-102) | Limite consignée | Mission 5 |

**Restent** :
- RISK-1 : relecture par une personne des fichiers listés ;
- RISK-2 : la CI n'a jamais tourné, la branche n'est pas poussée ;

DRIFT-1 levé le 16/10/2026 : la ligne de la décision n° 9 est rétablie dans `research.md`, identique à `b658961`.
