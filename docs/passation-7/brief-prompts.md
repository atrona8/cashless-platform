# Fiche des rédacteurs de prompts — mission 7 (`hors-ligne-snapshots-lots-01M645RN`)

Dépôt : /Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform, branche `feat/hors-ligne-snapshots-lots`.
Dossier : `kitty-specs/hors-ligne-snapshots-lots-01M645RN/` (noté `KS/`). Tu écris SEULEMENT les fichiers
`KS/tasks/WPxx-<slug>.md` de tes lots (dossier plat, aucun sous-dossier). Pas de commit, pas de commande spec-kitty,
pas de tests. Ne relis pas CLAUDE.md, README ni SPECIFICATION.md en entier.

## À lire

1. `KS/tasks.md` (découpage, sous-tâches, dépendances, règles communes) — **fait foi sur le découpage**.
2. `KS/contracts/interfaces.md` — **noms, signatures, migrations, SQLSTATE figés** : un prompt y RENVOIE, il ne les
   recopie pas en entier et ne les change jamais.
3. Pour tes lots seulement : sections utiles de `KS/research.md` (R-30 fait foi), `KS/data-model.md`, `KS/contracts/*.md`,
   `KS/spec.md` (FR/NFR cités). Exemple de forme (plus long que voulu) : `kitty-specs/recharges-caisses-psp-01M5YEBA/
   tasks/WP02-base-sessions-caisse.md`.
