# Mission Review Report: identite-enrolement-terminaux-01M52R6H

**Reviewer**: claude (revue post-fusion, skill `spec-kitty-mission-review` ; n'a écrit ni le code ni les relectures des lots)
**Date**: 2026-10-21
**Mission**: `identite-enrolement-terminaux-01M52R6H` — Identité et enrôlement des terminaux (mission 5a)
**Baseline commit**: `5c20c630` (`baseline_merge_commit` de `meta.json`, parent du squash `c67ea0f1`)
**HEAD at review**: `35d5e95d` (local ; branche `feat/identite-enrolement-terminaux` jamais poussée, aucune exécution
GitHub Actions). Après le squash : `4a46610f` et `3f644d57` (état Spec Kitty, rétrospective), `a18aff60` (contrat
`openapi.yaml` rétabli, voir ci-dessous), `35d5e95d` (documentation).
**WPs reviewed**: WP01..WP18 (18/18 `done`). Un rejet chacun pour WP03, WP04, WP10 et WP14, puis approbation au cycle 2 ;
les 14 autres lots approuvés au cycle 1. Aucun événement `ReviewerSelfApproval`. Chaque approbation a été enregistrée par
l'orchestrateur avec `--force` (garde `kitty-specs`, accord du porteur du 19/10).

> Limite d'indépendance : implémentation, relectures des lots, acceptation (« par délégation du porteur ») et présente
> revue viennent d'agents Claude. Cette revue ne vaut pas relecture humaine (règle 4 de `CLAUDE.md`).

---

## Vérification de `a18aff60` (contrat rétabli)

- `git diff cc1f0ff6 HEAD -- apps packages .github .npmrc package.json package-lock.json` : **vide**. Le code et le
  contrat de `HEAD` sont exactement ceux de `cc1f0ff6`, tête de `lane-r` testée par l'orchestrateur et relue pour WP18,
  et référence de `acceptance-matrix.json` (`verified_ref`).
- `git diff cc1f0ff6 c67ea0f1` : seul `packages/contracts/openapi.yaml` diffère côté code (1 138 lignes). Le squash
  portait donc un contrat d'avant la mission avec des types générés d'après la mission ; `a18aff60` ne touche que ce
  fichier.
- Hors code, `cc1f0ff6..HEAD` n'ajoute que de la documentation et des artefacts Spec Kitty (matrice, rétrospective,
  `status.*`, `baseline-tests.json`, docs de `docs/` et de la mission). Rien n'a été retiré de `research.md`, `plan.md`,
  `data-model.md` ni des contrats de la mission (contrôlé fichier par fichier).
- Contrôle refait par la revue : `node scripts/check.mjs` (paquet `@cashless/contracts`) à `HEAD` → « types à jour »,
  code 0. Le journal `feat-contracts.log` de l'orchestrateur (16:32) montre l'échec d'avant `a18aff60` (« types
  périmés ») : c'est ce contrôle qui a révélé la régression.
- Reste : la tête actuelle de `lane-r` (`fdecaed2`, branche conservée, `retain_branches: true`) porte encore l'ancien
  `openapi.yaml` (diff `fdecaed2 HEAD` = ce seul fichier). Ne pas repartir de cette lane (RISK-1).

---

## Gate Results

Les portes 1 à 3 du skill visent le dépôt Spec Kitty. Leurs équivalents propres au projet ont été exécutés par
l'orchestrateur sur la branche fusionnée (après `a18aff60`) ; la revue a relancé ce qui ne touche pas la base.

### Gate 1 — Contract tests
- Commandes équivalentes : `npm run check -w @cashless/contracts` (types TypeScript et Dart = `openapi.yaml`) ;
  `npm run check:generated -w @cashless/ledger-sql`.
- Exit code : 0 et 0 (orchestrateur) ; partie TypeScript relancée par la revue à `HEAD` : 0. Le SDK Dart est installé
  sur le poste, donc le contrôle Dart n'est pas passé à vide.
- Result: **PASS**.
- Vérification propre à la revue : `schema_grand_livre_cashless.sql`, `roles.sql`, `scenario_reference.json`,
  `scenario_reference_test.sql` et `gen_golden.py` sont inchangés. Seul fichier généré modifié :
  `tests_grand_livre_cashless.sql` (2 lignes), produit par `gen_tests.py` (sonde `app_probe`, OP-N44) ; cohérent avec
  `check:generated`. **Aucun `.sql` généré modifié à la main.** Voir DRIFT-3 sur le sens de l'assertion modifiée.

### Gate 2 — Architectural tests
- Commande équivalente : `test/unit/architecture.spec.ts`, `test/unit/processes.spec.ts`, `production-guard.spec.ts`,
  dans la batterie Jest.
