# Séquences — mission identite-enrolement-terminaux-01M52R6H

> État : **plan finalisé** le 19/10/2026. Rédigé d'après les contrats de `contracts/` ; à recaler après review.

## Flux internes propres à cette mission

### Enrôlement d'un terminal

![Enrôlement d'un terminal](diagrams/sequence-enrolement.png)

Sources : [`sequence-enrolement.excalidraw`](diagrams/sequence-enrolement.excalidraw), [`sequence-enrolement.svg`](diagrams/sequence-enrolement.svg).

### Requête d'un terminal (trois preuves)

![Requête d'un terminal](diagrams/sequence-requete-terminal.png)

Sources : [`sequence-requete-terminal.excalidraw`](diagrams/sequence-requete-terminal.excalidraw), [`sequence-requete-terminal.svg`](diagrams/sequence-requete-terminal.svg).

### Renouvellement du jeton

![Renouvellement du jeton](diagrams/sequence-rafraichissement.png)

Sources : [`sequence-rafraichissement.excalidraw`](diagrams/sequence-rafraichissement.excalidraw), [`sequence-rafraichissement.svg`](diagrams/sequence-rafraichissement.svg).

### Révocation d'un terminal

![Révocation d'un terminal](diagrams/sequence-revocation.png)

Sources : [`sequence-revocation.excalidraw`](diagrams/sequence-revocation.excalidraw), [`sequence-revocation.svg`](diagrams/sequence-revocation.svg).

Diagrammes produits par [`diagrams/generate.py`](diagrams/generate.py) (rendu du skill `/illustre`, police sans-serif).

## Flux transverses auxquels cette mission participe (référence, pas dupliqué)
Voir `docs/05-sequence-diagrams.md`, flux « Paiement en ligne par bracelet » : la demande de mot de passe et la
lecture passent désormais par les trois preuves.

## Nécessaire pour cette mission ? Oui — enrôlement, authentification de chaque requête et rafraîchissement sont des échanges entre terminal, API, base et ports.
## Complet ? Oui au stade du plan — à recaler après review.
## Validé par : Agent, par délégation du porteur, le 19/10/2026
