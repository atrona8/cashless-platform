---
work_package_id: WP01
title: Monorepo et outillage TypeScript
dependencies: []
requirement_refs:

- FR-001

planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts for this mission were generated on feat/fondations-grand-livre. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/fondations-grand-livre unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-fondations-grand-livre-01M4AY8M
base_commit: 8b7560774cde0a5bcba04ba9605811c253175555
created_at: '2026-10-07T12:30:11.821634+00:00'
subtasks:

- T001

- T002

- T003

- T004

- T005

phase: Phase 1 - Mise en place
history:

- timestamp: '2026-10-07T12:00:00Z'

  agent: claude

  action: Prompt generated via /spec-kitty.tasks

agent_profile: node-norris
authoritative_surface: apps/api/package.json
create_intent:

- package.json

- package-lock.json

- tsconfig.base.json

- eslint.config.mjs

- jest.preset.cjs

- apps/api/package.json

- apps/api/tsconfig.json

- apps/api/tsconfig.build.json

- apps/api/jest.config.cjs

- apps/api/test/smoke.spec.ts

- packages/contracts/package.json

- packages/contracts/tsconfig.json

- packages/ledger-sql/package.json

- packages/ledger-sql/tsconfig.json

execution_mode: code_change
owned_files:

- package.json

- package-lock.json

- tsconfig.base.json

- eslint.config.mjs

- jest.preset.cjs

- .gitignore

- apps/api/package.json

- apps/api/tsconfig.json

- apps/api/tsconfig.build.json

- apps/api/jest.config.cjs

- apps/api/test/smoke.spec.ts

- packages/contracts/package.json

- packages/contracts/tsconfig.json

- packages/ledger-sql/package.json

- packages/ledger-sql/tsconfig.json

role: implementer
tags: []
tracker_refs: []
---



# Work Package Prompt: WP01 – Monorepo et outillage TypeScript



## ⚡ Do This First: Load Agent Profile



Avant toute autre lecture, charge le profil assigné : `/ad-hoc-profile-load node-norris` (rôle `implementer`).

Puis lis `README.md` (racine), `docs/SPECIFICATION.md` §2.1 et `kitty-specs/fondations-grand-livre-01M4AY8M/plan.md`

(sections Technical Context, Supply-chain, Project Structure).



## Objective



Créer la racine du monorepo (npm workspaces) et l'outillage commun, et installer **en une fois** toutes les

dépendances npm dont la mission a besoin, avec versions exactes, pour que les WP suivants n'aient jamais à toucher

`package.json` ni le lockfile.



## Context



- Exigences : FR-001, C-005, C-008 (rien de V2 : pas de `packages/nfc-sdk`).

- Poste : Windows 10, Git Bash, Node 22.14, npm 11. Pas de pnpm.

- Les dossiers existants (`packages/ledger-sql`, `packages/contracts`, `packages/tag-format`, `tools/nfc-bench`,

  `reference`, `docs`) ne sont pas déplacés. Seuls `apps/api`, `packages/contracts`, `packages/ledger-sql`

  deviennent des workspaces npm (`packages/tag-format` reste hors workspace : mission 4).



## Branch Strategy



Planification et merge sur `feat/fondations-grand-livre`. Le worktree d'exécution est attribué par lane

(`lanes.json`) ; commande : `spec-kitty agent action implement WP01 --agent claude`.



## Subtasks



### T001 — Racine npm workspaces et scripts



- `package.json` racine : `"private": true`, `"name": "cashless-platform"`, `"workspaces": ["apps/api",

  "packages/contracts", "packages/ledger-sql"]`, `"engines": {"node": ">=22 <23"}`.

- Scripts : `lint` (`eslint .`), `test` (`npm test --workspaces --if-present`), `typecheck`

  (`npm run typecheck --workspaces --if-present`), `generate` (`npm run generate -w @cashless/contracts`).

- Paquets : `@cashless/api` (`apps/api`), `@cashless/contracts`, `@cashless/ledger-sql`, tous `private`.