- Exit code : 0 (Jest 101 suites, 1 704 réussis, 6 ignorés, 0 échec ; lint et typecheck verts). Relancé par la revue,
  sans base : 14 suites unitaires de la mission (signature, identité réelle, jetons, attestations Android et iOS,
  autorité, configuration, garde de production, empreintes), 298/298.
- Result: **PASS**.

### Gate 3 — Cross-repo E2E
- Sans objet (un seul dépôt). Équivalents : `device-journey.spec.ts` (SC-001), `device-auth-matrix.spec.ts` (NFR-002,
  SC-002, OP-N70), `device-isolation.spec.ts` (NFR-007), `device-secrets.spec.ts` (NFR-005), `device-latency.spec.ts`
  (NFR-001, NFR-009) ; pgTAP 2072/2072 ; mesures en série 41/41 (NFR-006 écart 0,0 ms ; NFR-009 surcoût p95 17,35 ms,
  enrôlement 63 ms, configuration 42 ms, battement 44 ms).
- Result: **PASS** (équivalent), avec la note de RISK-1 : la CI GitHub n'a jamais tourné.

### Gate 4 — Issue Matrix
- Fichier : absent ; `spec.md` ne cite aucune issue GitHub.
- Result: **SANS OBJET**.

---

## FR Coverage Matrix

Contrôles faits par la revue en plus de `acceptance-matrix.json` (37 critères, tous `pass`, vérifiés sur `cc1f0ff6`) :
lecture complète de `real-device-identity.ts`, `request-signature.ts`, `device.guard.ts`, `nonce-store.ts`,
`device-token.service.ts`, `refresh.service.ts`, `enrollment.service.ts`, `android-key-attestation.ts`,
`google-revocation-cache.ts`, `enrollment-challenge.ts`, `device-ca.port.ts`, `device-admin.service.ts`, des migrations
`0022` et `0023`, et du diff de `post-roles.sql`, `bootstrap.ts`, `production-guard.ts`, des services de la mission 4.
Les tests d'intégration passent par HTTPS mTLS réel, le terminal de test et une vraie base ; aucun n'a été trouvé qui
fabrique à la main la forme attendue.