4. Le code existant cité par ton lot, pour donner des renvois `fichier:ligne` exacts (vérifie qu'ils existent).

## Format du prompt (décision du 27/10/2026 : prompts allégés)

- **150 à 250 lignes** (300 au plus pour un lot de 6 sous-tâches). Pas de reformulation du plan : des renvois précis
  (« R-30.7 », « contracts/batches.md § Reprise », « interfaces.md § 4 »).
- Frontmatter YAML (copier la forme exacte de l'exemple de la mission 6, valeurs de la mission 7) :
  `work_package_id`, `title`, `dependencies` (de `tasks.md`), `requirement_refs: []` (rempli ensuite par
  l'orchestrateur), `planning_base_branch: feat/hors-ligne-snapshots-lots`, `merge_target_branch:
  feat/hors-ligne-snapshots-lots`, `branch_strategy` (phrase du modèle adaptée), `subtasks`, `phase`, `agent: claude`,
  `model: sonnet`, `agent_profile: implementer-ivan`, `role: implementer`, `execution_mode: code_change`,
  `owned_files`, `authoritative_surface`, `create_intent` (fichiers nouveaux de `owned_files`), `history` (une entrée
  `2026-10-30T12:00:00Z`, `claude`, `Prompt generated via /spec-kitty.tasks`), `tags: []`, `tracker_refs: []`.
  **Ne mets PAS** `base_branch`, `base_commit`, `created_at`, `lane` : `finalize-tasks` les pose.
- Corps, dans cet ordre :
  1. `## ⚡ Do This First: Load Agent Profile` (première section, obligatoire) : `/ad-hoc-profile-load
     implementer-ivan`, puis la fiche de contexte d'implémentation de l'orchestrateur, ce prompt, et la liste EXACTE des
     sections à lire (pas plus) ; rappel priorité §0.3 et contradiction signalée ; `.sql` générés intouchables.
  2. `## Objective` (3 à 6 lignes).
  3. `## Périmètre et arbitrages` : ce qui est dans le lot, ce qui n'y est pas (et quel lot le fait), décisions déjà
     prises qui le concernent (porteur, R-30).
  4. `## Subtasks` : une sous-section par `Txxx` : but, fichiers, étapes clés, cas limites, critère vérifiable.
     10 à 30 lignes chacune.
  5. `## Sécurité` : points qui affaiblissent la sécurité si mal faits ; rappel règle 1 (écart = au porteur avant
     code) ; fichiers à faire relire par une personne s'il y en a.
  6. `## Tests` : suites à écrire, commandes (le lot ne lance pas Jest/pgTAP sur `cashless_test` : base de lot
     `cashless_wpXX`, voir la fiche d'implémentation ; l'orchestrateur relance en série).
  7. `## Ce que le relecteur doit casser` : 4 à 8 attaques concrètes.
  8. `## Definition of Done` (cases à cocher) et `## Branch Strategy` (branche de planification et de fusion
     `feat/hors-ligne-snapshots-lots`, worktree par lane calculée dans `lanes.json`, commande
     `spec-kitty agent action implement WPxx --agent claude --mission hors-ligne-snapshots-lots-01M645RN`).
  9. `## Activity Log` (vide, avec la ligne d'historique).

## Règles transverses à reprendre dans les prompts concernés

- Tests pgTAP des lots WP02 à WP07 : **sous le propriétaire uniquement** (pas de `SET ROLE`) ; les tests de droits
  sous `cashless_app` et les autres rôles sont dans WP08 (`tests_offline_rights.sql`), qui pose aussi le défaut
  global. Chaque migration : `REVOKE ALL … FROM PUBLIC` sur ses fonctions, aucun `GRANT` (WP08).
- Toute table nouvelle : `operator_id`, RLS `tenant_isolation` ENABLE + FORCE (R-30.2).
- Fichiers sans propriétaire (retouche hors carte, une ligne dans le rapport) : `apps/api/src/audit/audit.service.ts`,
  `apps/api/src/config/config.ts`, `apps/api/package.json`, `apps/api/jest.config.cjs`, `apps/api/src/app.module.ts`.
- Aucune recharge espèces hors ligne ; deux processus de snapshots ; trace `RETRY` ; exposition stricte.
- Écrire en français, phrases courtes, lignes de 100 caractères au plus.

## Propriété des fichiers (aucun chevauchement ; chemins relatifs à la racine)

| Lot | `owned_files` | `authoritative_surface` |
|---|---|---|
| WP01 | `packages/contracts/openapi.yaml`, `packages/contracts/src/**`, `packages/contracts/dart/**`, `apps/api/src/http/messages.fr.json`, `apps/api/src/http/messages.en.json`, `apps/api/src/errors/sqlstate-map.ts` | `packages/contracts/` |
| WP02 | `packages/ledger-sql/migrations/0043_offline_policy.sql`, `packages/ledger-sql/tests/tests_offline_policy.sql` | `packages/ledger-sql/migrations/0043_offline_policy.sql` |
| WP03 | `…/migrations/0044_offline_snapshots.sql`, `…/tests/tests_offline_snapshots.sql` | idem migration |
| WP04 | `…/migrations/0045_offline_snapshot_keys.sql`, `…/tests/tests_offline_snapshot_keys.sql` | idem |
| WP05 | `…/migrations/0046_offline_batches.sql`, `…/tests/tests_offline_batches.sql` | idem |
| WP06 | `…/migrations/0047_offline_anomalies.sql`, `…/tests/tests_offline_anomalies.sql` | idem |
| WP07 | `…/migrations/0048_offline_device_vendor.sql`, `…/tests/tests_offline_device_vendor.sql` | idem |
| WP08 | `packages/ledger-sql/post-roles.sql`, `…/migrations/0049_rights_hardening.sql`, `…/tests/_grants_for_tests.sql`, `…/tests/tests_offline_rights.sql`, et la liste EXPLICITE des 41 suites existantes `packages/ledger-sql/tests/tests_<nom>.sql` (lister chaque fichier, pas de glob) | `packages/ledger-sql/post-roles.sql` |
| WP09 | `apps/api/src/kms/**`, `apps/api/src/processes/bootstrap.ts`, `apps/api/src/processes/key-admin.module.ts`, `apps/api/src/snapshot-keys/**`, `apps/api/test/unit/kms/**`, `apps/api/test/unit/production-guard.spec.ts`, `apps/api/test/integration/snapshot-keys/**` | `apps/api/src/kms/` |
| WP10 | `apps/api/src/main.maintenance.ts`, `apps/api/src/processes/maintenance.module.ts`, `apps/api/src/db/maintenance-db.module.ts`, `apps/api/src/device-identity/device-maintenance.ts`, `apps/api/src/devices/devices.module.ts`, `apps/api/test/unit/architecture.spec.ts`, `apps/api/test/integration/maintenance/**` | `apps/api/src/processes/maintenance.module.ts` |
| WP11 | `apps/api/src/snapshots-content/*.ts`, `apps/api/src/main.snapshot-content.ts`, `apps/api/src/processes/snapshot-content.module.ts`, `apps/api/src/db/snapshot-content-db.module.ts`, `apps/api/test/integration/snapshots-content/cadence*.spec.ts`, `apps/api/test/unit/snapshots-content/build*.spec.ts` | `apps/api/src/snapshots-content/` |
| WP12 | `apps/api/src/snapshots-content/crypto/**`, `packages/tag-format/src/device-envelope.ts`, `packages/tag-format/test/**`, `apps/api/test/integration/snapshots-content/secrets*.spec.ts`, `apps/api/test/unit/snapshots-content/crypto*.spec.ts` | `apps/api/src/snapshots-content/crypto/` |
| WP13 | `apps/api/src/snapshots-signer/**`, `apps/api/src/main.snapshot-signer.ts`, `apps/api/src/processes/snapshot-signer.module.ts`, `apps/api/src/db/snapshot-signer-db.module.ts`, `apps/api/test/integration/snapshots-signer/**` | `apps/api/src/snapshots-signer/` |
| WP14 | `apps/api/src/offline/policy/**`, `apps/api/test/integration/offline/policy*.spec.ts` | `apps/api/src/offline/policy/` |
| WP15 | `apps/api/src/offline/snapshots/**`, `apps/api/src/devices/config/device-config.service.ts`, `apps/api/src/devices/heartbeat/heartbeat.controller.ts`, `apps/api/test/integration/offline/snapshots*.spec.ts` | `apps/api/src/offline/snapshots/` |
| WP16 | `apps/api/src/payments/chained-content.ts`, `apps/api/src/payments/device-seq-registry.ts`, `apps/api/src/payments/payments.service.ts`, `apps/api/src/idempotency/device-key.ts`, `apps/api/src/topups/cash/cash-topup.service.ts`, `apps/api/src/reversals/reversal.dto.ts`, `apps/api/src/offline/anomalies/**`, `apps/api/test/unit/payments/device-seq-registry.spec.ts`, `apps/api/test/unit/payments/chained-content.spec.ts`, `apps/api/test/unit/idempotency/device-key-offline.spec.ts`, `apps/api/test/fixtures/offline-vectors/**` | `apps/api/src/payments/` |
| WP17 | `apps/api/src/offline/rules/**`, `apps/api/test/unit/offline/**` | `apps/api/src/offline/rules/` |
| WP18 | `apps/api/src/offline/batches/**`, `apps/api/test/support/test-terminal.ts`, `apps/api/test/integration/offline/batches*.spec.ts` | `apps/api/src/offline/batches/` |
| WP19 | `apps/api/src/offline/processing/**`, `apps/api/src/ledger/types.ts`, `apps/api/src/ledger/ledger-engine.service.ts`, `apps/api/src/ledger/builders/festival/purchase.ts`, `apps/api/src/ledger/money/spend.ts`, `apps/api/src/media/taps/tap.service.ts`, `apps/api/test/integration/offline/processing*.spec.ts`, `apps/api/test/unit/ledger/offline-spend.spec.ts` | `apps/api/src/offline/processing/` |
| WP20 | `apps/api/src/offline/seq/**`, `apps/api/src/offline/journal/**`, `apps/api/test/integration/offline/seq*.spec.ts`, `apps/api/test/integration/offline/journal*.spec.ts` | `apps/api/src/offline/seq/` |
| WP21 | `apps/api/test/integration/end-to-end/offline-*.spec.ts`, `apps/api/test/integration/end-to-end/snapshot-latency.spec.ts`, `apps/api/test/support/offline-dataset.ts`, `.github/workflows/ledger-tests.yml`, `docs/POINTS_OUVERTS.md`, `docs/DECISIONS_ADR.md` | `apps/api/test/integration/end-to-end/` |

Vérifie l'existence des fichiers « existants » de ta liste (`ls`) ; si un chemin existant diffère (ex. nom du
workflow CI), corrige-le dans le prompt et signale-le dans ton rapport. Mets dans `create_intent` chaque fichier
nouveau littéral (pas les globs).
