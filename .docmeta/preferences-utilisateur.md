# Préférences utilisateur — comportement de l'agent documentaliste

> Lu systématiquement à l'Étape 0 de `spec-kitty-docs-maintain`, au même titre
> que `diagram-style-routing.md` et `mission-docs-template.md` — ce n'est pas
> une note de session, c'est un réglage durable qui doit survivre à un
> changement d'agent ou de conversation.
>
> Ce fichier est vide à l'installation. L'agent documentaliste l'alimente
> lui-même dès qu'une préférence explicite est exprimée par l'utilisateur au
> fil des sessions (ex: "en fait, utilise plutôt Mermaid pour les cas
> d'usage", "ne me repose plus la question de nécessité pour les documents
> de séquence, je veux toujours qu'ils soient générés"). L'utilisateur peut
> aussi l'éditer directement.

## Comment ajouter une préférence

Ajoute une ligne au tableau ci-dessous, avec une portée aussi précise que
possible (un document en particulier plutôt que "tous les diagrammes" si
c'est ce que l'utilisateur a réellement exprimé), et **complète aussi la note
correspondante dans `.docmeta/diagram-style-routing.md`** si la préférence
concerne le choix d'un outil de diagramme — ce fichier-ci fait foi en cas de
divergence, `diagram-style-routing.md` doit simplement y renvoyer pour qu'un
agent qui ne lirait que l'un des deux ne passe pas à côté.

## Préférences enregistrées

| Date | Portée (document ou catégorie précise) | Préférence exprimée | Remplace la règle par défaut de |
|---|---|---|---|
| | | | |

## Règle d'application

Une préférence enregistrée ici **prime toujours** sur la table de routage par
défaut de `diagram-style-routing.md` pour le document concerné, y compris
lors d'une régénération ou d'une correction de diagramme. Si une préférence
semble périmée ou contradictoire avec une demande récente de l'utilisateur,
signale l'ambiguïté au lieu de trancher silencieusement dans un sens ou
l'autre.
