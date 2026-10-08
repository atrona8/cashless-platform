---

work_package_id: WP01

title: SchÃ©ma d'identitÃ©

dependencies: []

requirement_refs:

- FR-001

- FR-004

planning_base_branch: feat/identite-roles

merge_target_branch: feat/identite-roles

branch_strategy: Planning artifacts for this mission were generated on feat/identite-roles. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-roles unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-identite-roles-double-validation-01M4DNDN
base_commit: 1d0059560fdebd8fd4bf1982ee369b358ce33f0a
created_at: '2026-10-08T14:02:46.907170+00:00'
subtasks:

- T001

- T002

- T003

- T004

phase: Phase 1 - Base de donnÃ©es

history:

- timestamp: '2026-10-08T13:00:00Z'

  agent: claude

  action: Prompt generated via /spec-kitty.tasks

agent_profile: implementer-ivan

authoritative_surface: packages/ledger-sql/migrations/0003_identity.sql

create_intent:

- packages/ledger-sql/migrations/0003_identity.sql

- packages/ledger-sql/tests/tests_identity.sql

execution_mode: code_change

owned_files:

- packages/ledger-sql/migrations/0003_identity.sql

- packages/ledger-sql/tests/tests_identity.sql

role: implementer

tags: []

tracker_refs: []

---



# Work Package Prompt: WP01 â€“ SchÃ©ma d'identitÃ©



## âš¡ Do This First: Load Agent Profile



Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `data-model.md` (`app_user`,

`role_assignment`, `identify_person`), `contracts/identity.md`, `research.md` R-03 Ã  R-06, SPECIFICATION Â§3.1, Â§3.2,

Â§14.2 (S1), et dans `packages/ledger-sql/schema_grand_livre_cashless.sql` : la forme des politiques

`tenant_isolation`, `assert_tenant`, les tables `party` (kind `PLATFORM`/`OPERATOR`/`ORGANIZER`/`MERCHANT`),

`event`, `merchant_participation`. ModÃ¨le de migration et de test : `0002_api_idempotency.sql` et

`tests/tests_api_idempotency.sql` (mission 1).



## Objective



CrÃ©er par la migration `0003_identity.sql` les personnes (`app_user`) et les attributions de rÃ´le

(`role_assignment`), avec RLS forcÃ©e, gardes d'intÃ©gritÃ© et la fonction `identify_person`, le tout testÃ© par pgTAP

contrainte par contrainte.



## Context



- Exigences : FR-001, FR-004 (base), NFR-001, C-003, C-008.

- Une personne de la plateforme a `operator_id` NULL : invisible sous RLS (politique `operator_id =

  current_setting('app.operator_id', true)::uuid`), lue seulement par `identify_person`.

- `roles.sql` est rejouÃ© aprÃ¨s la sÃ©rie : `cashless_app` reÃ§oit `SELECT, INSERT, UPDATE` sur les nouvelles tables

  (voulu ici) ; aucune suppression (dÃ©jÃ  retirÃ©e). Les fonctions sont `EXECUTE` pour tous : `identify_person` est

  une fonction d'API, c'est voulu.

- Le fichier `post-roles.sql` (WP03) n'existe pas encore ; ne pas en dÃ©pendre.



## Branch Strategy



Planification et merge sur `feat/identite-roles`. Commande : `spec-kitty agent action implement WP01 --agent claude`.

Les worktrees sont attribuÃ©s par lane (`lanes.json`).



## Subtasks



### T001 â€” Tables



- `app_user` : colonnes de `data-model.md` ; `CHECK (status IN ('ACTIVE','DISABLED'))` ; `CHECK ((status =

  'DISABLED') = (disabled_at IS NOT NULL))` ; `CHECK (email IS NOT NULL OR phone IS NOT NULL)` ; `phone ~

  '^\+[1-9][0-9]{6,14}$'` si prÃ©sent ; `UNIQUE (issuer, subject)` ; `operator_id` â†’ `party(id)` ; dÃ©clencheur ou

  contrÃ´le : si `operator_id` non NULL, la partie est de type `OPERATOR`.

