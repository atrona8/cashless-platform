---
work_package_id: WP01
title: Contrat d'API, types et codes
dependencies: []
requirement_refs:
- FR-042
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-hors-ligne-snapshots-lots-01M645RN
base_commit: 50e7322139157942cc9e0f4b40d42179a8f49fd8
created_at: '2026-10-30T11:25:02.673433+00:00'
subtasks: [T001, T002, T003, T004]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/contracts/
create_intent: []
execution_mode: code_change
model: sonnet
owned_files: [packages/contracts/openapi.yaml, packages/contracts/src/**, packages/contracts/dart/**, apps/api/src/http/messages.fr.json, apps/api/src/http/messages.en.json, apps/api/src/errors/sqlstate-map.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 – Contrat d'API, types et codes

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement :

- `contracts/openapi-additions.md` (en entier : c'est la liste de tes modifications) ;
- `contracts/interfaces.md` § 1 (SQLSTATE CL045 à CL054) et § 10 (routes) ;
- `research.md` R-02, R-05, R-07, R-08, R-10, R-11, R-14, R-21 et **R-30.9** (fait foi) ;
- `contracts/snapshots.md` (tableau de `GET /offline-snapshots/current`) et `contracts/batches.md`
  (contrôles d'entrée, réponse) pour les statuts et les codes ;
- `spec.md` FR-042 (contrat à jour).

Code à lire : `packages/contracts/openapi.yaml` aux lignes citées plus bas, `scripts/generate.mjs` et
`scripts/check.mjs` (ce que `generated/` doit contenir), `apps/api/src/errors/sqlstate-map.ts`.
Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > PRD ; en cas de contradiction, **signale-la** sans choisir en
silence. Ne modifie jamais un `.sql` généré de `packages/ledger-sql/`.

## Objective

Mettre `openapi.yaml` à jour avant tout code de la mission : six opérations de politique et de
risque, corrections des opérations et schémas hors ligne existants, codes et raisons nouveaux avec
leurs messages fr/en et leur table SQLSTATE, puis régénérer les types TypeScript et Dart. Le contrat
est la source des lots de la phase 3 (WP14, WP15, WP18, WP20) : rien d'autre que le contrat ne change
ici.

## Périmètre et arbitrages

- Dans le lot : tout ce que liste `contracts/openapi-additions.md` ; les codes `CL045` à `CL054` de
  `interfaces.md` § 1 ; les messages fr/en des codes ajoutés ; la régénération.
- Hors lot : aucun code serveur (WP14 à WP20). Les routes sont servies par d'autres lots : ne
  réécris pas leur comportement, décris-le.
- **Aucune recharge espèces hors ligne** (porteur, 30/10/2026, R-02) : `TOPUP_CASH` d'un lot est
  toujours rejeté (`REJECTED OFFLINE_NOT_ALLOWED`) ; `cash_topup_offline` ne vaut jamais que `false`.
  Contradiction avec `sync_protocol.md` §5.4, §7.5 : signalée par R-02, appliquée : la décision.
- R-30.9 fait foi sur `openapi-additions.md` et `snapshots.md` quand ils divergent.
- Retouches hors carte (une ligne au rapport chacune) : `packages/contracts/generated/**` (sortie
  de `npm run generate`, committée) et `apps/api/test/unit/errors/sqlstate-map.spec.ts` (il exige que
  `SQLSTATE_MAP` égale sa table : ajoute CL045 à CL054 ou la suite échoue).

## Subtasks

### T001 – Opérations ajoutées (plafond, trois politiques, risque)

**But** : décrire `getOfflineCeiling`, `setOfflineCeiling`, `get/set{Organizer,Event,Device}OfflinePolicy`
et `getEventOfflineRisk` (tableau de `openapi-additions.md`, tag `Hors ligne` déclaré à la ligne 132).

**Fichiers** : `packages/contracts/openapi.yaml`.

**Étapes**
- Modèle de forme : `getOfflineSnapshot` (l.3892) pour la sécurité (`humanBearer` ici, pas le
  terminal), `waiveSeqGap` (l.1052) pour un `PUT` à `Idempotency-Key` et à demande de rôle.
- Chemins sous `/operators/{operator_id}/…`, `/organizers/{organizer_id}/…`, `/events/{event_id}/…`,
  `/devices/{device_id}/…`. `404` neutre hors périmètre (pas `403`) ; rôles dans la description.
- Schémas `OfflinePolicyLevel` (montants ≥ 0, `max_snapshot_age_seconds` 0 à 86 400,
  `cash_topup_offline` : `const: false`, nul = hérite), `OfflinePolicyLevelView`, `OfflineRisk`
  (formes exactes de `openapi-additions.md`). Placement près de `OfflinePolicy` (l.11845).
- `PUT` : corps = niveau + `version` attendue ; `409 CONFLICT_STATE` si elle diffère ; corps vide =
  niveau effacé ; `cash_topup_offline: true` : `422 VALIDATION_FAILED` ; réponse avec `effective`
  (terminal) et `risk` (événement) ; `capped` limité aux trois montants.

**Critère** : `npm run check -w @cashless/contracts` vert ; chaque `operationId` de `interfaces.md`
§ 10 présent une seule fois.

### T002 – Corrections des opérations et schémas existants

**But** : appliquer le tableau « Corrections » de `openapi-additions.md`, ligne par ligne.

**Étapes** (renvois au fichier actuel)
- `WrappedKey` (l.12209) : `alg` devient `ECDH-ES+HKDF-SHA256+A256GCM`, ajoute `iv` (requis) ;
  réécris la description (construction `sealForRecipient`, plus de key wrap AES).
- `OfflineSnapshot`/`SnapshotHeader` (l.13382, 13327) et `OfflineBatch` (l.13540) : signature
  ECDSA **DER**, base64 standard. `pwd_pack_key` requis dès qu'une entrée a un mot de passe ;
  `removed_token_hashes` toujours présent ; `pwd_pack_sha256` dans `SnapshotEntry` (l.13272,
  R-30.9) ; en-tête de 15 champs de `snapshots.md`.
- `getOfflineSnapshot` (l.3892) : en-tête `X-Snapshot-Latest`, `ETag`, `304`, `409 CONFLICT_STATE` +
  `Retry-After: 2`, chaîne de versions (réécris la description : « un `DELTA` s'il en dispose »
  devient la règle de `snapshots.md`), `403 OFFLINE_NOT_ALLOWED` (détail `SNAPSHOTS_UNAVAILABLE`),
  `403 DEVICE_SUSPENDED`. Retire `409 SNAPSHOT_VERSION_UNKNOWN` de cette opération (R-05).
- `ackOfflineSnapshot` (l.4001) : `409 SNAPSHOT_VERSION_UNKNOWN`, `204` idempotent.
- `submitOfflineBatch` (l.4042) : `409 BATCH_IN_PROGRESS` + `Retry-After`, `400` (lot vide, série,
  grand livre, époque), `409 DEBIT_AUTHORITY_MOVING`, `413`, `503 SERVICE_UNAVAILABLE` +
  `Retry-After: 5` (pool plein, R-30.7). `getOfflineBatchResult` (l.4217) : `202` avec
  `$ref: headers/Retry-After` (l.10494).
- `OfflineOperationResult` (l.13595) : `retryable` vrai seulement pour `INSUFFICIENT_FUNDS_RETRY` ;
  `effect` d'un `DUPLICATE` = `LEDGER_WRITTEN` + `transaction_id`. `OfflineOperation` type
  `TOPUP_CASH` : toujours rejeté (réécris l.13404 « si `cash_topup_offline` »).
- Numéros `seq`, `seq_from`, `seq_to`, `reverses_seq`, `contiguous_acked_seq`, `missing_seqs[]` :
  `maximum: 9007199254740991` (R-14). `DeviceConfig.snapshot_keys` (l.12024) : au plus deux,
  `algorithm` enum `[ECDSA_P256_SHA256]`. `OfflinePolicy.cash_topup_offline` : toujours `false`.

**Cas limites** : `OfflineOperationType` (l.13401) garde `ACTIVATION` et `DEPOSIT_CASH` (lots de
passerelle seulement) ; ne les retire pas. Ne casse aucun exemple : mets-les à jour (un exemple qui
contredit le schéma fait échouer `check`).

### T003 – Codes, raisons, messages, SQLSTATE

**But** : tout code nouveau a une entrée dans `ProblemCode`, un message fr et un message en, et tout
SQLSTATE nouveau une ligne de `SQLSTATE_MAP`.

**Étapes**
- `OfflineRejectReason` (l.13559) : ajoute `ONLINE_NOT_EXECUTED` ; revois la description (raisons
  ajoutées ou changées par `batches.md`). Détails de `OFFLINE_NOT_ALLOWED` (`DEVICE_SUSPENDED`,
  `DEVICE_REVOKED`, `VENDOR_SESSION`) : dans `detail`, pas dans l'énumération.
- `ProblemCode` (l.11188, liste l.11375 et suivantes) et sa description (une ligne par code avec son
  statut : `scripts/generate.mjs` tire les statuts de la description). Vérifie que `NOT_FOUND`,
  `SERVICE_UNAVAILABLE`, `DEVICE_SUSPENDED`, `CONFLICT_STATE` y sont déjà ; n'invente pas de code si
  un existant convient (`CL052` à `CL054` : `CONFLICT_STATE`).
- `sqlstate-map.ts` : CL045 `NOT_FOUND` 404 ; CL046 `CONFLICT_STATE` 409 ; CL047
  `VALIDATION_FAILED` 422 ; CL048 `INTERNAL_ERROR` 500 ; CL049 `SNAPSHOT_VERSION_UNKNOWN` 409 ;
  CL050 `CONFLICT_STATE` 409 ; CL051 `OFFLINE_NOT_ALLOWED` 403 ; CL052 à CL054 `CONFLICT_STATE` 409.
  Commentaire d'en-tête comme celui de CL041 à CL044 (mission, lot, migration, ADR).
- `messages.fr.json` / `messages.en.json` : même clés dans les deux fichiers (386 lignes chacun),
  `title` et `detail`, sans secret ni identifiant interne.

**Critère** : le test d'égalité des deux fichiers de messages et `sqlstate-map.spec.ts` (mis à jour
hors carte) passent ; `CL048` n'a pas de message métier (défaut du producteur).

### T004 – Types TypeScript et Dart régénérés

**But** : `generated/` et `dart/lib` à jour, sans édition à la main.

**Étapes** : `npm run generate -w @cashless/contracts`, puis `npm run generate:dart -w
@cashless/contracts` ; `npm run check -w @cashless/contracts` (inclut `generate-dart.sh --check`) ;
`npm run typecheck -w @cashless/contracts` ; `npm run typecheck -w @cashless/api` (les nouveaux
codes ne cassent aucun `Record<ProblemCode, …>` exhaustif).

**Cas limites** : si l'outil Dart manque sur le poste, ne fabrique pas les fichiers Dart ; écris-le
au rapport avec la commande à relancer. Le diff attendu est un diff de types, relis-le : rien ne
doit disparaître sans raison (un schéma retiré, une opération renommée).

## Sécurité

- Le contrat ne doit pas promettre un droit que la base refusera : `cash_topup_offline` ne vaut jamais
  `true` ; `404` neutre (jamais `403`) pour un objet d'un autre prestataire (pas d'oracle d'existence).
- Aucun secret dans un exemple ou un message (clés, mots de passe de bracelet, empreintes réelles).
- `403 OFFLINE_NOT_ALLOWED` pour `SNAPSHOTS_UNAVAILABLE` : ne décris pas l'état des clés de
  signature au-delà de ce détail.
- Règle 1 du porteur : tout écart au plan qui affaiblit la sécurité (droit plus large, erreur plus
  bavarde, contrôle retiré) est soumis au porteur AVANT d'être codé. Aucun fichier de ce lot n'est à
  faire relire par une personne.

## Tests

- `npm run check -w @cashless/contracts` (types à jour, Dart compris) et `typecheck`.
- `npx jest apps/api/test/unit/errors` depuis `apps/api` (table SQLSTATE). Ne lance pas la suite
  d'intégration ni pgTAP sur `cashless_test` : base de lot `cashless_wp01` si un test en exige une ;
  l'orchestrateur relance en série.
- Pas de nouveau test : les tests de comportement sont aux lots qui servent les routes.

## Ce que le relecteur doit casser

1. Un code de `CL045` à `CL054` absent de `SQLSTATE_MAP`, des messages ou de `ProblemCode`.
2. Un `PUT` de politique qui accepte `cash_topup_offline: true` dans le schéma (le schéma doit le
   refuser, pas seulement la description).
3. Une signature décrite en `raw` (r‖s) ou en base64url quelque part (DER base64 standard partout).
4. `WrappedKey.alg` encore `A256KW`, ou `iv` non requis ; `pwd_pack_key` facultatif.
5. Un numéro de série sans `maximum: 9007199254740991` (cherche chaque champ de la liste de T002).
6. `409 SNAPSHOT_VERSION_UNKNOWN` laissé sur `getOfflineSnapshot` ; `Retry-After` manquant sur
   `409`/`202`/`503`.
7. Un exemple qui contredit le schéma, ou des types générés édités à la main.
8. Une route de politique en `403` au lieu de `404` hors périmètre.

## Definition of Done

- [ ] Les neuf `operationId` de politique/risque présents ; schémas `OfflinePolicyLevel*`,
      `OfflineRisk` conformes à `openapi-additions.md`.
- [ ] Chaque ligne du tableau « Corrections » appliquée (liste cochée dans le rapport).
- [ ] CL045 à CL054 dans `sqlstate-map.ts`, `sqlstate-map.spec.ts`, `ProblemCode`, messages fr/en.
- [ ] `check` et `typecheck` de `@cashless/contracts` verts ; `typecheck` de l'API vert.
- [ ] Rapport : contradictions signalées (au moins : `DEVICE_SUSPENDED` en détail de CL051 contre
      `403 DEVICE_SUSPENDED` de `snapshots.md` ; `ONLINE_NOT_EXECUTED` dans un résultat `ACCEPTED`),
      retouches hors carte, commandes et résultats.

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json` ; ne travaille pas hors de ton worktree.
- Commande : `spec-kitty agent action implement WP01 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
