---
work_package_id: WP10
title: Processus de maintenance (rôle cashless_maint) et purges hors de l'API publique
dependencies: [WP08]
requirement_refs:
- FR-040
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-hors-ligne-snapshots-lots-01M645RN
base_commit: 7765a96a56c7e03ddb456ab1149fa819eda7ce7f
created_at: '2026-11-02T10:26:17.257554+00:00'
subtasks: [T042, T043, T044]
phase: Phase 2 - Ports et processus
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/processes/maintenance.module.ts
create_intent: [apps/api/src/main.maintenance.ts, apps/api/src/processes/maintenance.module.ts, apps/api/src/db/maintenance-db.module.ts, apps/api/test/integration/maintenance/purge.spec.ts, apps/api/test/integration/maintenance/process-guard.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/main.maintenance.ts, apps/api/src/processes/maintenance.module.ts, apps/api/src/db/maintenance-db.module.ts, apps/api/src/device-identity/device-maintenance.ts, apps/api/src/devices/devices.module.ts, apps/api/test/unit/architecture.spec.ts, apps/api/test/integration/maintenance/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 – Processus de maintenance

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement : `research.md` R-30.12 (OP-N75) et R-30.8 (liste des
ports figée par test), `contracts/interfaces.md` § 8 (configuration) et § 11 (ligne `maintenance`),
`contracts/database-rights.md` (retrait OP-N75, rôle `cashless_maint`), `spec.md` FR-039 s'il cite
la maintenance. Priorité des sources (SPECIFICATION §0.3) : contradiction signalée, jamais choisie en
silence. Ne modifie jamais un `.sql` généré de `packages/ledger-sql/`.

## Objective

Sortir les deux purges de terminaux (nonces de requête, essais d'enrôlement) de l'API publique : un
processus `maintenance` sans route, sous le rôle `cashless_maint` (seul à pouvoir les exécuter après
WP08), sans aucun port de clé. L'API publique n'a plus de travailleur de purge ni d'`EXECUTE` sur ces
fonctions. Le test d'architecture est étendu aux processus de la mission.

## Périmètre et arbitrages

Dans le lot : l'entrée `main.maintenance.ts`, `processes/maintenance.module.ts`,
`db/maintenance-db.module.ts`, le déplacement de `DevicePurgeWorker`, le retrait de
`DeviceMaintenanceModule` de `devices.module.ts`, `architecture.spec.ts`, la configuration
`DATABASE_URL_MAINT` et ses tests.
Hors lot : le rôle SQL et les `GRANT` (WP08, déjà fait), les processus `snapshot-content` (WP11) et
`snapshot-signer` (WP13), le script `start:maintenance` (retouche hors carte de
`apps/api/package.json`, une ligne de rapport), `config.ts` (retouche hors carte, une ligne de
rapport) et `src/app.module.ts` s'il y a lieu.
Décisions : OP-N75 (purges retirées à `cashless_app`, accordées à `cashless_maint` seul) ; R-30.8
(liste des ports et des droits de chaque processus figée par test) ; modèle `psp-poller` pour la forme
d'un processus sans clé, mais avec SON rôle de base (contrairement à `psp-poller-db.module.ts`).

## Subtasks

### T042 – Processus `maintenance`

Modèles : `main.psp-poller.ts` (13 lignes), `processes/psp-poller.module.ts:12`,
`processes/tag-check.module.ts:11`, `db/process-db.module.ts:46` (un pool, un rôle),
`db/psp-poller-db.module.ts:22` (variante sans `KeyProcess`).
- `db/maintenance-db.module.ts` : module global, UN pool sur `config.maintenanceDatabaseUrl`
  (`DATABASE_URL_MAINT`), `TenantTx`, fermeture à l'arrêt (`ProcessPoolCloser`, `:29`), parseur
  `int8 → bigint` (`:17`). Chaîne vide : `throw new Error('DATABASE_URL_MAINT manquant : chaîne de
  connexion du processus maintenance obligatoire')` (message du `forProcess`, `:57-60`). Aucun
  import de `platform-tx` ni de `config.databaseUrl`.
- `processes/maintenance.module.ts` : `MaintenanceDbModule`, `ProcessBaseModule` (fournit
  `WorkerRegistry`), `AuditModule` seulement si le travailleur l'utilise (non : ne pas l'importer),
  puis `DeviceMaintenanceModule`. Aucun `KmsModule` (ports de clé : aucun).
- `main.maintenance.ts` : copie de `main.psp-poller.ts` avec `MaintenanceProcessModule`
  (`runWorkers`, code de sortie, `--once`, `--list`). Commentaire de tête : code d'alerte 0.
- Clé de configuration (retouche hors carte de `config/config.ts`, motif `tagUrl`, `:711` ; URL
  locale `LOCAL_TAG_URLS`, `:167`) : `DATABASE_URL_MAINT`, champ `maintenanceDatabaseUrl`, vide
  accepté hors du processus qui s'en sert et hors production (URL locale de `cashless_maint`).
- Critère : `--list` affiche la ligne du travailleur ; `--once` purge sous `cashless_maint`.

### T043 – Travailleur déplacé hors de l'API publique

Fichier : `device-identity/device-maintenance.ts` (`DevicePurgeWorker` `:31`, `onModuleInit` `:43`,
`runOnce` `:51`, `DeviceMaintenanceModule` `:75`).
- Le travailleur se range déjà dans le `WorkerRegistry` du processus qui charge son module : il suffit
  de ne plus le charger dans l'API. Retirer `DeviceMaintenanceModule` de `devices/devices.module.ts`
  (import `:7` et ligne `:17`). Garder le fichier à sa place. Corriger l'en-tête (`:1-8`) : travailleur
  du processus `maintenance`, rôle `cashless_maint` ; l'ancien « cashless_app, section 4a » est faux.
- `runOnce` (`:51`) lit l'horloge `Date.now()` et `INTERVAL` 300 s : conserver ; le test passe `now`.
- Test existant à adapter (HORS CARTE, une ligne de rapport) :
  `test/integration/end-to-end/media-port-swap.spec.ts:306` attend `device-purge` dans le registre de
  l'API publique ; il doit attendre l'inverse (absent de l'API, présent dans le processus
  `maintenance`). Ce fichier n'a pas de propriétaire : retouche minimale, signalée.
- Critère : l'API publique (`public.module.ts`) n'atteint plus `device-maintenance.ts` ; un appel
  des purges sous `cashless_app` échoue (`42501`, effet de WP08, prouvé ici sans nouvelle migration).

### T044 – Configuration, architecture, tests

- `architecture.spec.ts` (propriété exclusive de ce lot ; WP09, WP11 et WP13 y ajoutent leurs
  lignes par retouche hors carte signalée, ne pas les attendre) : étendre `ROOTS` (`:106`),
  `CAPABILITIES` (`:114`, `maintenance: []`), la liste des points d'entrée (`:211-219` : ajouter
  `main.maintenance.ts`) et le test « chaque processus … pool de son rôle » (`:182`) : `maintenance`
  contient `MaintenanceDbModule`, jamais `DbModule` ni `platform-tx`.
  Ajouter : (a) `device-maintenance.ts` n'est pas atteignable depuis `processes/public.module.ts` ;
  (b) `maintenance-db.module.ts` ne nomme ni `PG_PLATFORM_POOL`, ni `platformDatabaseUrl`, ni
  `config.databaseUrl`.
  Écrire les tests de façon à tolérer l'absence des processus WP11/WP13 tant qu'ils n'existent pas
  (entrées de `ROOTS` ajoutées par ces lots).
