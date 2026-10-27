# Fiche commune — rédaction des prompts de lots (mission 6)

Dépôt : `/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform`, branche `feat/recharges-caisses-psp`.
Mission : `recharges-caisses-psp-01M5YEBA`. Dossier : `kitty-specs/recharges-caisses-psp-01M5YEBA/` (`<M>` ci-dessous).

## À lire (dans cet ordre, pas plus large)
1. `<M>/tasks.md` (découpage, sous-tâches, fichiers attribués, dépendances) — fait foi pour le périmètre de chaque lot.
2. `<M>/plan.md`, `<M>/research.md` (**la section R-20 fait foi** sur les sections antérieures), `<M>/research-adversarial.md`,
   `<M>/data-model.md`, `<M>/contracts/*.md`, `<M>/spec.md` (FR/NFR/C cités par tes lots).
3. Modèle de format : `kitty-specs/terminaux-paiement-en-ligne-01M52QB9/tasks/WP02-base-vendeurs-sessions.md` (lot base) et
   `kitty-specs/terminaux-paiement-en-ligne-01M52QB9/tasks/WP11-paiement-bracelet.md` (lot API). Copie leur structure.
4. Pour écrire des consignes exactes, va lire le code existant que tes lots modifient ou imitent (chemins dans tasks.md
   et plan.md), par exemple : `packages/ledger-sql/migrations/0031_vendors.sql`, `0033_payments.sql` (style des fonctions,
   `search_path`, `assert_tenant`, codes `CLxxx`), `apps/api/src/media/lifecycle/` (counter-access, deposit, cash-due,
   release), `apps/api/src/approval/action-registry.ts` et une action existante (`apps/api/src/reversals/`),
   `apps/api/src/processes/` (bootstrap, worker, public.module), `apps/api/src/kms/production-guard.ts`,
   `apps/api/src/ledger/` (moteur, constructeurs), `apps/api/src/payments/` (service transactionnel de la 5b),
   `apps/api/src/idempotency/`, `apps/api/src/device-identity/`, `apps/api/src/customer-identity/`. Cite des fichiers et
   fonctions qui existent vraiment (vérifie-les). Ne relis pas CLAUDE.md, README ni la SPECIFICATION en entier.

## Fichier à produire par lot
`<M>/tasks/WPxx-<slug>.md` (slug exact donné dans tasks.md, dossier `tasks/` plat). Écris seulement tes fichiers ; ne
touche à rien d'autre (ni tasks.md, ni code). Ne commite rien.

### Frontmatter (YAML, exactement ces clés)
```yaml
---
work_package_id: WPxx
title: <titre du lot dans tasks.md>
dependencies: [<WP de tasks.md>]
requirement_refs: [<liste donnée plus bas>]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
subtasks: [<Txxx du lot>]
phase: <Phase de tasks.md>
agent: claude
model: sonnet
agent_profile: implementer-ivan
role: implementer
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
authoritative_surface: <préfixe commun des owned_files>
execution_mode: code_change
owned_files: [<liste exacte de tasks.md>]
create_intent: [<chemins littéraux des fichiers nouveaux parmi owned_files ; pas de glob>]
tags: []
tracker_refs: []
---
```
`authoritative_surface` doit être un préfixe d'au moins une entrée de `owned_files`. Pour un `owned_files` en glob dont
le dossier n'existe pas encore, mets dans `create_intent` au moins un fichier littéral que le lot créera dans ce dossier.

