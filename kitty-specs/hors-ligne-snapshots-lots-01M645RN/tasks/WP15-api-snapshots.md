---
work_package_id: WP15
title: 'API : service des snapshots, accusé, configuration et battement servis'
dependencies: [WP01, WP04, WP07, WP08]
requirement_refs:
- FR-005
- FR-011
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots.
  During /spec-kitty.implement this WP may branch from a dependency-specific base, but
  completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human
  explicitly redirects the landing branch.
subtasks: [T060, T061, T062, T063]
phase: Phase 3 - API
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/offline/snapshots/
create_intent: [apps/api/src/offline/snapshots/offline-snapshots.module.ts, apps/api/src/offline/snapshots/offline-snapshots.controller.ts, apps/api/src/offline/snapshots/offline-snapshots.service.ts, apps/api/src/offline/snapshots/offline-snapshots.dto.ts, apps/api/src/offline/snapshots/snapshot-etag.ts, apps/api/test/integration/offline/snapshots.spec.ts, apps/api/test/integration/offline/snapshots-config.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/offline/snapshots/**, apps/api/src/devices/config/device-config.service.ts, apps/api/src/devices/heartbeat/heartbeat.controller.ts, apps/api/test/integration/offline/snapshots*.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP15 – API : service des snapshots et configuration servie

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite la fiche de contexte
d'implémentation de l'orchestrateur, ce prompt, puis seulement : `spec.md` (FR-009 à FR-011, FR-042,
FR-043, NFR-004, NFR-007, NFR-010), `research.md` R-05, R-07, R-09 et **R-30.5, R-30.9 (font foi)**,
`contracts/snapshots.md` (tableau `GET`, `POST ack`, configuration et battement), `contracts/
interfaces.md` § 1 (CL049 à CL051), § 3 (`offline_snapshot_for_device`, `snapshot_public_keys`), § 6
(`ack_offline_snapshot`, `offline_snapshot_meta`). Priorité des sources : SPECIFICATION §0.3 ; toute
contradiction est signalée. Les `.sql` générés ne bougent pas.

## Objective

Servir au terminal le snapshot signé qui lui est destiné, enregistrer son accusé, et publier dans la
configuration et le battement de cœur ce qu'il faut pour le vérifier et le demander : clés publiques
de signature, version la plus récente, demande de synchronisation. Ce module n'a AUCUN port de clé :
il lit, il ne signe ni ne chiffre rien.

## Périmètre et arbitrages

- Dans le lot : `getOfflineSnapshot`, `ackOfflineSnapshot`, `snapshot_keys` et `offline_enabled`
  de la configuration, `latest_snapshot_version` et `sync_requested` du battement.
- Hors lot : production, chiffrement, signature (WP11 à WP13) ; fonctions SQL (WP04, WP07) ; contrat
  (WP01) ; traitement des lots (WP18 à WP20).
- Le choix FULL / pas suivant est fait par `offline_snapshot_for_device` (règles : `contracts/
  snapshots.md` et R-30.5). L'API ne le recalcule pas ; elle traduit, met en forme, compresse.
- Décision R-30.9 : sans clé de signature `ACTIVE` (production avant 12b), `403 OFFLINE_NOT_ALLOWED`
  (détail `SNAPSHOTS_UNAVAILABLE`, `CL051`) ET `offline_enabled` servi à `false` dans la configuration.
- Modèles : `devices/config/device-config.controller.ts:13-38` (`ETag`, `If-None-Match`,
  `DeviceAuth({ allowSuspended: true })`) ; mais ICI le terminal suspendu est REFUSÉ
  (`403 DEVICE_SUSPENDED`) : `@DeviceAuth()` sans option (`device-identity/device.guard.ts:66-67,
  106-111`). Ses lots restent traités (WP18), pas ses snapshots.

## Subtasks

### T060 — `getOfflineSnapshot` (chaîne, `ETag`, `304`, `X-Snapshot-Latest`, gzip, `403`/`409`)

- **Fichiers** : `offline-snapshots.controller.ts` (`GET /offline-snapshots/current?since_version=`),
  `offline-snapshots.service.ts`, `snapshot-etag.ts`.
- **Étapes** : `since_version` : entier `>= 0` en texte -> `BigInt` (jamais `Number`), absent = sans
  version ; sinon `400 VALIDATION_FAILED` avec pointeur. Un `tx.run(device.operatorId)` appelle
  `offline_snapshot_for_device(device_id, since)` (`interfaces.md` § 3). Traduction : `CL051` -> `403
  OFFLINE_NOT_ALLOWED` avec le détail du message (`OFFLINE_DISABLED`, `NO_EVENT`, `PERSONAL_PHONE`,
  `SNAPSHOTS_UNAVAILABLE`, `DEVICE_SUSPENDED` -> ce dernier en `403 DEVICE_SUSPENDED`) ; `CL050` ->
  `409 CONFLICT_STATE` + `Retry-After: 2` (aucune version, ou enveloppe pas prête).
- **Réponse** : `OfflineSnapshot` = `header`, `signature` (base64 standard de la DER), `entries`,
  `removed_token_hashes` (toujours présent, vide pour un `FULL`), `pwd_pack_key` (l'enveloppe du seul
  terminal appelant, requise dès qu'une entrée a un mot de passe). Les `pwd_pack_enc` viennent de la
  base dans `entries` ; l'API ne les déchiffre jamais et ne les journalise jamais.
- **En-têtes** : `X-Snapshot-Latest` = `latest_version` ; `ETag` = `"<ledger>:<version>:<device>:
  <empreinte clé d'accord>"` (R-30.9) ; `Cache-Control: private, no-store` ; `If-None-Match` égal ->
  `304` sans corps (réutilise `etagMatches`, `device-config.service.ts:106-110`, sans l'importer en
  boucle de module : place l'import côté `offline/snapshots`). Si `Accept-Encoding` admet gzip :
  `zlib.gzip` du corps JSON, `Content-Encoding: gzip`, `Vary: Accept-Encoding`. La signature porte
  sur l'en-tête, pas sur les octets de transport : la compression ne la touche pas.
- **Cas limites** : une enveloppe d'un autre terminal ne sort jamais (test) ; `since_version` supérieur
  à la dernière : traité comme « dernière » par la base, rien à corriger ici ; en-tête `ETag` posé
  AVANT le `304`. Un `FULL` de 50 000 entrées passe sans bloquer la boucle d'événements (gzip
  asynchrone, pas `gzipSync`).
- **Critère** : mesure du `DELTA` servi en 2 s au plus (p95) mesurée par WP21 ; ici : test de
  non-régression sur 5 pas / plus de 5 pas / `FULL` plus récent (R-30.5).

### T061 — `ackOfflineSnapshot`

- **But** : `POST /offline-snapshots/ack`, corps `{version, content_sha256}` -> `ack_offline_snapshot`
  (`interfaces.md` § 6). `204` idempotent ; `CL049` -> `409 SNAPSHOT_VERSION_UNKNOWN`.
- **Étapes** : validation stricte (`version` entier >= 1 en `BigInt`, `content_sha256` hex de 64
  caractères, champ inconnu `422`) ; `@DeviceAuth()` (terminal actif seulement) ; pas de
  `Idempotency-Key` : l'accusé est naturellement idempotent (max). Vérifie dans le contrat WP01 si
  l'en-tête est exigé et suis-le.
- **Critère** : un accusé d'une version non servie à ce terminal, ou d'une empreinte différente, est
  refusé ; `last_snapshot_version` ne recule jamais (rejouer l'accusé d'une version plus ancienne ne
  change rien) ; le plancher d'accusé (`offline_snapshot_ack`) reçoit une ligne par version.

### T062 — Configuration servie et battement de cœur

- **`device-config.service.ts`** : `snapshot_keys: []` (ligne 243) devient les clés de
  `snapshot_public_keys(operator)` (au plus deux, `{key_id, algorithm: "ECDSA_P256_SHA256",
  public_key (SPKI DER base64), not_after}`). `offline_enabled` est servi `false` quand la liste est
  vide, quelle que soit la politique (R-30.9). Cet état entre dans l'`ETag` de la configuration
  (`configEtag`, lignes 94-100) : un terminal voit le changement au battement suivant. Ne change pas
  `config_id` ni `record_config_served` (déduplication inchangée).
- **Numéros** (R-14, `interfaces.md` § 8) : `seq.next_seq_floor` et `seq.contiguous_acked_seq`
  (lignes 245-248) sont lus en texte puis exposés avec le `maximum` du contrat (2^53-1), sans
  `Number(...)` silencieux sur un `bigint` supérieur : au-delà, erreur interne journalisée.
  `ServedRow.next_seq_floor` et `DeviceRow.contiguous_acked_seq` restent des textes.
- **`heartbeat.controller.ts`** : `latest_snapshot_version` (ligne 44) = dernière version du grand
  livre du terminal (`null` si aucune ou terminal sans événement) ; `sync_requested` (ligne 46) =
  événement en `CLOSING` (lu en base dans la même transaction, jamais d'un en-tête). Mets à jour les
  commentaires d'en-tête (lignes 5-6). Le battement reste permis à un terminal suspendu.
- **Critère** : sans clé `ACTIVE`, `offline_enabled` faux et `snapshot_keys` vide ; avec clé, au plus
  deux ; l'ETag change quand la clé tourne.

### T063 — Tests

- **`snapshots.spec.ts`** : `FULL` d'abord ; `DELTA` ensuite (`since_version = b`) ; rattrapage
  après plus de 5 pas -> `FULL` ; `304` avec `If-None-Match` ; `X-Snapshot-Latest` ; gzip ; terminal
  suspendu -> `403 DEVICE_SUSPENDED` ; terminal révoqué -> `403 DEVICE_REVOKED` (garde) ; clé
  d'accord changée -> `409` puis nouvelle enveloppe ; aucune version -> `409` + `Retry-After` ;
  téléphone personnel et hors ligne interdit -> `403` ; accusé juste, faux, rejoué.
- **`snapshots-config.spec.ts`** : `snapshot_keys`, `offline_enabled`, `latest_snapshot_version`,
  `sync_requested`, ETag de configuration.
- Les snapshots de test sont publiés par les FONCTIONS SQL de WP03/WP04 (propriétaire, amorçage) ou
  par le faux `SignPort` de WP09 ; jamais une insertion directe qui contourne `publish_offline_snapshot`.
  `TestTerminal` ouvre l'enveloppe (modèle : `test/support/test-terminal.ts:425-431`).

## Sécurité

- Écart qui affaiblit la sécurité : au porteur AVANT de coder (règle 1 de `CLAUDE.md`).
- Points sensibles : l'enveloppe et l'ETag ne servent que le terminal appelant (identité tirée du
  jeton, jamais d'un paramètre) ; aucun `pwd_pack_enc` ni clé de contenu dans les journaux ni les
  erreurs ; un terminal `SUSPENDED` ou `REVOKED` ne reçoit jamais de clé de contenu ; `Cache-Control:
  private, no-store` ; `304` ne dépend que d'un ETag lié au terminal (pas d'oracle entre terminaux).
- Fichier à faire relire par une personne : le choix du terminal servi dans `offline_snapshot_for_device`
  (WP04) est relu à son lot ; ici, signale seulement si l'identité du terminal n'est pas celle du jeton.

## Tests

- Suites : `snapshots.spec.ts`, `snapshots-config.spec.ts`, et les suites existantes
  `test/integration/devices/config.spec.ts`, `heartbeat.spec.ts`, `payments/heartbeat-etag.spec.ts`
  qui doivent rester vertes (adapter leurs attentes seulement si le contrat le change, et le dire).
- Base de lot `cashless_wp15`. Commande : `npm test -w @cashless/api -- offline/snapshots devices/`.
  L'orchestrateur relance en série sur `cashless_test`.

## Ce que le relecteur doit casser

1. Terminal A demande l'enveloppe de B (en changeant un paramètre ou l'ETag) : jamais servie.
2. Terminal suspendu avec un `If-None-Match` valide : `403`, pas `304`.
3. `since_version` en `9007199254740993` ou en texte : refus net, aucune perte de précision.
4. Rotation de clé de signature : la configuration montre deux clés, jamais trois ; ETag changé.
5. Accusé d'une version non enveloppée pour ce terminal : `409`, `last_snapshot_version` inchangé.
6. Production sans clé `ACTIVE` : `offline_enabled` reste faux même si la politique l'autorise.
7. `Content-Encoding: gzip` : décompressé, le corps est identique à celui sans compression.
8. Recherche d'un `pwd_pack_enc` en clair dans les journaux de l'application pendant les tests : 0.

## Definition of Done

- [ ] `getOfflineSnapshot` et `ackOfflineSnapshot` conformes au contrat (balayage vert).
- [ ] `snapshot_keys`, `offline_enabled`, `latest_snapshot_version`, `sync_requested` servis.
- [ ] Plus aucun `Number(...)` sur un numéro de séquence dans `device-config.service.ts`.
- [ ] Suites vertes sur `cashless_wp15`, suites des terminaux existantes non régressées.
- [ ] Rapport : retouches hors carte (`app.module.ts`, `audit.service.ts`), contradictions.

## Branch Strategy

Planification et fusion sur `feat/hors-ligne-snapshots-lots`. Dépendances : WP01, WP04, WP07, WP08.
Worktree attribué par lane (`lanes.json`). Commande : `spec-kitty agent action implement WP15
--agent claude --mission hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