| FR ID | Description (bref) | WP | Test(s) | Adéquation | Constat |
|---|---|---|---|---|---|
| FR-001 | Code d'enrôlement | WP03, WP14 | `enrollment-codes.spec.ts`, `tests_device_enrollment.sql` | ADEQUATE | DRIFT-1 (événement clos) |
| FR-002 | `PAIRED_TPE` refusé | WP03, WP14 | idem, contrainte de table | ADEQUATE | refus à l'enrôlement par construction |
| FR-003 | Enrôlement | WP14 | `enrollment.spec.ts` | ADEQUATE | — |
| FR-004 | Consommation atomique du code | WP03, WP14 | `enrollment.spec.ts` (20 simultanés), pgTAP | ADEQUATE | — |
| FR-005 | Attestation Android | WP10 | `unit/attestation/android.spec.ts` | ADEQUATE | OP-N67 ; RISK-4 (appareils réels) |
| FR-006 | Attestation iOS | WP11 | `unit/attestation/ios.spec.ts` | ADEQUATE | OP-N64 |
| FR-007 | `serial` et ré-enrôlement | WP03, WP14 | `device-isolation.spec.ts`, `device-journey.spec.ts` | ADEQUATE | ADR-109 |
| FR-008 | Clé d'accord à l'enrôlement seulement | WP03, WP07 | `tests_device_rights.sql` §1, §2 | ADEQUATE | RISK-3 (confiance de la base dans l'API) |
| FR-009 | Certificat client | WP09 | `unit/device-ca.spec.ts`, `enrollment.spec.ts` | ADEQUATE | OP-N73 |
| FR-010 | Jeton d'appareil lié | WP09, WP12 | `unit/device-token.spec.ts` | ADEQUATE | DRIFT-2 (durée réglable) ; OP-N73 |
| FR-011 | Rafraîchissement à rotation | WP04, WP15 | `refresh.spec.ts`, `tests_device_tokens.sql` | ADEQUATE | OP-N65 |
| FR-012 | Trois preuves | WP12, WP18 | `device-auth-matrix.spec.ts`, `real-device-identity.spec.ts` | ADEQUATE | — |
| FR-013 | Identité réelle derrière le port | WP12, WP18 | `media-port-swap.spec.ts`, `device-auth-matrix.spec.ts` | ADEQUATE | DRIFT-4 (SC-007) |
| FR-014 | Statut relu à chaque requête | WP04, WP12 | `device-auth-matrix.spec.ts` (suspendu, révoqué par route) | ADEQUATE | — |
| FR-015 | Suspension et réactivation | WP16 | `admin.spec.ts`, `device-journey.spec.ts` | PARTIAL | remontée des lots non prouvable (aucune route de lots, C-006) |
| FR-016 | Révocation | WP16 | idem, ADR-115 | ADEQUATE | — |
| FR-017 | Liste et consultation | WP16 | `admin.spec.ts` | ADEQUATE | — |
| FR-018 | Configuration servie | WP17 | `config.spec.ts`, `tests_config_served_guard.sql` | ADEQUATE | ADR-118 |
| FR-019 | Battement de cœur | WP17 | `heartbeat.spec.ts` | ADEQUATE | — |
| FR-020 | OP-N59 | WP02, WP07 | `tests_definer_search_path.sql`, `tests_device_rights.sql` §5, `tests_definer_trigger_writers.sql` §4 | ADEQUATE | — |
| FR-021 | OP-N44 | WP07 | `tests_execute_grants.sql` | ADEQUATE | OP-N68 ; DRIFT-3 |
| FR-022 | OP-N50 | WP05 | `tests_consume_tap_claim.sql`, `tap-claim-race.spec.ts` | ADEQUATE | — |
| FR-023 | OP-N54 | WP13, WP18 | `request-hash.spec.ts`, `personalization.spec.ts`, `device-secrets.spec.ts` | ADEQUATE | purge de déploiement à faire |
| FR-024 | OP-N62 | WP06 | `tests_tag_key_retire_guard.sql` | ADEQUATE | — |
| FR-025 | Audit | WP14, WP15, WP16 | `enrollment.spec.ts`, `tests_enrollment_refusal.sql`, `device-journey.spec.ts` | ADEQUATE | OP-N72 |
| FR-026 | Contrat et types | WP01, WP18 | `check -w @cashless/contracts` | ADEQUATE | DRIFT-5 (m2) |

| NFR | Seuil | Preuve | Adéquation | Constat |
|---|---|---|---|---|
| NFR-001 | 0 démarrage avec un faux | `device-latency.spec.ts` (un test par faux), `production-guard.spec.ts` | ADEQUATE | 5 faux couverts (la spec en cite 4) |
| NFR-002 | aucune preuve seule | `device-auth-matrix.spec.ts` (routes lues dans le contrat et dans `DeviceGuard`) | ADEQUATE | — |
| NFR-003 | effet immédiat | `assert_device_active` dans la transaction d'écriture ; matrice | ADEQUATE | — |
| NFR-004 | pas de rejeu | `consume_device_nonce`, matrice (« rejouée ») | ADEQUATE | — |
| NFR-005 | aucun secret en clair | `device-secrets.spec.ts` | ADEQUATE | — |
| NFR-006 | écart médian < 20 ms | mesure en série : 0,0 ms | ADEQUATE | mesure locale |
| NFR-007 | isolation | `device-isolation.spec.ts`, RLS forcée sur les tables S5 | ADEQUATE | — |
| NFR-008 | 1 succès sur 20 | `enrollment.spec.ts`, `refresh.spec.ts` (verrou tenu) | ADEQUATE | précision du porteur du 20/10 |
| NFR-009 | p95 20 ms / 1 s / 200 ms | 17,35 / 63 / 42-44 ms | ADEQUATE | mesure locale, marge faible sur le surcoût |
| NFR-010 | dettes prouvées | témoins et bornes inversées | ADEQUATE | « échouait avant » établi par témoins, pas rejoué sur la base d'avant |
| NFR-011 | suites existantes vertes en CI | pgTAP, Jest | PARTIAL | CI jamais exécutée (RISK-1) |

---

## Constats de sécurité (règle 4 de `CLAUDE.md`)

### Aucun écart affaiblissant non consigné n'a été trouvé

La revue n'a trouvé aucun droit élargi, contrôle retiré ou secret exposé qui ne soit ni consigné ni soumis au porteur.
Les trois points ci-dessous sont soit incomplets dans leur consignation, soit des hypothèses implicites ; aucun n'ouvre
de chemin d'attaque démontré. Ils sont non bloquants, mais à soumettre au porteur (règle 1 pour SEC-2).

### SEC-1 (MEDIUM, consignation incomplète) : ADR-114 n'a ni fiche OP, ni mission de levée, ni report

**Location** : `docs/DECISIONS_ADR.md:1527-1542` ; `post-roles.sql` section 4a (`purge_device_request_nonces`,
`purge_device_enrollment_attempts` accordées à `cashless_app`).
**Analysis** : la décision est un « droit plus large pour l'API, accepté » (texte de l'ADR). Elle a son ADR et un test de
borne (`tests_device_purge_window.sql`). Mais la règle 3 demande aussi une entrée dans `docs/POINTS_OUVERTS.md`, la
mission qui la lève et un report dans `PROMPTS-A-ENVOYER.md` et `PRD.md` : `ADR-114` n'apparaît dans aucun des trois
fichiers. Le risque réel est nul tant que le test tient (une purge ne retire que des lignes hors de leur fenêtre). Même
cas que NOTE-1 de la mission 4 (OP-N47) : non bloquant, à compléter. Si le porteur tient la décision pour définitive
(aucune levée prévue), l'écrire dans l'ADR et dans une fiche OP courte.