- `.gitignore` : ajouter `.env.test`, `*.tsbuildinfo`, `apps/api/dist/` (déjà `dist/`), sans retirer l'existant.



### T002 — TypeScript strict partagé



- `tsconfig.base.json` : `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes: false`,

  `target: ES2022`, `module: commonjs` (NestJS), `experimentalDecorators`, `emitDecoratorMetadata`,

  `esModuleInterop`, `skipLibCheck`, `resolveJsonModule`.

- `apps/api/tsconfig.json` (étend la base, `include: ["src", "test"]`) et `tsconfig.build.json` (`src` seul,

  `outDir: dist`). `packages/*/tsconfig.json` idem pour `src`/`scripts`.

- Chemins : `@cashless/contracts` résolu via le workspace (pas d'alias `paths` nécessaire).



### T003 — Dépendances exactes, lockfile, `--ignore-scripts`



Installer (versions **exactes**, `npm install --save-exact --ignore-scripts`) :

- `apps/api` : `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` (11.x), `reflect-metadata`, `rxjs`,

  `pg` (8.x), `canonicalize` ; dev : `@nestjs/testing`, `@types/pg`, `@types/express`, `supertest`,

  `@types/supertest`.

- `packages/contracts` : dev `openapi-typescript` (7.x).

- `packages/ledger-sql` : `pg` ; dev `@types/pg`, `tsx` (exécution des scripts TS).

- Racine (dev) : `typescript` (5.x), `jest` (29.x), `@swc/core`, `@swc/jest`, `@types/jest`, `@types/node` (22.x),

  `eslint` (9.x), `typescript-eslint`, `@eslint/js`.

- Vérifier : `rm -rf node_modules && npm ci --ignore-scripts` puis `npx swc --version` / un test Jest qui compile ;

  si le binaire SWC manque sans script, basculer sur `ts-jest` et l'écrire dans `research.md` (R-11 A1).

- Registre officiel uniquement (`npm config get registry` = `https://registry.npmjs.org/`).



### T004 — ESLint



- `eslint.config.mjs` (flat config) : `@eslint/js` recommended + `typescript-eslint` recommended.

- Règle locale pour `apps/api/src/ledger/**` : `no-restricted-syntax` interdisant `Number(`, `parseFloat(`,

  `parseInt(`, `Math.round`/`Math.floor`/`Math.ceil` et les littéraux décimaux (`Literal[raw=/\./]`) — message :

  « montants en bigint uniquement (SPECIFICATION §5.5) ».

- Ignorer `**/dist/**`, `packages/contracts/generated/**`, `tools/nfc-bench/**`.



### T005 — Jest + SWC et test fumée



- `jest.preset.cjs` (racine) : transform `@swc/jest` avec décorateurs (`jsc.parser.decorators: true`,

  `jsc.transform.legacyDecorator: true`, `decoratorMetadata: true`), `testEnvironment: node`.

- `apps/api/jest.config.cjs` : preset, `roots: ["<rootDir>/test"]`, projets ou `testPathPattern` utilisables :

  `npm test -w @cashless/api -- money` doit filtrer.

- `apps/api/test/smoke.spec.ts` : vérifie `typeof 1n === "bigint"` et l'import de `@nestjs/core`.

- Scripts `apps/api` : `test` (`jest`), `typecheck` (`tsc -p tsconfig.json --noEmit`), `build`, `start`.



## Definition of Done



- `npm ci --ignore-scripts`, `npm run lint`, `npm run typecheck`, `npm test` passent à la racine.

- Lockfile commité ; toutes les versions exactes (aucun `^`/`~`).

- Aucun fichier V2 ; aucun fichier du kit modifié hors `.gitignore`.



## Risks / Reviewer guidance



- Vérifier l'absence de `^` dans les trois `package.json`. Vérifier que la règle ESLint « pas de flottant » cible

  bien `apps/api/src/ledger/**` (tester en introduisant `Number(x)` puis retirer).

