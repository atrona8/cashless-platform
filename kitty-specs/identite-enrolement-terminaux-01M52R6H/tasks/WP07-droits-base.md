---
work_package_id: WP07
title: 'Droits de la base : EXECUTE rôle par rôle, TEMPORARY retiré, terminaux protégés (OP-N44, OP-N59, OP-N63)'
dependencies:
- WP02
- WP03
- WP04
- WP05
- WP06
requirement_refs:
- C-001
- C-002
- FR-008
- FR-020
- FR-021
- NFR-010
- NFR-011
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T029
- T030
- T031
- T032
- T033
- T034
phase: Phase 1 - Contrat et base
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/post-roles.sql
create_intent:
- packages/ledger-sql/tests/tests_execute_grants.sql
- packages/ledger-sql/tests/tests_device_rights.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/post-roles.sql
- packages/ledger-sql/gen_tests.py
- packages/ledger-sql/tests_grand_livre_cashless.sql
- packages/ledger-sql/tests/tests_execute_grants.sql
- packages/ledger-sql/tests/tests_device_rights.sql
- packages/ledger-sql/tests/tests_tag_key_job_approval.sql
- packages/ledger-sql/tests/tests_media_roles.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 – Droits de la base : EXECUTE rôle par rôle, TEMPORARY retiré, terminaux protégés (OP-N44, OP-N59, OP-N63)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Lever OP-N44 (droits hérités de `PUBLIC`), la seconde barrière d'OP-N59 (droit `TEMPORARY`) et OP-N63 (écritures directes de l'API sur les clés et le statut des terminaux), et accorder à chaque rôle les seules fonctions et tables des terminaux dont il a besoin.

## Context

Exigences : FR-008, FR-020, FR-021, C-001, C-002, NFR-010 ; `contracts/database-debts.md` ; `research.md` R-11 ; ADR-84, ADR-96, ADR-101, ADR-105 ; OP-N44, OP-N59, OP-N63. `roles.sql` (kit, non modifiable) accorde à chaque rejeu `INSERT, UPDATE` sur toutes les tables et `EXECUTE` à `cashless_app` : toute réduction se fait dans `post-roles.sql`, rejoué après. Le générateur `gen_tests.py` vérifie aujourd'hui « fonctions de bascule exposées » par l'`EXECUTE` hérité de `PUBLIC` (ligne ~694) ; `tests_grand_livre_cashless.sql` est **généré** : ne l'édite qu'en relançant le générateur. Fonctions nouvelles : WP03 (0022), WP04 (0023), WP05 (0024), WP06 (0025, `retire_dedicated_key_for_job`).

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP02, WP03, WP04, WP05, WP06. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP07 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T029 — Générateur (OP-N44)

Dans `gen_tests.py`, accorde explicitement `EXECUTE` à `app_probe` sur les fonctions dont il vérifie l'exposition (au lieu de compter sur `PUBLIC`) ; garde l'assertion « fonctions de bascule exposées » ; régénère `tests_grand_livre_cashless.sql` ; `npm run check:generated -w @cashless/ledger-sql` vert. Le diff du fichier généré doit se limiter à ces droits.

### T030 — `EXECUTE` rôle par rôle