### SEC-2 (MEDIUM, hypothèse implicite) : la base croit l'API pour l'attestation et le certificat d'un nouvel enrôlement

**Location** : `packages/ledger-sql/migrations/0022_device_enrollment.sql:348-460` (`enroll_device`), `:248-307`
(`create_device_enrollment_code`, `p_actor` fourni par l'appelant) ; `post-roles.sql` section 4b (`SELECT` de
`device_enrollment_code` laissé à `cashless_app`, `code_hash` compris).
**Trigger condition** : connexion de l'API compromise (modèle de menace retenu pour OP-N52, OP-N60, OP-N63).
**Analysis** : `enroll_device` reçoit l'empreinte du code, les clés publiques, l'empreinte du certificat et le type
d'attestation, et ne peut vérifier ni l'attestation ni le certificat. Avec la connexion de l'API, on lit un `code_hash`
encore valide (ou on crée un code en passant l'identifiant d'un `OPERATOR_ADMIN` existant), puis on crée un terminal
`ACTIVE` avec des clés choisies. Ce terminal reste inutilisable : la garde exige un certificat signé par l'autorité des
terminaux (TLS) et un jeton du signataire, deux clés hors de la base. OP-N63 (réécrire la clé d'accord d'un terminal
existant) est donc bien levé. Mais la phrase d'ADR-105 « par une fonction qui vérifie le code d'enrôlement » protège
peu contre une connexion de l'API compromise, et cette dépendance à l'autorité et au signataire n'est écrite nulle part.
`p_actor` non authentifié est la même limite qu'OP-N56.
**Options** : (A) consigner (une phrase dans ADR-105 et OP-N56 : « la base ne prouve ni l'attestation, ni l'auteur ;
la barrière est l'autorité des terminaux et le signataire ») ; (B) renforcer en plus : `REVOKE SELECT (code_hash)` sur
`device_enrollment_code` pour `cashless_app` (la lecture du code passe déjà par des fonctions SECURITY DEFINER ; vérifier
la route `listDeviceEnrollmentCodes`), avec un test de droits.

### SEC-3 (LOW, fiche à compléter) : OP-N69 ne décrit pas tous les effets des colonnes encore modifiables

**Location** : `docs/POINTS_OUVERTS.md:583-600` ; `post-roles.sql` section 4b.
**Analysis** : la fiche nomme `event_id`, `pos_id`, `next_seq_floor` et `last_seen_at`. Elle ne dit pas que
`personal_phone` et `app_mode` restent modifiables : une connexion de l'API compromise peut retirer la marque
« téléphone personnel » (le hors ligne redevient possible, contre la story 2 scénario 8) ou passer un téléphone
personnel en mode recharge, deux règles que la mission tient à l'émission du code et à l'enrôlement. La règle iOS
(`TOPUP_DESK`, NFC) est tenue par des contraintes de table, donc protégée. Le test de borne (liste exacte des colonnes)
tient ; seul le texte du risque est à compléter.

### Liste des écarts de sécurité ouverts (fiches lues à `35d5e95d`)

| Point | Sujet | ADR | Bloque la production | Levé par | Test qui borne la limite |
|---|---|---|---|---|---|
| OP-N64 | iOS : clé de signature non attestée | ADR-106 | Non | Mission 12 | « borne iOS (OP-N64) » (`device-auth-matrix.spec.ts`, `media-port-swap.spec.ts`) |
| OP-N65 | Grâce de 60 s au rafraîchissement | ADR-108 | Non | Mission 13 | « borne d'OP-N65 » ×3 (`refresh.spec.ts`), `tests_device_tokens.sql` §2 |
| OP-N67 | Android : `attestationApplicationId` lu dans la liste logicielle | ADR-110 | Non | Mission 13 | « borne OP-N67 » (`android.spec.ts`) |
| OP-N68 | Fonction créée hors de `migrate.ts` exécutable par `PUBLIC` | ADR-111 | **À confirmer par le porteur** | Mission 7 | `tests_execute_grants.sql` §4, `migrate-rights.spec.ts` |
| OP-N69 | Neuf colonnes de `device` écrites par l'API | ADR-112 | **À confirmer par le porteur** | Mission 7 | `tests_device_rights.sql` §1 (voir SEC-3) |
| OP-N72 | Enrôlement : pas de limite en amont ; chaîne d'audit de la plateforme sollicitée | ADR-117 | Non | Mission 13 | `tests_enrollment_limits.sql` §3, §5 ; `enrollment-limits.spec.ts` |
| OP-N73 | Autorité des terminaux et signataire des jetons : faux seulement | ADR-119 | **Oui** | Mission 7, avec OP-N41 | `device-latency.spec.ts`, `production-guard.spec.ts` |
| ADR-114 | Purges exécutées par `cashless_app` (droit plus large) | ADR-114 | Non | **aucune** (SEC-1) | `tests_device_purge_window.sql` |
| ADR-117 | `cashless_app` écrit dans la chaîne d'audit de la plateforme (0027) | ADR-117 | Non | Mission 13 (avec OP-N72) | `tests_enrollment_refusal.sql`, `tests_enrollment_limits.sql` |
| ADR-113 | Jeton de la personne (`X-Staff-Authorization`) non couvert par la signature | ADR-113 | Non | — (pas de régression) | — |
| Consigne | Purge des lignes `api_idempotency` antérieures (T + 720 h) | ADR-99, ADR-116 | à appliquer au déploiement | Exploitation | — |
| OP-N66 | Import lent (hors mission, antérieur) | — | À évaluer | Porteur | — |

Sans OP propre et sans affaiblissement : ADR-107 (trois preuves, renforcement), ADR-109 (`serial` par prestataire,
renforcement), ADR-115 (ordre des contrôles pour un terminal révoqué : le refus reste total, seul le détenteur des clés
apprend la révocation), ADR-116, ADR-118 (renforcements). Restent ouverts, hérités de la mission 4 et non touchés :
OP-N41, N43, N45, N49, N57, N58, N60, N61 (bloquent la production), N46, N47, N48, N51, N55, N56.

Dettes déclarées levées, vérifiées contre le code et les tests :

| Point | Preuve dans le code | Test |
|---|---|---|
| OP-N42 | `RealDeviceIdentity` par défaut ; faux seulement avec `DEVICE_IDENTITY_FAKE=1` hors production (`device-identity.module.ts`) ; trois preuves (`real-device-identity.ts:114-228`) | `device-auth-matrix.spec.ts`, `production-guard.spec.ts` |
| OP-N44 | `post-roles.sql` §0 (`REVOKE EXECUTE … FROM PUBLIC`), §4a, §5 listes nommées | `tests_execute_grants.sql` |
| OP-N50 | 0024, 0026 ; `UPDATE (confirmed_tap_id)` retiré | `tests_consume_tap_claim.sql`, `tap-claim-race.spec.ts` |
| OP-N54 | `request_hash` HMAC sous `IDEMPOTENCY_HMAC_KEY` | `request-hash.spec.ts`, `personalization.spec.ts` |
| OP-N59 | 0021 (`pg_temp` en dernier) et `TEMPORARY` retiré | `tests_definer_search_path.sql`, borne passée de 77 à 0 |
| OP-N62 | `retire_dedicated_key_for_job` (0025), `dek.worker.ts:98-106` | `tests_tag_key_retire_guard.sql` |
| OP-N63 | `INSERT` et `UPDATE (agreement_public_key)` retirés à `cashless_app` | `tests_device_rights.sql` §1, §2 (voir SEC-2) |
| OP-N70 | routes du contrat croisées avec celles de `DeviceGuard` | `device-auth-matrix.spec.ts` |
| OP-N71 | chemin concret et appelant dans l'empreinte | `admin.spec.ts` (ADR-116), `idempotency.spec.ts` |

Constats M1 à M3 de la relecture de WP18 : appliqués (OP-N73 et ADR-119 ; `DEVICE_REQUEST_AUTHORITIES` dans ADR-113,
`PROMPTS-A-ENVOYER.md`, `PRD.md` ; OP-N66 et OP-N67 dans la vue d'ensemble).

---

## Drift Findings

### DRIFT-1 : cas limite « événement clos ou annulé, point de vente supprimé » ni livré ni consigné

**Type**: PUNTED (cas limite de la spécification)
**Severity**: MEDIUM
**Spec reference**: `spec.md:189` (« Code lié à un événement clos ou annulé, ou à un point de vente supprimé entre
l'émission et l'enrôlement : enrôlement refusé »).
**Evidence**: `create_device_enrollment_code` ne vérifie que l'existence de l'événement (`0022:282-283`) ;
`check_device_enrollment_code` (`0022:313-342`) et `enroll_device` (`0022:395-410`) ne lisent jamais `event.status` ni
l'état du point de vente. Aucun test (`grep` de « clos », `CLOSED` dans `enrollment.spec.ts`,
`tests_device_enrollment.sql`), aucune ligne de `plan.md`, `research.md`, `contracts/enrollment.md`, de la matrice
d'acceptation ni des fiches OP.
**Analysis**: un code émis pour un événement qui passe `CLOSED` avant son expiration (7 jours au plus) enrôle encore un
terminal affecté à cet événement. Sans route de paiement dans la mission, l'effet immédiat est faible, mais la règle a
disparu sans décision. Le statut `annulé` n'existe pas dans `event_status`, ce qui rend la phrase en partie caduque.
À soumettre au porteur (voir « Points à soumettre »).

### DRIFT-2 : durée du jeton d'appareil réglable jusqu'à 1 h en production

**Type**: LOCKED-DECISION (FR-010, `plan.md:25`, `contracts/device-tokens.md:17`, `openapi.yaml:91, 8845` : 15 min)
**Severity**: LOW
**Evidence**: `apps/api/src/config/config.ts:585-590` : `DEVICE_TOKEN_TTL_SECONDS` de 60 à 3 600 s, obligatoire en
production, sans valeur imposée ; aucun ADR.
**Analysis**: un déploiement peut porter la vie d'un jeton à 60 min sans décision. L'effet reste borné (le jeton seul ne
sert à rien sans la clé et le certificat ; statut et famille relus à chaque requête), mais c'est un élargissement possible
par réglage. Options : fixer la borne haute à 900 s en production, ou consigner le réglage dans un ADR.

### DRIFT-3 : l'assertion « fonctions de bascule exposées » de la suite de référence ne teste plus rien

**Type**: TEST-ADEQUACY
**Severity**: LOW
**Evidence**: `packages/ledger-sql/gen_tests.py:691-698` : la sonde reçoit `GRANT EXECUTE ON FUNCTION
grant_edge_authority(...)`, puis le test vérifie que la sonde peut l'exécuter.
**Analysis**: l'assertion est devenue tautologique. C'est voulu (plus rien n'est hérité de `PUBLIC`, et l'API n'appelle
pas encore cette fonction), et le générateur a été modifié, pas le `.sql` (C-002 tenu). À la mission qui servira la
passerelle : remplacer par `has_function_privilege('cashless_app', 'grant_edge_authority(...)')`.

### DRIFT-4 : SC-007 tenu dans l'esprit, pas à la lettre

**Severity**: LOW (information)
**Evidence**: lignes changées dans des fichiers de la mission 4 : `tap.service.ts:47`, `auth-keys.service.ts:106-112`
(`assert_device_active`), `counter-access.ts:23,65` (`StaffToken()`, `assert_device_active`),
`auth-keys.controller.ts:18` (`nfcOnly`).
**Analysis**: tous ces changements renforcent (R-14, ADR-113, ADR-106, décision du porteur du 20/10) et sont consignés.
SC-007 dit « sans qu'une seule de leurs lignes change, hormis la borne iOS » : la phrase est à mettre à jour.

### DRIFT-5 : documents de planification (information)

**Severity**: LOW
**Evidence**: `analysis-report.md` F1 (`data-model.md:79-80` ne cite pas le verrou consultatif de famille), F2
(`IN_PROGRESS` / `409`), F3 (NFR-001 cite 4 faux, le code en garde 5) ; constat m2 de WP18 non corrigé
(`openapi.yaml:10149-10153`, `DeviceTokenRefreshRequest.signature` accepte la chaîne vide, que le DTO refuse en `400`).
Aucun effet sur la sécurité.

---

## Risk Findings

### RISK-1 : CI jamais exécutée ; lane `r` porteuse de l'ancien contrat

**Type**: CROSS-WP-INTEGRATION
**Severity**: MEDIUM
**Analysis**: la branche n'est pas poussée. `ledger-tests.yml` a gagné les réglages des terminaux, l'historique complet
(`fetch-depth: 0`, exigé par `media-port-swap.spec.ts`), la régénération des types avec `git diff --exit-code` (qui
aurait arrêté la régression de `a18aff60`) et l'étape des mesures en série ; rien n'a tourné sur GitHub. Les mesures de
NFR-006 et NFR-009 sont locales (surcoût p95 à 17,35 ms pour un seuil de 20 ms). Ne pas réutiliser `lane-r` (`fdecaed2`).
À lever au premier push.

### RISK-2 : relecture indépendante limitée, traces des relectures volatiles

**Type**: PROCESS
**Severity**: MEDIUM
**Location**: `kitty-specs/identite-enrolement-terminaux-01M52R6H/tasks/WP*/review-cycle-*.md`.
**Analysis**: tous les relecteurs sont des agents. Treize fichiers de relecture du dépôt n'ont que 11 lignes (verdict
recopié) : WP01, WP02, WP05, WP06, WP08, WP09, WP13, WP16, WP18 et les cycles 2. Le rapport complet de WP18 n'existe que
dans un dossier temporaire (`/private/tmp/.../review-WP18-cycle-1.md`), et six fichiers de relecture ne sont pas suivis
par git. Verser les rapports complets dans le dépôt. Relecture humaine des fichiers listés plus bas avant la production.

