---
work_package_id: WP03
title: "S5 : codes d'enrôlement, enrôlement et statut des terminaux (migration 0022)"
dependencies: []
requirement_refs:
- C-001
- FR-001
- FR-002
- FR-003
- FR-004
- FR-007
- FR-008
- FR-015
- FR-016
- FR-019
- FR-025
- NFR-007
- NFR-008
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T010
- T011
- T012
- T013
- T014
- T015
phase: Phase 1 - Contrat et base
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0022_device_enrollment.sql
create_intent:
- packages/ledger-sql/migrations/0022_device_enrollment.sql
- packages/ledger-sql/tests/tests_device_enrollment.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0022_device_enrollment.sql
- packages/ledger-sql/tests/tests_device_enrollment.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 – S5 : codes d'enrôlement, enrôlement et statut des terminaux (migration 0022)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Ajouter à la base les tables S5 et les fonctions qui portent les règles d'enrôlement et de statut d'un terminal : code à usage unique, enrôlement atomique, `serial` unique par prestataire, `next_seq`, transitions de statut, battement de cœur, essais d'enrôlement.

## Context

Exigences : FR-001 à FR-004, FR-007, FR-008, FR-015, FR-016, FR-019, FR-025, NFR-007, NFR-008, C-001, C-002 ; `data-model.md` (sections Terminal, Code d'enrôlement, Jeton de rafraîchissement, Essais, Historique, Fonctions) ; `contracts/enrollment.md`, `contracts/device-lifecycle.md` ; `research.md` R-11 (`serial` par prestataire, ADR-109), R-16, R-17 ; SPECIFICATION §8.1, §8.2, §14.2 S5 ; `sync_protocol.md` §3.1. Table `device` du schéma de référence (lignes ~150-180) et index `device_serial_active`. Style : `migrations/0020_tag_key_job_approval.sql` (fonctions `SECURITY DEFINER` avec `search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`) et ses tests. Les droits par rôle sont posés par WP07 dans `post-roles.sql` : ici, chaque fonction fait `REVOKE ALL ON FUNCTION … FROM PUBLIC` et rien d'autre.

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : aucune. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP03 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T010 — Tables, colonnes, index

- Colonnes de `device` : `app_version`, `attestation_kind` (`ANDROID_KEY_ATTESTATION`, `IOS_APP_ATTEST`), `attestation_security_level` (`TRUSTED_ENVIRONMENT`, `STRONGBOX`, NULL pour iOS), `cert_not_after`, `enrolled_at`, `enrollment_code_id`, `status_reason`.
- `DROP INDEX device_serial_active` puis `CREATE UNIQUE INDEX device_serial_active ON device (operator_id, serial) WHERE status <> 'REVOKED'` (ADR-109 ; commentaire : écart au schéma de référence signalé, renforcement). Le test de référence « serial déjà utilisé par un terminal actif refusé » (même prestataire) doit rester vert : vérifie que le nom d'index qu'il attend (`%device_serial_active%`) est conservé.
- `device_enrollment_code`, `device_refresh_token` (avec `family_id`, `successor_id`, `grace_used_at`, `revoked_reason` dans `REUSE`, `DEVICE_REVOKED`, `REENROLLED`, `GRACE_REPLACED`), `device_status_history` (ajout seul), `device_enrollment_attempt` (avec `operator_id` NULL possible quand le code est inconnu : politique RLS adaptée, ou table hors RLS lue seulement par une fonction — justifie le choix). Colonnes, contraintes et index selon `data-model.md`.
- RLS activée et **forcée** sur chaque table, politiques par `app.operator_id` comme les tables existantes ; contraintes `CHECK` sur toutes les énumérations.

### T011 — `create_device_enrollment_code`

`create_device_enrollment_code(p_code_hash bytea, p_event uuid, p_pos uuid, p_mode text, p_personal_phone boolean, p_ttl_seconds int, p_actor uuid) RETURNS uuid` : `assert_tenant` ; `p_mode = 'PAIRED_TPE'` → refus nommé (`CL` à choisir dans la plage libre, traduit en `DEVICE_MODE_NOT_ALLOWED`) **avant** tout `CHECK` ; `p_personal_phone` NULL refusé, vrai seulement avec `KEYPAD_TPE` ; événement et point de vente du même prestataire, point de vente de l'événement ; TTL de 300 à 604 800 s ; insertion. Documente le nouveau `CL` dans le commentaire et dans `apps/api/src/errors/sqlstate-map.ts` **par la note du compte rendu** (la carte est éditée par WP14).

### T012 — `enroll_device`

Signature de `data-model.md`. Dans l'ordre : verrouille le code (`FOR UPDATE`) ; inconnu ou `used_at` posé → refus unique (`ENROLLMENT_CODE_INVALID`) ; expiré → `ENROLLMENT_CODE_EXPIRED` ; mode refusé pour l'appareil (iOS et `TOPUP_DESK`, téléphone personnel hors `KEYPAD_TPE`) → `DEVICE_MODE_NOT_ALLOWED` ; `serial` déjà actif **dans le prestataire** → `DEVICE_SERIAL_IN_USE` ; calcule `next_seq = coalesce(max(last_seq) FILTER (même prestataire, même serial), 0) + 1` ; insère le terminal (`ACTIVE`, affectation, mode et `personal_phone` **du code**, `nfc_enabled = (os = 'ANDROID')`, clés, `cert_sha256`, `cert_not_after`, niveau d'attestation, `next_seq_floor = next_seq`) ; pose `used_at` et `device_id` du code ; révoque (`REENROLLED`) les familles de jetons des terminaux révoqués de ce `serial` s'il en reste ; crée la famille et le premier jeton de rafraîchissement ; écrit l'historique (`NULL → ACTIVE`). Rend `device_id`, `next_seq`. Seule fonction qui écrit `public_key`, `agreement_public_key`, `cert_sha256` (OP-N63).

### T013 — `set_device_status`, `record_device_heartbeat`

- `set_device_status(p_device uuid, p_to text, p_reason text, p_actor uuid)` : `FOR UPDATE` sur le terminal ; transitions de `data-model.md` seulement (`REVOKED` définitif → refus traduit en `409 CONFLICT_STATE`) ; motif obligatoire ; vers `REVOKED` : révoque toutes les familles (`DEVICE_REVOKED`) dans la même transaction ; historique.
- `record_device_heartbeat(p_device uuid, p_app_version text, p_device_time timestamptz)` : `last_seen_at = now()`, `app_version` ; refuse un terminal `REVOKED`.

### T014 — Essais d'enrôlement

`record_enrollment_attempt(p_code_hash bytea, p_address inet, p_result text)` et `enrollment_attempts_exceeded(p_code_hash bytea, p_address inet) RETURNS boolean` (10 par code et par heure, 30 par adresse et par heure, R-16), plus une purge des lignes de plus de 24 h. Ces fonctions sont appelées par l'API dans une transaction **distincte** de l'enrôlement (un refus annulé laisse sa trace).

### T015 — Suite `tests_device_enrollment.sql`

Chaque contrainte et chaque refus ; `PAIRED_TPE` ; code utilisé deux fois ; code expiré (horodatage posé, pas d'attente) ; deux enrôlements concurrents impossibles à simuler en pgTAP : vérifie au moins que le second appel sur un code utilisé échoue ; même `serial` dans deux prestataires accepté ; même `serial` actif dans le même prestataire refusé ; ré-enrôlement après révocation avec `last_seq = 88` → `next_seq = 89` ; iOS sans NFC ; transitions de statut permises et interdites ; révocation qui révoque les familles ; isolation à deux prestataires sur chaque nouvelle table.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

`reset-db` puis toutes les suites pgTAP vertes, suites de référence comprises ; migration rejouable. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Le relecteur vérifie : refus unique pour code inconnu ou utilisé, `next_seq` borné au prestataire, aucune fonction ne permet de réactiver un `REVOKED`, `search_path = public, pg_temp` sur chaque fonction `SECURITY DEFINER`, aucune table sans RLS forcée (ou justification écrite pour `device_enrollment_attempt`).
