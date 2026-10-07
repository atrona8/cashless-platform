# B — Addenda documentaires (appliqués automatiquement par le skill
# spec-kitty-docs-maintain)

> Déclenchés automatiquement par le skill `spec-kitty-docs-maintain` après
> `/spec-kitty.plan` et `/spec-kitty.review`. L'agent lit lui-même les fichiers
> de la mission concernée (`spec.md`, `plan.md`, code produit) — l'humain n'a
> normalement rien à coller.

## Addendum "Après /spec-kitty.plan"

Instructions pour l'agent, à exécuter dans la continuité de la session où tu viens
d'écrire `/spec-kitty.plan` de la mission courante (pas de nouveau chat) :

1. Identifie la mission courante (dossier `kitty-specs/NNN-slug/` le plus
   récemment modifié, ou demande confirmation si ambigu).
2. Lis son `spec.md` et son `plan.md`.
3. Lis `.docmeta/mission-docs-template.md` pour connaître la structure attendue.
4. Crée `kitty-specs/NNN-slug/docs/` avec les 3 fichiers qu'il décrit
   (`use-case.md`, `architecture-notes.md`, `sequence.md`), remplis avec le
   contenu propre à cette mission. Génère effectivement les diagrammes de
   `use-case.md` et `sequence.md` (pas seulement leur description en texte) :
   la règle en tête de `.docmeta/mission-docs-template.md` s'applique, ces
   diagrammes ne sont plus optionnels par défaut.
5. Propose les mises à jour anticipées des documents globaux concernés dans
   `docs/` (02, 04, 05 selon ce que cette mission introduit).
6. Propose les mises à jour anticipées des documents globaux concernés dans
   `docs/` (02, 04, 05 selon ce que cette mission introduit) ainsi que
   `docs/07-api-reference.md` si cette mission introduit ou modifie des
   endpoints API et que ce document a été jugé nécessaire lors du setup.
7. Extrait de `spec.md` les champs définis dans `.docmeta/spec-index-schema.md`
   (user stories, entités clés, résultat mesurable, hypothèses, contraintes,
   cas limites, exigences fonctionnelles/non fonctionnelles) et ajoute ou
   actualise l'entrée correspondant à cette mission dans `docs/spec-index.json`
   — sans régénérer les autres entrées du fichier.
8. Pour chaque fichier local ET chaque document global touché, pose les deux
   questions de nécessité et de complétude (principe expliqué dans
   `docs/00-README-onboarding.md`)
   avant de finaliser.
9. Consigne les réponses et une entrée de journal dans `docs/06-docs-status.md`
   (tableau de statut + section "Journal des mises à jour" en bas du fichier).
10. Mets à jour l'entrée de cette mission dans `docs/docs-state.json`
    (statut constaté, `verifie_le` à l'heure courante,
    `addendum_plan_applique: true`) — pas de lecture préalable nécessaire,
    tu viens de constater ce statut toi-même (voir
    `.docmeta/docs-state-schema.md`).

## Addendum "Après /spec-kitty.review"

Instructions pour l'agent, à exécuter dans la continuité de la session où tu viens
d'exécuter `/spec-kitty.review` de la mission courante, avant `/spec-kitty.accept` :

1. Relis `kitty-specs/NNN-slug/docs/` (créé lors de l'addendum précédent) et
   compare-le à ce qui a RÉELLEMENT été implémenté (pas ce qui était seulement
   prévu dans `plan.md`) — inspecte le code produit et les work packages
   effectivement complétés.
2. Corrige les 3 fichiers locaux si des écarts existent entre plan et
   implémentation réelle.
3. Finalise la mise à jour des documents globaux concernés dans `docs/` (01, 02,
   03, 04, 05 selon pertinence, et 07-api-reference.md si des endpoints API ont
   été touchés) et ajoute une entrée dans le tableau "Détail par
   mission" des documents 02 et 04 pointant vers les fichiers locaux.
4. Recale l'entrée de cette mission dans `docs/spec-index.json` sur
   l'implémentation réelle (statut, et tout champ dont la valeur a changé
   entre le plan et l'implémentation effective) — ne te contente pas de
   recopier ce qui avait été extrait au moment du plan.
5. Repose les deux questions de nécessité et de complétude pour chaque document
   touché — la réponse donnée au moment du plan peut avoir changé maintenant que
   l'implémentation réelle est connue.
6. Vérifie que les références croisées de `kitty-specs/NNN-slug/docs/use-case.md`
   et `architecture-notes.md` vers `docs/02` et `docs/04` utilisent bien un nom
   de domaine stable, pas un identifiant numérique (voir la règle stricte dans
   `.docmeta/mission-docs-template.md`). Corrige-les immédiatement si ce n'est
   pas le cas, sans attendre un audit périodique.
7. Consigne le tout dans `docs/06-docs-status.md` (tableau de statut + section
   "Journal des mises à jour" en bas du fichier).
8. Signale explicitement si cette vérification a révélé un écart entre le plan et
   l'implémentation — c'est précisément ce que cet addendum sert à détecter.
9. Mets à jour l'entrée de cette mission dans `docs/docs-state.json`
   (statut réel recalé, `verifie_le` à l'heure courante,
   `addendum_review_applique: true`, `spec_index_a_jour: true`) — voir
   `.docmeta/docs-state-schema.md`.

## Cas particulier : restructuration du diagramme global (fusion/renommage de cas d'usage)

Si cette mission, ou une décision utilisateur prise pendant cette session,
entraîne une fusion, un renommage ou une suppression d'entrées dans
`docs/02-use-case-diagram.md` (ex: généralisation de 10 cas d'usage détaillés
vers 4 domaines), **ne te limite pas à la mission courante** : liste toutes
les missions sous `kitty-specs/*/docs/use-case.md` et `architecture-notes.md`
et vérifie si l'une d'elles référence une entrée qui vient de disparaître ou
d'être renommée. Corrige chaque référence cassée dans la foulée plutôt que de
laisser un audit périodique les découvrir plus tard — c'est le moment où le
risque de référence cassée est le plus élevé et le moins coûteux à corriger.
