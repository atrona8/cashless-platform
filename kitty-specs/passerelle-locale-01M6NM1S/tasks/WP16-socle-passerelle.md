---
work_package_id: WP16
title: 'Socle de la passerelle : paquet, base locale, clés, horloge, garde de démarrage'
dependencies: [WP01, WP02]
requirement_refs:
- FR-001
- FR-032
- NFR-009
- C-007
- C-011
- FR-002
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-passerelle-locale-01M6NM1S
base_commit: 0695522b4d71681c7c53029c0492b0d2ed30a2ca
created_at: '2026-11-05T15:54:20.650816+00:00'
subtasks: [T070, T071, T072, T073, T074, T118]
phase: Phase 4 - Passerelle
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/gateway/src/processes/
create_intent: [apps/gateway/package.json, apps/gateway/tsconfig.json, apps/gateway/tsconfig.build.json, apps/gateway/jest.config.cjs, apps/gateway/migrations/edge-0001_schema.sql, apps/gateway/src/main.ts, apps/gateway/src/config/config.ts, apps/gateway/src/db/pool.ts, apps/gateway/src/db/gateway-tx.ts, apps/gateway/src/db/migrate.ts, apps/gateway/src/key-store/hardware-keystore.port.ts, apps/gateway/src/key-store/fake-hardware-keystore.ts, apps/gateway/src/clock/gateway-clock.ts, apps/gateway/src/processes/bootstrap.ts, apps/gateway/src/processes/gateway.module.ts, apps/gateway/src/processes/startup-guard.ts, apps/gateway/src/testing/failpoints.ts, apps/gateway/test/startup/architecture.spec.ts, apps/gateway/test/startup/config.spec.ts, apps/gateway/test/startup/startup-guard.spec.ts, apps/gateway/test/startup/failpoints.spec.ts, apps/gateway/test/startup/clock.spec.ts, apps/gateway/test/startup/schema.spec.ts, apps/gateway/test/startup/keystore.spec.ts, apps/gateway/src/enrollment/enrollment.service.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/gateway/package.json, apps/gateway/tsconfig*.json, apps/gateway/jest.config.cjs, apps/gateway/migrations/**, apps/gateway/src/main.ts, apps/gateway/src/config/**, apps/gateway/src/db/**, apps/gateway/src/key-store/**, apps/gateway/src/clock/**, apps/gateway/src/processes/**, apps/gateway/src/testing/**, apps/gateway/test/startup/**, apps/gateway/src/enrollment/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP16 – Socle de la passerelle

> **Corrections après analyse** : `contracts/interfaces.md` § 13.1 et § 13.2 : T118, enrôlement dans `apps/gateway/src/enrollment/**`, avec tests (fichier invalide refusé, fichier supprimé, refus de servir sans enrôlement, exactement deux clés de site) ; `edge_site_order_key` dans `edge-0001` ; clé `GATEWAY_ADMIN_PORT`.


> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour les noms de § 12.9 et `gateway.module.ts`.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude).
Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis
seulement :

- `contracts/interfaces.md` § 3 (rôle `edge_app`), § 4 (jetons `HARDWARE_KEYSTORE`, `GATEWAY_CLOCK`, `GatewayTx`), § 5 (`nodeEnv`, `edgeChainGenesis`), § 8
  (configuration de la passerelle, garde de démarrage), § 9 (migration `edge-0001`), § 10 (points d'arrêt), § 11 ;
- `data-model.md` partie B en entier (B.1 à B.8, B.9 bis) : c'est le schéma à écrire ;
- `research.md` R-01, R-14, R-15, R-16 (tables de persistance), R-26 (points d'arrêt, liste des réglages refusés), R-27 (port matériel, aucune clé maître)
  ;
- `docs/passation-8/rapports/plan-adversarial.md` A14, A19, A28 ;
- `docs/08-pile-logicielle.md` (ADR-78 : aucune dépendance npm nouvelle) ; `docs/passation-8/contexte-m8.md` décisions 1, 9, 10.

Code de référence à lire (pas à modifier) : `apps/api/src/config/config.ts` (`nodeEnv`, l.335-341,
et la garde de production), `apps/api/src/processes/bootstrap.ts`,
`apps/api/src/db/` (forme de `TenantTx`), `apps/api/package.json` (versions épinglées à reprendre à
l'identique), `packages/shared-rules/src/index.ts` (WP02).
Priorité des sources (SPECIFICATION §0.3) ; une contradiction se **signale**, sans choisir en
silence. Aucun `.sql` généré de `packages/ledger-sql/` n'est touché.

## Objective

Poser l'application `apps/gateway` : paquet workspace, configuration stricte, base PostgreSQL locale
avec **toute** la série `edge-0001`, une transaction
locale unique (`GatewayTx`), le port de stockage matériel avec son faux, l'horloge de la passerelle
(A14), la garde de démarrage et les points d'arrêt.
Les lots WP17 à WP24 bâtissent dessus. Tant que ce lot n'est pas fusionné, aucun autre lot de la
passerelle ne peut s'écrire : la qualité du schéma prime sur la vitesse.

## Branch Strategy

Planification sur `feat/passerelle-locale`, cible de fusion `feat/passerelle-locale`. Le worktree
est alloué par lane selon `lanes.json` ; ne le crée pas à la main.

## Commande

`spec-kitty agent action implement WP16 --agent claude --mission passerelle-locale-01M6NM1S`
(précédée de `LC_ALL=C LANG=C`).

Rappels : tu ne lances ni Jest, ni pgTAP, ni `reset-db` (l'orchestrateur le fait en série, base
partagée) ; tu ne commites pas ; une API tourne sur le port 80,
n'y touche pas et n'utilise pas ce port ; aucun `GRANT` hors WP09 (ici, la base est **locale** : un
seul rôle `edge_app`, voir T071) ; un écart qui affaiblit la sécurité
s'arrête et remonte au porteur avant d'être codé.

## T070 – Paquet, configuration, `nodeEnv`, démarrage

**But** : `@cashless/gateway` démarre, lit une configuration à échec fermé et ne contient aucun
import de `apps/api`.

- `package.json` : workspace `@cashless/gateway`, scripts `start` (par `tsx`, comme `apps/api/package.json:9`), `build`, `migrate`, `test`. Dépendances :
  les mêmes que l'API, **aux mêmes versions exactes** (`pg`, `jose`, `canonicalize`, `cbor2`, `@peculiar/x509`, `@nestjs/*` nécessaires,
  `@cashless/tag-format`, `@cashless/shared-rules`). **Aucun paquet nouveau** (R-27, ADR-78) ; si tu crois en avoir besoin, arrête-toi et signale. Le
  `package.json` racine (workspaces) est un fichier de `interfaces.md` § 11 : une ligne dans le rapport.
- `jest.config.cjs` : `jest.preset.cjs`, `transformIgnorePatterns` pour `jose`, `canonicalize`, `cbor2` comme `apps/api/jest.config.cjs`, `roots` sur
  `test`, `testMatch` `**/*.spec.ts`, `testPathIgnorePatterns` écartant `/test/e2e/` et `/test/support/` (les preuves de bout en bout ont leur propre
  configuration, WP25, et tournent en série dans une étape dédiée de la CI).
- `config/config.ts` : les clés de `interfaces.md` § 8 (passerelle) et rien d'autre sans le signaler. `NODE_ENV` passe par `nodeEnv()` de
  `@cashless/shared-rules` : absent, `prod` ou `staging` refuse (A19). Chaque clé a un type, un défaut de développement explicite ou aucun défaut ; aucun
  secret par défaut. Écarts de nom connus entre pièces : voir la section « Contradictions à signaler » plus bas.
- `processes/bootstrap.ts` : `NestFactory.create`, écoute **TLS** (`GATEWAY_TLS_CERT_FILE`, `GATEWAY_TLS_KEY_FILE`, TLS 1.3, demande de certificat client).
  Le clair n'est permis qu'en `development` et `test`. `GATEWAY_DEVICE_CA_FILE` sert à vérifier le certificat du terminal (la vérification de l'empreinte
  est WP19).
- `processes/gateway.module.ts` : module racine. Ce fichier est le seul point où les modules des lots suivants se branchent ; chaque lot ajoute **une ligne
  d'import** (fichier à propriétaire unique = ce lot ; les ajouts des autres lots sont une retouche hors carte avec une ligne dans leur rapport, à ajouter
  à la liste de `interfaces.md` § 11). Il enregistre aussi la garde « route non marquée » : toute route absente de la liste des 16 opérations répond `404`
  (`contracts/gateway-served-operations.md`, « Aucune route ajoutée »). Écris la garde comme une liste blanche de `operationId` alimentée par les lots 19 à
  23, et un test d'architecture qui échoue si une route est déclarée sans y figurer.
- `main.ts` : point d'entrée mince ; la garde de démarrage (T074) s'exécute **avant** toute ouverture de port et avant toute connexion à la base.

**Cas limites** : variable vide traitée comme absente ; `GATEWAY_LISTEN_PORT` hors plage ; deux
fichiers de certificat illisibles : message qui nomme la variable, jamais le contenu.

## T071 – `edge-0001` : toutes les tables, un seul rôle

**But** : le schéma de `data-model.md` B, en **une seule** migration (`interfaces.md` § 9), pour
éviter des lanes concurrentes.

- Emplacement : `apps/gateway/migrations/edge-0001_schema.sql` (chemin de `interfaces.md` § 9 ; `research.md` R-01 dit `db/migrations/` : `interfaces.md`
  fait foi, à signaler). `db/migrate.ts` joue les fichiers `edge-NNNN_*.sql` dans l'ordre, dans une transaction chacun, avec une table
  `edge_schema_migration` (nom, empreinte) ; une empreinte modifiée refuse de poursuivre.
- Tables : B.1 `edge_meta`, `edge_authority`, `edge_clock` ; B.2 `edge_chain_head`, `edge_op`, `edge_op_delta`, `edge_device_batch`, `edge_outgoing_batch`
  ; B.3 `edge_wallet`, `edge_media`, `edge_tap`, `edge_replication_cursor` ; B.4 toutes les entités d'état de service (`edge_cash_session`,
  `edge_vendor_session`, `edge_vendor`, `edge_device`, `edge_device_token_family`, `edge_identity_key`, `edge_staff`, `edge_catalog_item`,
  `edge_event_setting`, `edge_wallet_limit`, `edge_wallet_state`, et le magasin de la clé de contenu `pwd_pack_key`) ; B.5 `edge_device_nonce`,
  `edge_idempotency`, `edge_device_seq` ; B.6 `edge_token_key`, `edge_audit`, `edge_snapshot`, `edge_snapshot_entry`, `edge_snapshot_key`,
  `edge_snapshot_ack`. Si une colonne manque dans `data-model.md` pour un lot suivant, ajoute-la et signale-la : ne l'invente pas en silence.
- Contraintes qui portent la sécurité (chacune a un test, voir plus bas) :
  1. `edge_op` : `edge_seq` PK, `origin_key` UNIQUE, déclencheur qui interdit `DELETE` et toute modification des champs de contenu (seuls `central_*` et
     `sent_batch_id` changent) ;
  2. `edge_chain_head` : une seule ligne (contrainte), initialisée à `edge_chain_genesis(gateway_id)` **par le code partagé**, pas en SQL ;
  3. `edge_audit` : append-only, chaîné (`prev_hash`, `row_hash`), `UPDATE` et `DELETE` interdits par déclencheur, sauf la colonne `sent_in_batch` ;
  4. `edge_authority` : une ligne, `edge_authority_transition` (table des transitions de B.8) et déclencheur qui refuse toute transition absente ;
     `RELEASING` ne sort que vers `RELEASED` ou, avec `handover_failed_epoch = epoch`, vers `ACTIVE` (invariant B.7-4) ;
  5. `edge_outgoing_batch` : index unique partiel « un seul lot non `DONE` » (B.7-7) ;
  6. `edge_op.type` et `central_status` en `CHECK` sur les énumérations de B.2 ;
  7. aucun mot de passe en clair : `edge_media.pwd_pack_enc` et `edge_snapshot_entry.pwd_pack_enc` sont `bytea`, aucune colonne `pwd`/`password` en clair
     (test de schéma sur le catalogue).
- `REVOKE ALL ... FROM PUBLIC` sur chaque objet. Un seul rôle `edge_app` propriétaire des tables ; le rôle ne dispose pas de `SUPERUSER`. Pas de RLS (B,
  en-tête).

## T072 – `GatewayTx` et port `HARDWARE_KEYSTORE`

- `db/gateway-tx.ts` : `GatewayTx.run<T>(fn)` ouvre une transaction `READ COMMITTED` locale sur **un seul pool** (`db/pool.ts`, seul fichier qui importe
  `pg`). Un test d'architecture échoue si un autre fichier importe `pg` ou crée un pool. `synchronous_commit = on` posé à la connexion. Aucune requête hors
  transaction pour une opération de terminal.
- `key-store/hardware-keystore.port.ts` : l'interface exacte de `interfaces.md` § 4 (`sign`, `agree`, `publicKey`, `destroy`, `KeyUse`). **Aucune méthode
  d'export de clé privée**, ni dans l'interface ni dans le faux.
- `fake-hardware-keystore.ts` : `isFake = true`, clés en mémoire ou en fichier de développement, générées au premier usage, ES256 P-256 pour `snapshot`,
  `token`, `batch` et ECDH P-256 pour `agreement`. `destroy(use)` efface la clé et toute copie ; après `destroy`, `sign` et `agree` **refusent** (erreur
  typée `KEY_DESTROYED`), `publicKey` aussi. WP24 s'appuie sur cette propriété (NFR-013). Le faux n'écrit jamais la clé privée dans un journal ni dans la
  base. Le fichier de clés, s'il existe, est en mode `0600` hors du dépôt.
- Le jeton d'injection `HARDWARE_KEYSTORE` est fourni par une fabrique qui choisit selon la configuration ; l'adaptateur réel n'existe pas (mission 12b) :
  la valeur de production est **refusée** (T074).

## T073 – `GatewayClock` (A14, R-14)

Interface `GatewayClock { now(); observeCentral(date); skewAlert() }` (§ 4), table `edge_clock`
(B.1).

- Au démarrage : `t0 = max(heure système, time_floor)` ; ensuite `now() = t0 + temps monotone écoulé` (`process.hrtime`), recalée sur l'heure centrale à
  chaque `observeCentral`. **Jamais une heure inférieure à `time_floor`.**
- `time_floor` écrit dans toute transaction qui écrit une heure, au plus une fois par seconde (pas d'écriture de plus à chaque requête : mesure la charge).
- `observeCentral(date)` : calcule `central_offset_ms` ; écart supérieur à 120 s entre heure système et heure servie : `skewAlert() = true` et ligne
  d'audit `CLOCK_SKEW`. Écart de plus de 24 h entre l'heure servie et une mesure centrale : l'horloge expose `refusesAck() = true` ; WP17 refuse alors
  l'accusé de bascule (état local `ARMED`, alerte).
- **Limite consignée** (`OP-N103`, B.1) : horloge système reculée pendant un arrêt de la machine ; ne la « corrige » pas, documente-la dans l'en-tête du
  fichier.
- Un test ne compare jamais l'horloge de Node à une date posée par la base (le quickstart décrit le décalage de 0 à 120 ms de PostgreSQL dans Docker) :
  injecte une source de temps système.

## T074 – Garde de démarrage et points d'arrêt

**Garde** (`processes/startup-guard.ts`, § 8) : en production, refuse le démarrage pour :
`HARDWARE_KEYSTORE=fake` ; un `EDGE_CA` factice ; un vérificateur d'identité de test ;
`EDGE_FAILPOINT` posé ;
`EDGE_ALLOW_FAILPOINTS` posé ; `CORS_ALLOW_ALL` ; écoute sans TLS ; `GATEWAY_REQUEST_AUTHORITY` à
joker (`:*`, liste vide, ou plusieurs valeurs) ; un secret de test ; `fsync`, `full_page_writes`
ou `synchronous_commit` désactivés (lus par `SHOW` sur la base locale) ; `NODE_ENV` absent ou hors
énumération. Elle refuse **toutes** les violations d'un coup (liste complète dans le message, jamais
la valeur d'un secret).
Une règle ajoutée par un lot suivant (leurs faux éventuels) entre par un registre
`registerProductionRule(name, check)` : écris-le, et documente-le dans l'en-tête.

Les ports « EDGE_CA » et « vérificateur d'identité de test » n'existent pas encore sur la passerelle
: définis deux réglages **dont la seule valeur de développement est un faux** (`EDGE_CA=fake`,
`GATEWAY_IDENTITY_VERIFIER=test`), acceptés hors production, refusés en production. Un renforcement
ne demande pas d'accord, mais consigne-le dans le rapport (voir « Contradictions »).

**Points d'arrêt** (`testing/failpoints.ts`) : `before-local-write`,
`after-local-write-before-reply`, `during-drain-after-send-before-result`,
`after-releasing-persisted` (action : `SIGKILL` du processus lui-même),
`kill-local-database` (le processus écrit sur la sortie standard la ligne `FAILPOINT
kill-local-database reached`, puis **attend sans valider** ; c'est le banc de WP25 qui exécute
`docker kill` du conteneur PostgreSQL
local, A28 ; le code de production n'appelle jamais Docker). Actifs **seulement** si `NODE_ENV` vaut
`development` ou `test` ET `EDGE_ALLOW_FAILPOINTS=1`. Syntaxe `EDGE_FAILPOINT=<nom>[:<n>]` (le
n-ième passage).
`failpoint(name)` est un appel gratuit quand rien n'est posé (aucun accès à `process.env` à chaque
appel : lecture unique au démarrage). Hors des deux conditions, un point posé est ignoré et une
ligne d'audit
`FAILPOINT_REFUSED` est écrite ; en production il refuse le démarrage (garde).

## Tests attendus (`apps/gateway/test/startup/`)

Chaque test doit échouer sur une implémentation fausse ; les tests qui touchent la base utilisent
une base jetable `cashless_m8_edge_*` créée par le support de test, jamais `cashless_test`.

- `architecture.spec.ts` : aucun import de `apps/api/**` depuis `apps/gateway/src/**` (seulement `@cashless/shared-rules`, `@cashless/tag-format`,
  `@cashless/contracts`) ; `pg` importé dans `db/pool.ts` seul ; routes déclarées ⊆ liste des 16.
- `config.spec.ts` : `nodeEnv` de la passerelle égal à celui de l'API sur les mêmes entrées (tableau de valeurs, dont `prod`, `staging`, absent, vide,
  `Production`) ; clé inconnue ou vide.
- `startup-guard.spec.ts` : **un démarrage réel par réglage** (`NestFactory` dans un processus enfant, code de sortie non nul, message nommant le réglage,
  aucun port ouvert, aucune connexion à la base). Pour `fsync` et `full_page_writes` : conteneur PostgreSQL 17 jetable lancé avec `-c fsync=off -c
  full_page_writes=off` sur un port libre ; pour `synchronous_commit` : `ALTER DATABASE ... SET`. Cas de contrôle positif : la configuration de production
  saine **démarre** (sinon le test ne prouve rien). Cas : deux violations à la fois nommées toutes les deux.
- `failpoints.spec.ts` : sans `EDGE_ALLOW_FAILPOINTS`, le point ne tue rien ; en `test` avec les deux conditions, il tue ; en production, démarrage refusé
  ; ligne `FAILPOINT_REFUSED` écrite.
- `clock.spec.ts` : corrections de plus et moins 2 h ; **redémarrage avec horloge système reculée de 2 h puis de 13 h : l'heure servie reste au moins égale
  à `time_floor`** ; jeton à 12 h + 1 s hors fenêtre (calcul sur l'heure servie) ; écart de 24 h : `refusesAck()` ; `time_floor` écrit au plus une fois par
  seconde.
- `schema.spec.ts` : `UPDATE` d'un champ de contenu d'`edge_op` refusé, `DELETE` refusé, `UPDATE central_status` permis ; deuxième ligne
  d'`edge_chain_head` refusée ; deux lots non `DONE` refusés ; transition d'autorité absente de la table refusée ; `RELEASING -> ACTIVE` sans
  `handover_failed_epoch` refusé ; aucune colonne en clair nommée comme un mot de passe ; `edge_audit` non modifiable ; empreinte de migration modifiée
  refusée.
- `keystore.spec.ts` : après `destroy`, `sign`, `agree` et `publicKey` refusent ; aucune méthode d'export (reflexion sur l'objet) ; la clé privée ne figure
  ni dans la base ni dans la sortie du processus.

## Sécurité

- **Aucun faux en production**, prouvé par démarrage réel : c'est la définition de fini de ce lot (règle 2 du porteur).
- Aucun secret dans la base, dans les journaux ni dans l'image ; messages d'erreur sans valeurs.
- Fichiers à faire relire par une personne (l'agent qui les a écrits ne vaut pas relecture indépendante) : `migrations/edge-0001_schema.sql` (tables
  `edge_op`, `edge_authority`), `key-store/**`, `processes/startup-guard.ts`.

## Contradictions à signaler (sans trancher en silence)

1. Dossier des migrations : `research.md` R-01 (`db/migrations`) contre `interfaces.md` § 9 (`migrations/`) : `interfaces.md` fait foi.
2. Noms de variables : `quickstart.md` (`GATEWAY_PORT`, `GATEWAY_IDENTITY_JWKS_URL`, `EDGE_PACK_DELAY`) contre `interfaces.md` § 8 (`GATEWAY_LISTEN_PORT`,
   aucune clé d'identité) : `interfaces.md` fait foi pour le port ; `GATEWAY_IDENTITY_JWKS_URL` manque au § 8 alors que WP22 en a besoin : ajoute-la et
   signale-la.
3. La garde cite un « `EDGE_CA` factice » et un « vérificateur d'identité de test » sans réglage correspondant côté passerelle : voir T074.
4. Rôle de la base locale : `edge_app` (§ 3) contre `cashless_gateway` (quickstart) : `interfaces.md` fait foi.

## Definition of Done

- [ ] `apps/gateway` compile (`tsc`), `npm run lint` propre, lignes de 100 caractères, aucune dépendance npm nouvelle.
- [ ] `edge-0001` couvre toutes les tables de `data-model.md` B ; chaque contrainte de T071 a un test.
- [ ] Un démarrage réel par réglage refusé ; un démarrage de production sain réussit.
- [ ] Horloge : les cinq cas de T073 prouvés. Points d'arrêt inertes hors des deux conditions.
- [ ] Rapport : retouches hors carte (`package.json` racine, imports de `gateway.module.ts`), contradictions ci-dessus, fichiers à relire.

## Ce que le relecteur doit casser

- Poser `NODE_ENV=production` avec chacun des réglages interdits, un à un puis tous ensemble ; `NODE_ENV=Production`, vide, `staging`.
- Poser `EDGE_FAILPOINT` seul, puis avec `EDGE_ALLOW_FAILPOINTS=1` en production : le démarrage doit échouer avant toute connexion.
- Faire un `UPDATE edge_op SET operation = ...` et un `DELETE` en tant que `edge_app` ; insérer une seconde ligne d'`edge_chain_head` ; ouvrir deux lots
  non `DONE`.
- Reculer l'horloge de 13 h entre deux démarrages et lire `now()`.
- Chercher un chemin pour exporter une clé privée du port ; chercher un second pool ou un `import 'pg'` hors `db/pool.ts`.
- Déclarer une route hors des 16 : elle doit casser le test d'architecture, pas passer.
