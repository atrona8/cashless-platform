---
name: spec-kitty-docs-maintain
description: Maintenir à jour les documents transverses de docs/ (description produit, cas d'utilisation, contexte, architecture, séquences, et référence API si le projet en expose une) pour un projet Spec Kitty, ainsi que docs/spec-index.json qui alimente la vue visuelle en quadrants du projet. DOIT se déclencher automatiquement, sans que l'utilisateur le demande, dès qu'une mission franchit un jalon clé (plan finalisé, review terminée, mission acceptée ou mergée) — quel que soit le chemin d'orchestration emprunté pour y arriver : slash-commands littérales (/spec-kitty.plan, /spec-kitty.review) OU orchestration CLI bas niveau pilotée par un autre skill ou directement par l'utilisateur (spec-kitty agent action plan/implement/review, spec-kitty accept, spec-kitty merge, ou tout skill équivalent type spec-kitty-implement-review qui boucle WP par WP sans jamais appeler les slash-commands). DOIT aussi se déclencher, en amont de toute commande Spec Kitty, dès que l'utilisateur propose en conversation un nouveau besoin fonctionnel assez concret pour devenir une mission (avant le /spec-kitty.specify correspondant) — pour synchroniser PROMPTS-A-ENVOYER.md et PRD.md avant que la mission ne parte. Se déclenche aussi sur toute question portant sur l'état, la fraîcheur, la nécessité ou la complétude de la documentation du projet (ex: "où en est la doc", "est-ce que la doc est à jour", "audit de la doc").
---

# Maintien continu de la documentation — Spec Kitty

Ce skill vit dans un projet déjà initialisé par le skill `spec-kitty-docs-setup`
(présence de `.docmeta/`, `docs/`, `PRD.md`). Il ne recrée rien : il tient à jour
ce qui existe déjà.

## Avertissement — ce skill ne se déclenche PAS tout seul par magie

Un skill ne se déclenche que si l'agent qui orchestre la session choisit de
l'invoquer. Si la mission est pilotée par un enchaînement de slash-commands
(`/spec-kitty.plan`, `/spec-kitty.review`), le déclenchement est en pratique
fiable, car ces commandes ont peu d'usages possibles autres que ceux prévus
ici. **Si la mission est pilotée par un autre chemin** — boucle CLI bas niveau
(`spec-kitty agent action implement WP0N`, `spec-kitty agent action review
WP0N`, `spec-kitty accept`, `spec-kitty merge`) ou par un autre skill
d'orchestration (ex: `spec-kitty-implement-review`) — **rien ne garantit
automatiquement que ce skill sera invoqué**, sauf si l'agent qui orchestre
sait explicitement qu'il doit le faire. C'est le point de rupture identifié
sur ce projet (mission traitée en boucle CLI, jamais documentée après review
alors que la mission avait pourtant été acceptée et mergée).

**Contre-mesure obligatoire, à appliquer systématiquement, quel que soit le
skill actif** : avant de considérer une mission terminée — c'est-à-dire avant
ou juste après `spec-kitty accept` / `spec-kitty merge`, ou l'équivalent
slash-command `/spec-kitty.accept` — vérifie explicitement si le jalon "post
plan" et le jalon "post review" de cette mission ont chacun une ligne
"Résultat: Mis à jour" (ou "Jugé non nécessaire" / "Aucun changement requis")
dans le journal de `docs/06-docs-status.md`. Si l'un des deux manque, applique
l'addendum correspondant maintenant, même tardivement, plutôt que de laisser
la documentation figée sur un état obsolète. Ne suppose jamais qu'un addendum
a déjà été appliqué simplement parce que la mission est terminée.

## Étape 0 — toujours lire d'abord

Si ce n'est pas déjà fait dans cette session, lis `.docmeta/diagram-style-routing.md`
pour savoir quel skill externe utiliser pour chaque diagramme (avec repli
Mermaid automatique si le skill n'est pas installé), `.docmeta/mission-docs-template.md`
pour la forme des documents de mission, `.docmeta/preferences-utilisateur.md`
pour toute préférence explicite de l'utilisateur qui prime sur le routage par
défaut (ex: outil de diagramme préféré pour un type de document donné),
`.docmeta/spec-index-schema.md` pour le schéma exact de `docs/spec-index.json`
(alimente la vue visuelle en quadrants du projet, si elle existe),
`.docmeta/docs-state-schema.md` pour savoir quand lire et écrire le cache
`docs/docs-state.json` (uniquement utile aux deux déclencheurs de balayage
complet ci-dessous, inutile ailleurs), et les
deux fichiers `.docmeta/prompts/` pour la logique exacte des addenda
ci-dessous. Les six fichiers sont à lire systématiquement, pas seulement
`diagram-style-routing.md` et `mission-docs-template.md` : une préférence
enregistrée dans `preferences-utilisateur.md` et jamais relue équivaut à une
préférence jamais exprimée.

## Déclencheur : nouveau cas d'usage évoqué en conversation, avant toute mission

C'est le déclencheur le plus en amont de tous, à surveiller en continu, pas
seulement après une commande Spec Kitty : dès que l'utilisateur décrit un
nouveau besoin fonctionnel assez concret pour devenir une mission — que ce
soit prévu dès l'origine ou décidé en cours de route — et **avant** que
`/spec-kitty.specify` ne soit exécuté pour ce besoin, fais dans le même
échange :
1. Ajoute une nouvelle entrée à `PROMPTS-A-ENVOYER.md` (dupliquée depuis la
   section modèle en fin de fichier, voir Étape 6 de `spec-kitty-docs-setup`),
   avec les commandes concrètes déjà rédigées pour ce besoin.
2. Enrichis la section pertinente de `PRD.md` avec ce nouveau besoin
   (périmètre fonctionnel, flux critiques, contraintes si mentionnées), pour
   que `PRD.md` reste la source de vérité du besoin plutôt qu'un instantané
   figé de l'initialisation du projet.
3. Ajoute une ligne à la table "Fraîcheur de PRD.md" en tête de
   `docs/06-docs-status.md`.

Ce déclencheur ne peut pas être rattrapé par un audit périodique : un besoin
jamais consigné dans `PROMPTS-A-ENVOYER.md` ou `PRD.md` est invisible à toute
vérification de cohérence qui se base sur ces fichiers, y compris l'audit de
`.docmeta/prompts/C-audit-periodique.md`. Il faut donc l'attraper au moment
où le besoin est formulé, pas a posteriori.

## Déclencheur : jalon "plan finalisé" pour une mission

Se produit juste après `/spec-kitty.plan`, ou juste après l'équivalent CLI bas
niveau (`spec-kitty agent action plan` puis passage du plan en statut
finalisé), ou juste après qu'un autre skill d'orchestration a fait franchir ce
jalon à une mission. Lis `.docmeta/prompts/B-mise-a-jour-post-mission.md`,
section **"Addendum après /spec-kitty.plan"**, et applique-la immédiatement,
dans la même réponse, sans attendre que l'utilisateur le demande :
- identifie la mission courante,
- crée `kitty-specs/NNN-slug/docs/` (gabarit : `.docmeta/mission-docs-template.md`),
- propose les mises à jour anticipées des documents globaux concernés,
- pose les deux questions de nécessité/complétude à l'utilisateur,
- consigne le tout dans `docs/06-docs-status.md`.

## Déclencheur : jalon "review terminée" pour une mission

Se produit juste après `/spec-kitty.review`, ou juste après l'équivalent CLI
bas niveau (dernier `spec-kitty agent action review WP0N` d'une mission, ou
`spec-kitty agent action review --mission <slug>` selon la syntaxe réellement
installée — vérifie-la, voir Étape 5 du skill `spec-kitty-docs-setup`), ou
juste après qu'un autre skill d'orchestration (type `spec-kitty-implement-review`)
a fait franchir ce jalon à une mission. Dans tous les cas, applique cet
addendum avant `spec-kitty accept` / `/spec-kitty.accept` — et si tu constates
que l'acceptation ou le merge ont déjà eu lieu sans que cet addendum ait été
appliqué, applique-le quand même immédiatement plutôt que de l'ignorer parce
que le moment "idéal" est passé. Lis `.docmeta/prompts/B-mise-a-jour-post-mission.md`,
section **"Addendum après /spec-kitty.review"**, et applique-la :
- compare la doc locale de la mission à ce qui a RÉELLEMENT été implémenté,
- corrige les écarts,
- finalise la mise à jour des documents globaux,
- repose les deux questions de nécessité/complétude,
- signale explicitement tout écart plan/implémentation détecté,
- consigne le tout dans `docs/06-docs-status.md`.

## Déclencheur : question sur l'état de la documentation

Lis et résume `docs/06-docs-status.md` (tableau de statut + journal des mises à
jour).

## Déclencheur : audit périodique demandé explicitement

Lis `.docmeta/prompts/C-audit-periodique.md` et applique-le intégralement —
il inclut désormais une vérification croisée automatisable contre l'état réel
des missions (pas seulement contre ce que la documentation affirme d'elle-même).

## Déclencheur : juste avant de conclure une session de maintenance documentaire

Avant de dire à l'utilisateur que la documentation est à jour (que ce soit en
fin d'addendum post-plan, post-review, ou d'audit périodique), fais une
dernière vérification, optimisée pour ne pas relire ce qui est déjà connu
comme à jour.

1. Lis d'abord `docs/docs-state.json` (voir `.docmeta/docs-state-schema.md`
   pour les règles exactes). Compte les dossiers sous `kitty-specs/*/` et
   compare au nombre de clés dans `missions` : si ça correspond et que
   chaque `verifie_le` est récent, tu peux t'arrêter là, la documentation
   est à jour.
2. Sinon, ne réinterroge le statut réel (`spec-kitty agent tasks status
   --mission <slug>`, ou la commande équivalente confirmée à l'Étape 5 du
   skill `spec-kitty-docs-setup`) QUE pour les missions absentes du fichier
   ou dont l'état semble incertain — pas pour tout le dépôt.
3. Pour chaque mission ainsi revérifiée, compare son statut réel aux
   mentions "🚧 en cours" / "planifiée" / "mergée" présentes dans les
   documents globaux et dans `docs/06-docs-status.md`. Si une mission
   apparaît mergée ou acceptée côté Spec Kitty mais qu'un document affirme
   encore "en cours" ou "plan finalisé", c'est le signe exact de la
   défaillance identifiée sur ce projet (documentation figée sur un état
   obsolète car l'addendum post-review n'a jamais été déclenché), corrige-le
   immédiatement au lieu de conclure la session.

Vérifie dans le même mouvement que `docs/spec-index.json` contient une entrée
pour chaque mission listée, avec un champ `statut` cohérent avec le statut
réel obtenu ci-dessus. Une mission mergée sans entrée dans `spec-index.json`,
ou avec un `statut` resté sur "planifiée"/"en cours", est le même type de
défaillance que ci-dessus appliqué à la vue visuelle en quadrants plutôt
qu'aux 5 documents globaux, corrige-la immédiatement, sans attendre l'audit
périodique.

Termine en écrivant dans `docs/docs-state.json` le résultat de cette passe
(nouvelles missions vérifiées, corrections appliquées) : sans cette écriture,
la prochaine vérification pré-conclusion repartira de zéro et le fichier
n'aura servi à rien.

## Rappel de discipline

Ne modifie jamais le code applicatif dans le cadre de ce skill — uniquement les
fichiers sous `docs/`, `kitty-specs/*/docs/` et `docs/06-docs-status.md`. Si un
écart entre plan et implémentation nécessite une correction de code, signale-le
à l'utilisateur au lieu de le corriger toi-même dans ce contexte.
