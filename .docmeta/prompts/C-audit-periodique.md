# C — Audit périodique (appliqué par le skill spec-kitty-docs-maintain sur
# demande explicite)

> Déclenché quand l'utilisateur demande explicitement un audit de la
> documentation, ou tous les N missions si l'utilisateur a fixé une fréquence.

## Instructions pour l'agent

Effectue un audit complet des 5 documents dans `docs/`, en les confrontant à
l'état réel de TOUTES les missions mergées à ce jour — **par vérification
directe du système, jamais par confiance dans ce que la documentation affirme
d'elle-même**.

1. Lis d'abord `docs/docs-state.json` (voir `.docmeta/docs-state-schema.md`).
   Liste tous les dossiers `kitty-specs/*/`. Pour chaque mission, ne saute la
   revérification complète que si TOUTES ces conditions sont réunies :
   présente dans `docs-state.json`, `addendum_plan_applique` ET
   `addendum_review_applique` à `true`, ET statut enregistré déjà "mergée"
   (un statut terminal ne peut plus changer). Dans tous les autres cas
   (mission absente du fichier, addendum manquant, statut non terminal, ou
   le moindre doute), lis intégralement son `spec.md`, `plan.md`, et son
   sous-dossier `docs/` local s'il existe : **ne saute jamais une mission
   par défaut, saute-la seulement quand les conditions ci-dessus sont
   explicitement remplies**.
2. **Vérification croisée de statut (étape à ne jamais sauter, pour les
   missions non exemptées à l'étape 1)** : pour chaque mission non exemptée,
   récupère son statut réel via `spec-kitty agent tasks status
   --mission <slug>` (ou la commande équivalente confirmée à l'Étape 5 du skill
   `spec-kitty-docs-setup` si la syntaxe a changé), puis compare ce statut réel
   aux mentions "🚧 en cours" / "plan finalisé" / "planifiée" / "mergée"
   présentes dans les 5 documents globaux et dans `docs/06-docs-status.md`.
   Cette vérification doit couvrir **toutes** les missions non exemptées, y
   compris celles pilotées par une boucle CLI bas niveau ou un skill
   d'orchestration autre que les slash-commands
   `/spec-kitty.plan`/`/spec-kitty.review` — ne présume pas qu'une mission
   "doit" avoir été documentée simplement parce qu'elle apparaît dans le
   dossier `kitty-specs/`, vérifie son statut réel. L'exemption de l'étape 1
   ne s'applique jamais à cette prudence : elle ne fait que sauter les
   missions déjà pleinement vérifiées et terminales, jamais les missions
   incertaines.
3. Si la table "Surfaces dérivées" de `docs/06-docs-status.md` contient une
   ligne marquée "Logique propre" avec "À revérifier : Oui", vérifie
   directement le code de cette surface (pas seulement les fichiers `docs/`)
   pour t'assurer qu'elle reste cohérente avec les fichiers sources qu'elle
   affiche ou dérive.
4. Pour chacun des 5 documents dans `docs/` :
   - Relève toute incohérence entre le document et l'état réel du système
     (issue de l'étape 2 ci-dessus).
   - Relève toute mission dont le détail local n'a jamais été agrégé dans la
     synthèse globale correspondante (compare avec la section "Journal des mises
     à jour" de `docs/06-docs-status.md` pour repérer les missions sans ligne
     "Résultat: Mis à jour").
   - Vérifie que chaque référence croisée d'un document local
     (`kitty-specs/*/docs/use-case.md`, `architecture-notes.md`) vers la
     synthèse globale utilise un nom de domaine stable et non un identifiant
     numérique désormais potentiellement obsolète (voir la règle dans
     `.docmeta/mission-docs-template.md`).
   - Vérifie que `docs/spec-index.json` contient bien une entrée pour chaque
     mission ayant un `spec.md`, que son schéma respecte
     `.docmeta/spec-index-schema.md`, et que le champ `statut` de chaque
     entrée correspond au statut réel vérifié à l'étape 2. Complète ou
     corrige les entrées manquantes ou désynchronisées.
   - Repose les deux questions de nécessité et de complétude, même pour un
     document déjà validé précédemment — le périmètre a pu évoluer.
   - Vérifie que `use-case.md` et `sequence.md` de chaque mission contiennent
     bien un diagramme réel, pas seulement une description textuelle, dès
     que la mission introduit un cas d'usage ou une interaction (voir la
     règle de génération obligatoire dans `.docmeta/mission-docs-template.md`).
     Une mission documentée avant l'introduction de cette règle et qui n'a
     qu'un texte à la place d'un diagramme doit être corrigée maintenant.
5. Corrige immédiatement tout écart détecté (mise à jour de statut, référence
   croisée cassée) plutôt que de te contenter de le signaler pour plus tard.
6. Mets à jour `docs/06-docs-status.md` avec les résultats (nouvelle entrée
   "Audit du [date]" par document).
7. Ajoute une entrée dans la section "Journal des mises à jour" de
   `docs/06-docs-status.md`.
8. Écris dans `docs/docs-state.json` le résultat de cet audit : toutes les
   missions revérifiées à l'étape 2 (y compris celles déjà exemptées à
   l'étape 1, dont l'entrée reste inchangée), et `derniere_verification_globale`
   mis à l'heure courante. Sans cette écriture, le prochain audit et la
   prochaine vérification pré-conclusion repartiront de zéro sur toutes les
   missions, y compris celles que cet audit vient de confirmer stables.
9. Termine par un résumé court à l'humain : combien de documents sont à jour,
   combien ont été corrigés, combien de missions locales n'avaient jamais été
   agrégées, combien de missions ont été détectées avec un statut réel
   différent de ce que la documentation affirmait (c'est l'indicateur le plus
   important : un nombre non nul signale que le déclenchement automatique du
   skill de maintenance a été manqué au moins une fois), et combien de
   missions ont été exemptées de revérification complète grâce à
   `docs/docs-state.json`.