### RISK-3 : la base ne prouve ni l'attestation ni l'auteur d'un enrôlement

Voir SEC-2. **Severity**: MEDIUM.

### RISK-4 : attestation Android sur de vrais appareils

**Type**: BOUNDARY-CONDITION
**Severity**: LOW
**Location**: `apps/api/src/attestation/android-key-attestation.ts:298` (`purpose` : inclusion, pas égalité),
`:309-313` (`vendorPatchLevel` et `bootPatchLevel` exigés).
**Analysis**: certains appareils ne remplissent pas `vendorPatchLevel` ou `bootPatchLevel` : refus de vrais terminaux
(échec fermé, disponibilité). Une clé qui a d'autres usages en plus de `SIGN` ou `AGREE_KEY` est acceptée (sans risque
connu, la clé reste matérielle et liée au défi). À vérifier avec la recette sur appareils réels (mission 13, déjà
prévue pour `@peculiar/asn1-android`).

---

## Silent Failure Candidates

| Emplacement | Condition | Résultat | Impact |
|---|---|---|---|
| `enrollment.service.ts:350-358` | écriture de l'essai et de l'audit d'un refus en échec | trace sur `stderr`, refus renvoyé quand même | un refus sans audit ni comptage (limite non incrémentée) si la base refuse l'écriture ; acceptable, à surveiller en exploitation |
| `google-revocation-cache.ts` `refresh()` | liste Google indisponible | `false`, ancienne liste gardée | échec fermé après 24 h (testé) ; jusque-là, une révocation récente de Google n'est pas vue |
| `real-device-identity.ts:241-244` | preuve refusée | `null` puis `401`, raison au journal | voulu (aucune preuve nommée au client) |