### Corps (sections, en français)
1. `# Work Package Prompt: WPxx – <titre>`
2. `## ⚡ Do This First: Load Agent Profile` — **première section** : « Charge le profil : `/ad-hoc-profile-load
   implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent : claude). Lis ensuite la fiche de contexte
   d'implémentation fournie par l'orchestrateur, ce prompt, puis seulement : » + la liste précise des sections de
   spec/plan/research/data-model/contracts et du code de référence utiles à CE lot ; rappel de la priorité des sources
   (§0.3, contradiction signalée) et « ne modifie jamais un `.sql` généré de `packages/ledger-sql/` ».
3. `## Objective` (3-5 lignes).
4. `## Context` : concern(s) IC du plan, décisions et constats (R-xx, Axx) qui s'appliquent, ce qui dépend de ce lot.
5. `## Arbitrages de l'orchestrateur (27/10/2026)` : les points de R-20 qui touchent ce lot, formulés comme des
   consignes impératives (c'est la section qui prime en cas de doute).
6. `## Branch Strategy` : planification et fusion sur `feat/recharges-caisses-psp` ; worktree par lane d'après
   `lanes.json` ; commande `spec-kitty agent action implement WPxx --agent claude --mission recharges-caisses-psp-01M5YEBA`.
7. `## Subtasks` : une sous-section `### Txxx — <titre>` par sous-tâche, **30 à 70 lignes chacune** : but, étapes
   numérotées, signatures (SQL : nom, paramètres, retour, SECURITY DEFINER, `search_path`, verrous, codes d'erreur ;
   TS : classe, méthode, route, statut HTTP, code de problème), fichiers, cas limites, validation (cases à cocher).
8. `## Test Strategy` : tests à écrire et commandes (pgTAP sur sa propre base `cashless_wpXX`, Jest ciblé) ; rappeler que
   `cashless_test` est réservée à l'orchestrateur.
9. `## Definition of Done` : cases à cocher, dont « compte rendu du lot » (écarts au plan avec leur sens, retouches hors
   carte justifiées, points soumis au porteur, fichiers à faire relire par une personne, critères couverts avec preuve).
10. `## Risks` et `## Reviewer Guidance` (ce que le relecteur doit tenter de casser : droits, contournement de garde,
    double crédit, fuite de secret, isolation, test qui ne prouve pas ce qu'il dit).

Taille : 200 à 500 lignes par prompt (700 au plus). Lignes de 100 caractères au plus.

## Règles à répéter dans chaque prompt
- Règle 1 de CLAUDE.md : aucun écart qui affaiblit la sécurité (droit plus large, contrôle retiré ou reporté, secret plus
  exposé, faux gardé) n'est codé sans l'accord du porteur ; le décrire dans le compte rendu, continuer le reste.
- Aucun faux en production. Pas de nouvelle dépendance npm (R-18).
- Hors carte : seules des retouches d'une ligne justifiées (ex. importer un module dans `apps/api/src/app.module.ts`
  ou `processes/public.module.ts`, possédés par WP07 ; ajouter un code dans `errors/sqlstate-map.ts`, possédé par WP07).
- Tests en série par l'orchestrateur ; base propre au lot pour valider ; horloge Docker (aucune comparaison d'horloge
  Node/base) ; lignes de 100 caractères.
- Matrice d'acceptation : chaque critère couvert par le lot est passé à `pass` avec sa preuve à l'approbation
  (l'orchestrateur la tient ; le compte rendu fournit commande + résultat).

## `requirement_refs` par lot
- WP01 : FR-030, C-001
- WP02 : FR-001, FR-002, FR-003, FR-004, FR-006, NFR-007, NFR-008, C-002, C-004
- WP03 : FR-009, FR-010, FR-011, FR-023, C-004
- WP04 : FR-012, FR-013, FR-016, FR-017, FR-018, FR-019, FR-024, FR-025, FR-026, FR-027, NFR-001, C-009
- WP05 : C-004, NFR-005
- WP06 : FR-005, FR-006
- WP07 : FR-020, FR-021, FR-022, NFR-003, NFR-004, C-003, C-005, C-006, C-007
- WP08 : FR-001, FR-002, FR-003, FR-029, FR-031
- WP09 : FR-004, FR-005, FR-007, FR-008, NFR-009
- WP10 : FR-009, FR-010, FR-011, FR-023, FR-031
- WP11 : FR-012, FR-013, FR-016, FR-017, FR-018, FR-024, FR-025, FR-026, C-009, C-010
- WP12 : FR-014, FR-015, FR-019, NFR-002, NFR-006
- WP13 : FR-027, FR-028
- WP14 : NFR-001, NFR-007, NFR-008, NFR-010, FR-031, C-008

Réponse finale à l'orchestrateur : 6 lignes max (fichiers écrits, nombre de lignes de chacun, points d'incertitude ou
contradictions trouvées dans le plan).