Dans `post-roles.sql` : `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC` ; `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (pour le propriétaire des migrations) ; `REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM cashless_app` (droit direct de `roles.sql`) ; puis `GRANT EXECUTE` fonction par fonction à `cashless_app`, `cashless_platform`, `cashless_tagkeys`, `cashless_perso`, `cashless_tagcheck`, `cashless_keyadmin`. La liste de `cashless_app` est dérivée des appels réels : recense `client.query('SELECT <fonction>(` et équivalents dans `apps/api/src` par processus (script consigné dans le compte rendu), plus les fonctions appelées par les fonctions `INVOKER` qu'il appelle. `retire_dedicated_key` n'est plus accordée à `cashless_perso` ; `retire_dedicated_key_for_job` l'est. Extensions (`pgcrypto`, `pgtap` en test) : vérifie qu'aucun rôle applicatif n'en a besoin, sinon accorde-les nommément.

### T031 — `TEMPORARY` retiré (OP-N59)

Bloc `DO` : `EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database())` ; les rôles `cashless_*` n'ont pas de `TEMPORARY` propre. Vérifie que la suite de référence crée ses tables temporaires comme propriétaire ; sinon accorde `TEMPORARY` au seul rôle de test concerné.

### T032 — Droits des terminaux (OP-N63)

À `cashless_app` : retire `INSERT` sur `device` et `UPDATE` de `status`, `public_key`, `agreement_public_key`, `cert_sha256`, `serial`, `os`, `operator_id` ; retire toute écriture directe sur `device_enrollment_code`, `device_refresh_token`, `device_status_history`, `device_request_nonce`, `device_enrollment_attempt` ; accorde `SELECT` sur les colonnes non secrètes nécessaires (aucune lecture de `public_key` n'est nécessaire à l'API publique ? vérifie : la garde lit `public_key` et `cert_sha256` pour vérifier la signature — accorde la lecture, pas l'écriture). Accorde `EXECUTE` sur les fonctions de WP03 et WP04, dont `check_device_enrollment_code` (lecture seule ajoutée par WP03, appelée par la route sans compte à l'étape 3) ; **n'accorde pas** à `cashless_app` `device_admin_allowed` ni `purge_device_enrollment_attempts` (relecture WP03, 19/10/2026). Hypothèse acceptée par le porteur le 19/10/2026 (R3 de la relecture WP03) : `enroll_device`, `check_device_enrollment_code`, `record_enrollment_attempt`, `enrollment_attempts_exceeded` et `purge_device_enrollment_attempts` tournent sans prestataire de session sur des tables à RLS forcée et supposent un propriétaire de fonctions qui ignore la RLS (superutilisateur ou `BYPASSRLS`), comme les fonctions existantes ; ajoute à `tests_device_rights.sql` un test qui échoue si le propriétaire de ces fonctions perd cette capacité, et cite l'hypothèse dans le compte rendu (exigence de déploiement). À `cashless_tagkeys` (processus des clés de bracelet) : lecture de `device` nécessaire à la garde et `EXECUTE` sur `consume_device_nonce`, `device_token_family_active`, `assert_device_active`.

### T033 — Bornes inversées

`tests_tag_key_job_approval.sql` : section 6 (demande approuvée périmée acceptée une fois → désormais refusée `CL023`) et section 7 (liste exacte des colonnes de `device` que `cashless_app` peut mettre à jour : nouvelle liste sans `agreement_public_key`, `public_key`, `cert_sha256`, `status`, `serial`, `os`, `operator_id`, sans `INSERT`). `tests_media_roles.sql` : la limite décrite d'OP-N44 devient un test de refus.

### T034 — Nouvelles suites

- `tests_execute_grants.sql` : `PUBLIC` n'exécute aucune fonction d'API ; chaque rôle de processus des clés n'exécute que sa liste (comparaison à une liste attendue figée dans le test) ; une fonction créée après `post-roles.sql` par le propriétaire n'est pas exécutable par `PUBLIC` (droits par défaut).
- `tests_device_rights.sql` : réécriture directe de chaque colonne protégée refusée à `cashless_app` ; un `REVOKED` ne peut pas être repassé `ACTIVE` par écriture directe ; aucune écriture directe sur les tables S5 ; création de table temporaire refusée à chaque rôle `cashless_*`.
- Toutes ces suites tournent après un rejeu complet `roles.sql` puis `post-roles.sql` (c'est l'ordre de `reset-db`).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

`reset-db`, `check:generated` et toutes les suites pgTAP vertes ; `npm test -w @cashless/api -- --runInBand` vert (une fonction oubliée casserait une route : relance toute la suite d'API). Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Reports des relectures (20/10/2026)

- Hypothèse « le propriétaire des fonctions ignore la RLS » étendue par le porteur le 20/10/2026 (relecture WP04, M4) à
  `rotate_device_refresh_token` (appelée sans prestataire de session : le condensat du jeton désigne la famille) et
  `purge_device_request_nonces` (maintenance globale). Ajoute-les au test de `tests_device_rights.sql` qui échoue si le
  propriétaire perd cette capacité ; prouve que `rotate_device_refresh_token` ne touche qu'à la famille du condensat
  présenté ; cite l'hypothèse étendue dans le compte rendu.
- N'accorde pas `purge_device_request_nonces` à `cashless_app` (rôle du processus qui la planifie : voir WP12) ;
  `revoke_device_token_family` : accorde-la seulement au rôle qui en a l'usage (WP15, réutilisation ; WP16, back-office),
  justifie le choix dans le compte rendu.
- WP05 (0024) remplace `consume_tap` et `consume_tap_for_claim` par `CREATE OR REPLACE` : vérifie que leurs droits par
  rôle sont ceux que tu poses, après 0024.
- Relecture WP05 : défaut antérieur (0016), `cashless_app` peut écrire `media_claim.confirmed_tap_id` directement
  (`post-roles.sql:229`), sans passer par `consume_tap_for_claim` ni par le verrou `media-tap-use:` : une lecture déjà
  consommée par une écriture peut encore être liée à une demande. Retire `confirmed_tap_id` de ce `GRANT UPDATE` et
  passe `consume_tap_for_claim` en SECURITY DEFINER (`search_path = public, pg_temp`, même verrou), ou, à défaut, pose
  un déclencheur qui refuse un `confirmed_tap_id` sur une lecture qui porte déjà une écriture. Ajoute aussi
  `AND operator_id = t.operator_id` à la garde OP-N50 de `consume_tap` (0024, défense en profondeur). Tests de refus.
- Relecture WP06 : retire `retire_dedicated_key` à `cashless_perso` et garde `retire_dedicated_key_for_job` à ce seul rôle ;
  reprends les lignes de `post-roles.sql` posées par WP06 (GRANT à `cashless_perso`, REVOKE à `cashless_app`).
  Dans `tests_tag_key_job_approval.sql` : §1 (colonne `retire_dedicated_key` de la personnalisation), §4 (le
  `lives_ok` du retrait direct devient un refus 42501 ou passe par le travail), §6 à inverser (il échoue aujourd'hui
  sur CL023, par construction).
- Relecture WP06 (suite) : §7 de `tests_tag_key_job_approval.sql` (lignes ~109 et ~215, qui attendent encore un appel direct
  de `retire_dedicated_key` par `cashless_perso`) à inverser aussi ; ajoute le test « `cashless_perso` ne peut pas appeler
  `retire_dedicated_key` » (condition de levée d'OP-N62).

## Risks / Reviewer guidance

Fichiers à faire relire par une personne : `post-roles.sql`, `gen_tests.py`. Le relecteur vérifie qu'aucun droit n'est élargi par rapport à l'existant (comparer les droits avant et après pour chaque rôle) et que la liste de `cashless_app` correspond aux appels réels.