---

## Security Notes

| Constat | Emplacement | Classe | Recommandation |
|---|---|---|---|
| SEC-1 : ADR-114 sans OP, sans mission, sans report | `DECISIONS_ADR.md:1527` | consignation | Compléter (règle 3) |
| SEC-2 : base qui croit l'API pour l'attestation et l'auteur | `0022`, `post-roles.sql` §4b | confiance entre couches | Consigner ; option `REVOKE SELECT (code_hash)` |
| SEC-3 : effets de `personal_phone` et `app_mode` absents d'OP-N69 | `POINTS_OUVERTS.md:583` | consignation | Compléter le risque |
| mTLS demandé, pas imposé (`rejectUnauthorized: false`), autorité cliente seule = celle des terminaux, TLS 1.3 | `bootstrap.ts` `tlsServerOptions` | transport | Conforme à R-03 ; la garde exige `socket.authorized` et l'empreinte enregistrée |
| Aucune révocation de certificat au niveau TLS : un certificat révoqué passe le TLS, refusé par le statut en base | `real-device-identity.ts:152-207` | transport | Conforme à FR-016 (statut relu à chaque requête) |
| Certificat émis avant `enroll_device` : un enrôlement perdu laisse un certificat valable pour TLS, inutilisable (empreinte enregistrée nulle part) | `enrollment.service.ts:150-162` | cryptographie | Acceptable ; à revoir avec l'autorité réelle (journal des émissions) |
| Durée du jeton d'appareil réglable jusqu'à 1 h | `config.ts:585-590` | durée de vie | DRIFT-2 |
| Aucune suppression de règle de lint ou de type relevée dans le code de la mission ; 6 tests ignorés connus (Jest) | — | — | — |