- `test/unit/config.spec.ts` (retouche hors carte, existant) : `DATABASE_URL_MAINT` — vide accepté
  hors production et en production au chargement ; URL locale par défaut hors production.
- `test/integration/maintenance/process-guard.spec.ts` : en production, le processus refuse de
  démarrer si `DATABASE_URL_MAINT` est vide (erreur de `MaintenanceDbModule`), et `assertProcessIsSafe`
  passe (aucun faux présent). Faux terminal ou faux service de clés : absents du processus.
- Critère : suites vertes ; la liste des ports du processus est `[]` et figée.

## Sécurité

- Ce processus n'a AUCUN port de clé et aucun accès aux données métier : toute dépendance qui ajoute
  `KmsModule`, `PlatformTx` ou le pool applicatif est un affaiblissement, soumis au porteur avant
  codage (règle 1 de `CLAUDE.md`).
- Le retrait d'`EXECUTE` à `cashless_app` (OP-N75) est posé par WP08 ; ce lot en fournit la preuve
  côté API (plus de travailleur) et côté base (appel sous `cashless_app` refusé).
- Pas de faux ici, mais le processus passe quand même par `assertProcessIsSafe` (via `runWorkers`).
- Fichiers à faire relire par une personne : aucun spécifique. `db/maintenance-db.module.ts` est un
  point de droits de base : le signaler au porteur comme « à regarder » si l'URL par défaut change.

## Tests

- `test/integration/maintenance/purge.spec.ts` : `--once` (appel de `runWorkers` ou de
  `WorkerRegistry.drain`) retire des nonces expirés et des essais de plus de 24 h sous
  `cashless_maint` ; un nonce non expiré reste ; intervalle de 300 s respecté (`runOnce(now)`).
- `test/integration/maintenance/process-guard.spec.ts` : T044.
- `test/unit/architecture.spec.ts` et `test/unit/config.spec.ts`.
- Commandes : `npx jest test/unit/architecture.spec.ts test/unit/config.spec.ts` ; intégration en base
  de lot `cashless_wp10` (le lot ne lance pas Jest sur `cashless_test`, l'orchestrateur relance).

## Ce que le relecteur doit casser

1. Remettre `DeviceMaintenanceModule` dans `devices.module.ts` : le test d'architecture échoue.
2. Importer `KmsModule` dans `maintenance.module.ts` : échec du test des ports.
3. Lancer le processus avec `DATABASE_URL_MAINT` vide en production : refus de démarrer.
4. Lancer `--once` avec la chaîne du rôle applicatif dans `DATABASE_URL_MAINT` : la purge échoue
   (`42501`) au lieu de réussir silencieusement ; le code de sortie n'est pas 0.
5. Appeler les purges sous `cashless_app` dans une suite : refus.
6. `--list` n'écrit rien en base (comparer avant et après).
7. Deux enregistrements du même nom de travailleur : `Travailleur déjà enregistré`.
8. Retirer `main.maintenance.ts` de la liste des points d'entrée : le test des `main*.ts` échoue.

## Definition of Done

- [ ] Processus `maintenance` démarrable (`--once`, `--list`), un pool, rôle `cashless_maint`.
- [ ] `DevicePurgeWorker` absent de l'API publique ; `devices.module.ts` nettoyé.
- [ ] `architecture.spec.ts` étendu (entrée, ports `[]`, pool du rôle, API sans purge).
- [ ] `DATABASE_URL_MAINT` : configuration, test, refus en production si vide au démarrage du processus.
- [ ] Retouches hors carte listées dans le rapport : `config.ts`, `package.json` (`start:maintenance`),
      `config.spec.ts`, `media-port-swap.spec.ts`.
- [ ] Lignes de 100 caractères au plus ; aucun `.sql` généré modifié.

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP10 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
