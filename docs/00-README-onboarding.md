# Onboarding — Cashless Platform (système cashless multi-tenant)

Bienvenue sur le projet. Ce document est le point d'entrée unique pour comprendre
le système avant de plonger dans le code ou les missions Spec Kitty.

## Avant de lire quoi que ce soit : vérifier la fraîcheur des docs

Consulte d'abord [`06-docs-status.md`](./06-docs-status.md) — il indique, pour
chaque document ci-dessous, s'il est à jour, jugé non nécessaire, ou en attente de
validation. Ne présume pas qu'un document est fiable sans l'avoir vérifié.

## Sources normatives

Ces documents sont une **synthèse**. Les règles exactes sont dans `docs/SPECIFICATION.md` (normatif),
`docs/DECISIONS_ADR.md` (pourquoi), `docs/POINTS_OUVERTS.md` (non tranché), `docs/sync_protocol.md`,
`packages/contracts/openapi.yaml` et `packages/ledger-sql/` (schéma et tests, qui font foi).
Le besoin est résumé dans `PRD.md` à la racine.

## Ordre de lecture recommandé

1. **[Description produit](./01-product-overview.md)** — comprendre *quoi* et
   *pourquoi* avant *comment*.
2. **[Diagramme de contexte](./03-context-diagram.md)** — situer le système dans
   son environnement (acteurs, systèmes externes).
3. **[Architecture globale](./04-architecture-diagram.md)** — comprendre les
   composants internes et comment ils communiquent.
4. **[Cas d'utilisation](./02-use-case-diagram.md)** — comprendre les parcours
   fonctionnels principaux.
5. **[Diagrammes de séquence](./05-sequence-diagrams.md)** — comprendre le détail
   des interactions pour les flux les plus critiques.
6. **[Référence API](./07-api-reference.md)** — si le projet expose une API,
   vue d'ensemble par domaine et conventions transverses (complète Swagger/
   OpenAPI sans le dupliquer).
7. **[Pile logicielle](./08-pile-logicielle.md)** — logiciels et versions retenus, choix d'implémentation
   (HTTP, erreurs, pagination, idempotence, limitation de débit, base locale mobile) et divergences avec les
   sources normatives en attente d'arbitrage.

## Vue visuelle par mission

En plus des documents ci-dessus, `spec-index.json` alimente une vue visuelle
en quadrants (une carte par mission : user stories cliquables, entités clés
et résultat mesurable, hypothèses et contraintes, cas limites et exigences)
si le projet a mis en place la page correspondante — voir
`.docmeta/spec-index-schema.md` pour le schéma et un composant de départ.

## Pour aller plus loin sur une mission spécifique

Chaque mission Spec Kitty (`kitty-specs/NNN-slug/`) a son propre sous-dossier
`docs/` avec le détail local (cas d'usage, notes d'architecture, séquences propres
à cette mission), qui complète — sans le remplacer — le niveau global ci-dessus.

## Historique des mises à jour de documentation

Voir la section "Journal des mises à jour" de [`06-docs-status.md`](./06-docs-status.md)
pour savoir
quelle mission a motivé quelle mise à jour, et quand.

## Comment fonctionne cette documentation (pour comprendre le système, pas pour le régler)

Cette documentation est maintenue par deux skills Claude Code :
- **`spec-kitty-docs-setup`** — installé une fois, a mis en place toute cette
  structure à partir d'un PRD initial.
- **`spec-kitty-docs-maintain`** (`.claude/skills/spec-kitty-docs-maintain/`) —
  se déclenche automatiquement dès qu'une mission franchit le jalon "plan
  finalisé" ou "review terminée" pour garder ces documents synchronisés avec
  le code réel. Ce déclenchement est fiable si les missions sont pilotées par
  les slash-commands `/spec-kitty.plan`/`/spec-kitty.review`. Si une mission
  est pilotée autrement (boucle CLI bas niveau, autre skill d'orchestration),
  le déclenchement automatique n'est **pas garanti** — voir `CLAUDE.md` à la
  racine du projet pour la procédure de rattrapage manuel dans ce cas.

Chaque document ci-dessus a une portée globale (synthèse transverse) et, pour
les cas d'utilisation, l'architecture et les séquences, un **détail local par
mission** dans `kitty-specs/NNN-slug/docs/`, qui alimente la synthèse globale
sans la remplacer.

Principe de fonctionnement : à chaque mise à jour, l'agent pose deux questions
avant de considérer un document terminé — *est-il nécessaire pour ce projet ?*
et *reflète-t-il fidèlement l'état actuel du système ?* — dont les réponses sont
tracées dans `06-docs-status.md`. Un document jugé "non nécessaire" reste dans
le dépôt, marqué comme tel, jamais supprimé silencieusement.

Pour ajuster le **comportement** de l'agent (quel outil utiliser pour les
diagrammes, la forme des documents de mission, la logique des mises à jour),
voir les fichiers de configuration dans `.docmeta/` à la racine du projet —
ce README explique le système, `.docmeta/` sert à le régler.
