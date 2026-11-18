# Consigne de rédaction des prompts de lots (mission 11a)

Tu rédiges des prompts de lots Spec Kitty. Lecture seule partout SAUF les fichiers
`kitty-specs/durcissements-serveur-01M7QAJD/tasks/WPxx-<slug>.md` de tes lots. Ne commite rien.
Ne relis pas CLAUDE.md, README ni SPECIFICATION.

À lire : `kitty-specs/durcissements-serveur-01M7QAJD/` : `tasks.md` (sous-tâches et slugs : noms de fichiers
EXACTS donnés dans les liens « Prompt »), `interfaces.md` (fait foi), `plan.md` (IC-01 à IC-10), `spec.md`,
`research.md` et, pour tes lots, la recherche détaillée `research/R-*.md` concernée ; la fiche commune
`docs/passation-11a/fiche-implementation.md`. Modèle de forme : `kitty-specs/versements-rapprochements-cloture-01M7JT4G/tasks/WP06-droits-base.md`
(frontmatter et sections). **Ne recopie pas le plan** : renvoie aux sections (« plan.md IC-02 », « R-N60 §5 »,
`interfaces.md` table X) et ajoute seulement ce qu'il faut pour agir.

Chaque prompt : 150 à 250 lignes, en français, lignes ≤ 120 caractères. Structure :
1. Frontmatter YAML (ordre et champs du modèle) :
   work_package_id, title, dependencies, requirement_refs, planning_base_branch: feat/durcissements-serveur,
   merge_target_branch: feat/durcissements-serveur, branch_strategy (phrase du modèle adaptée à feat/durcissements-serveur),
   subtasks, phase, agent: claude, history (timestamp '2026-11-18T16:00:00Z', agent claude, action « Prompt generated via
   /spec-kitty.tasks »), agent_profile: implementer-ivan, authoritative_surface, create_intent (fichiers nouveaux, chemins
   littéraux), execution_mode: code_change, model: sonnet, owned_files (EXACTEMENT la liste donnée ci-dessous, rien
   d'autre), role: implementer, tags: [], tracker_refs: [].
2. `# Work Package Prompt: WPxx : <titre>`
3. `## ⚡ Do This First: Load Agent Profile` : charger `/ad-hoc-profile-load implementer-ivan`, lire la fiche commune,
   ce prompt, puis la liste PRÉCISE des fichiers et lignes à lire (tirée des recherches).
4. `## Objective`, `## Context` (points ouverts, décisions du porteur du 18/11/2026 qui s'appliquent, interfaces
   possédées et consommées).
5. `## Subtasks` : une section par Txxx : but, étapes concrètes, fichiers, validation (commande de preuve),
   pièges connus (tirés des recherches), mutation à faire pour NFR-004 quand c'est une levée.
6. `## Branch Strategy` : planification et fusion sur feat/durcissements-serveur ; worktree de lane calculé par
   `lanes.json` ; commande `LC_ALL=C LANG=C spec-kitty agent action implement WPxx --agent claude --mission
   durcissements-serveur-01M7QAJD`.
7. `## Definition of Done` (cases à cocher vérifiables), `## Risks`, `## Ce que le relecteur doit casser`
   (attaques concrètes : droit rouvert, contrôle contourné, fuite, test qui ne prouve pas, écart non signalé).