### Fichiers à faire relire par une personne (clés, droits de la base, cryptographie)

- **Droits de la base** : `packages/ledger-sql/post-roles.sql` (sections 0, 4a, 4b, 5 en priorité) ;
  `packages/ledger-sql/src/migrate.ts` (une transaction, verrou consultatif) ; `packages/ledger-sql/gen_tests.py` ;
  migrations `0021_definer_search_path.sql`, `0022_device_enrollment.sql` (`enroll_device`, `set_device_status`,
  `device_admin_allowed`, RLS des tables S5), `0023_device_tokens_nonces.sql` (`rotate_device_refresh_token`, verrous),
  `0024_consume_tap_claim.sql`, `0025_tag_key_retire_guard.sql`, `0026_consume_tap_claim_definer.sql`,
  `0027_enrollment_refusal_audit.sql` (écriture dans la chaîne d'audit de la plateforme), `0029_config_served_guard.sql`,
  `0030_enrollment_limit_atomic.sql` ; `tests/tests_enrollment_refusal.sql` (attentes modifiées).
- **Identité des terminaux et cryptographie** : `apps/api/src/device-identity/{real-device-identity,request-signature,device.guard,nonce-store,device-identity.module}.ts` ;
  `apps/api/src/devices/tokens/refresh.service.ts`, `apps/api/src/devices/tokens/refresh.dto.ts` ;
  `apps/api/src/devices/enrollment/{enrollment.service,enrollment.dto,refresh-token}.ts` ;
  `apps/api/src/device-tokens/*` ; `apps/api/src/device-ca/*` ;
  `apps/api/src/attestation/{android-key-attestation,ios-app-attest,enrollment-challenge,google-revocation-cache,attestation.module}.ts` ;
  `apps/api/src/enrollment-code/enrollment-code.ts`.
- **Démarrage, transport et dépendances** : `apps/api/src/processes/bootstrap.ts`, `apps/api/src/kms/production-guard.ts`,
  `apps/api/src/config/config.ts` (réglages des terminaux), `.npmrc`, `package.json` (`overrides` `@peculiar/*`).
- **Idempotence et droits applicatifs** : `apps/api/src/idempotency/{request-hash,idempotency.interceptor}.ts`,
  `apps/api/src/media/personalization/{personalization.dto,personalization.service}.ts`,
  `apps/api/src/devices/admin/device-admin.service.ts` (`deviceScope`).

---

## Final Verdict

**PASS WITH NOTES**

### Verdict rationale

La fidélité est bonne. Les 26 exigences fonctionnelles ont une chaîne spec → lot → test → code par des tests qui
passent par HTTPS mTLS réel, le terminal de test et la vraie base. FR-015 est partielle pour une raison consignée
(aucune route de lots, C-006). NFR-001 à NFR-010 sont tenues ; NFR-011 attend la CI. Les sept dettes déclarées levées
(OP-N42, N44, N50, N54, N59, N62, N63) et OP-N70, OP-N71 le sont dans le code, chacune avec son test. Aucun `.sql`
généré n'a été modifié à la main. Aucun faux ne démarre en production, et le démarrage est refusé tant que l'autorité et
le signataire n'ont pas d'adaptateur réel (OP-N73, consigné). Le contrat de `HEAD` est celui de la lane testée
(`a18aff60` vérifié) ; le reste du code est identique à `cc1f0ff6`. La revue n'a trouvé aucun écart de sécurité non
consigné (règle 4) ni aucun constat CRITICAL ou HIGH. Les constats MEDIUM (DRIFT-1, SEC-1, SEC-2, RISK-1, RISK-2) ne
bloquent pas la fusion, mais DRIFT-1 et SEC-2 demandent une décision du porteur.

### Open items (non-blocking)

1. DRIFT-1 : décision du porteur sur le cas « événement clos » (corriger, consigner pour la mission 5b, ou retirer la phrase).
2. SEC-1 : compléter ADR-114 (fiche OP, mission ou mention « définitif », reports).
3. SEC-2 : consigner la confiance de la base dans l'API à l'enrôlement ; option de renforcer `code_hash`.
4. SEC-3 : compléter le risque d'OP-N69 (`personal_phone`, `app_mode`).
5. OP-N68 et OP-N69 : la colonne « bloque la production » reste « à confirmer par le porteur ».
6. DRIFT-2 : borne haute du jeton d'appareil à 900 s en production, ou ADR.
7. RISK-1 : pousser la branche, CI verte (dont la régénération des types et les mesures en série) ; ne pas réutiliser `lane-r`.
8. RISK-2 : verser les rapports de relecture complets dans le dépôt ; relecture humaine des fichiers listés.
9. DRIFT-3, DRIFT-4, DRIFT-5, RISK-4 : à reprendre par les missions concernées (passerelle, mise à jour de SC-007, documents de planification, recette sur appareils réels).
10. Consigne de déploiement : purge des lignes `api_idempotency` antérieures à T + 720 h (OP-N54, OP-N71).

## Retrospective Reminder

Séquence après fusion : revue de mission → rétrospective → constats. `retrospective.yaml` a été capturé à la fusion
(commit `3f644d57`, `kitty-specs/identite-enrolement-terminaux-01M52R6H/retrospective.yaml`). Pour la relire :

- `spec-kitty retrospect summary` : vue d'ensemble des missions (lecture seule)
- `spec-kitty agent retrospect synthesize --mission identite-enrolement-terminaux-01M52R6H` : propositions (à blanc par
  défaut ; `--apply` pour les appliquer)