- `role_assignment` : colonnes de `data-model.md` ; `role` dans la liste fermÃ©e de Â§3.2 ; `scope_type` dans

  (`PLATFORM`, `OPERATOR`, `ORGANIZER`, `EVENT`, `MERCHANT`) ; `CHECK ((scope_type = 'PLATFORM') = (scope_id IS

  NULL))` ; compatibilitÃ© rÃ´le â†” portÃ©e (table de `data-model.md`) en `CHECK` ; `CHECK (granted_by IS NULL OR

  granted_by <> user_id)` ; `CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))` ; index unique partiel Â« une

  attribution active par (personne, rÃ´le, type de portÃ©e, objet) Â» (`WHERE revoked_at IS NULL`, `coalesce(scope_id,

  '00000000-â€¦')`).

- `operator_id` de l'attribution = `operator_id` de la personne (dÃ©clencheur, T002).



### T002 â€” Gardes (dÃ©clencheurs `SECURITY INVOKER`, `search_path` fixÃ©)



- `app_user` BEFORE UPDATE : `id`, `operator_id`, `issuer`, `subject`, `created_by`, `created_at` immuables ;

  `DISABLED â†’ ACTIVE` refusÃ© ; BEFORE DELETE : refus. Code `CL001` (`VALIDATION_FAILED`).

- `role_assignment` BEFORE INSERT : `operator_id` alignÃ© sur la personne ; objet de portÃ©e existant et du mÃªme

  prestataire (`party.operator_id` pour `ORGANIZER`/`MERCHANT`, `event.operator_id` pour `EVENT`, `party.id` pour

  `OPERATOR`) ; personne `ACTIVE`. BEFORE UPDATE : seules `revoked_at`/`revoked_by` peuvent passer de NULL Ã  une

  valeur, une fois ; retrait du dernier `PLATFORM_ADMIN` actif refusÃ© (`CL001` avec message explicite ; l'API le

  traduira `403`, voir WP06). BEFORE DELETE : refus.

- Code d'erreur : `CL001` partout (dÃ©jÃ  traduit `VALIDATION_FAILED` par la mission 1). Ne pas inventer de SQLSTATE.



### T003 â€” RLS et `identify_person`



- `ENABLE` + `FORCE ROW LEVEL SECURITY` ; politique `tenant_isolation` `USING` et `WITH CHECK` sur `operator_id`

  (mÃªme forme que `api_idempotency`).

- `identify_person(p_issuer text, p_subject text) RETURNS TABLE (user_id uuid, operator_id uuid, status text,

  assignments jsonb)` `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public` : personne par `(issuer,

  subject)` ; `assignments` = `jsonb_agg({role, scope_type, scope_id})` des attributions actives (tableau vide sinon).

  Aucune autre information.

- `REVOKE ALL â€¦ FROM PUBLIC` puis `GRANT EXECUTE â€¦ TO cashless_app` dans la migration (roles.sql le rendra de toute

  faÃ§on).



### T004 â€” Tests pgTAP (`packages/ledger-sql/tests/tests_identity.sql`)



Structure de `tests_api_idempotency.sql` (`BEGIN; â€¦ SELECT plan(n); â€¦ ROLLBACK;`, fixture minimale de parties en

rÃ´le propriÃ©taire). Couvrir : chaque `CHECK` (un cas refusÃ© par contrainte), unicitÃ© `(issuer, subject)`, une seule

attribution active, compatibilitÃ© rÃ´le â†” portÃ©e, objet d'un autre prestataire refusÃ©, auto-attribution refusÃ©e,

immuabilitÃ©, `DISABLED â†’ ACTIVE` refusÃ©, rÃ©tablissement refusÃ©, suppression refusÃ©e, dernier `PLATFORM_ADMIN`

non retirable (mais retirable s'il en reste un autre), RLS (sous `SET ROLE cashless_app` + `set_config` d'un autre

prestataire : 0 ligne visible, insertion refusÃ©e), `relforcerowsecurity`, `identify_person` (personne connue, rÃ´les

actifs seulement, inconnue â†’ 0 ligne, appelable par `cashless_app` sans `set_config`).



## Definition of Done



- `npm run reset-db -w @cashless/ledger-sql` applique `0003` ; `npm run test:pgtap -w @cashless/ledger-sql` vert

  (suites de rÃ©fÃ©rence intactes + nouvelle suite).

- Aucun fichier `.sql` gÃ©nÃ©rÃ© modifiÃ© ; `npm run check:generated -w @cashless/ledger-sql` vert.



## Risks / Reviewer guidance



- La compatibilitÃ© rÃ´le â†” portÃ©e et Â« mÃªme prestataire Â» sont des rÃ¨gles de sÃ©curitÃ© : un test par cas.

- `identify_person` ne doit rien exposer d'autre que la personne demandÃ©e.

