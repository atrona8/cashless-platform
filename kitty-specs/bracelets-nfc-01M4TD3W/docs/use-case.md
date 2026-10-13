# Cas d'usage — mission bracelets-nfc-01M4TD3W

> État : **plan finalisé** (2026-10-13) ; à recaler sur le code livré après la review.

## Cas d'usage propres à cette mission

```mermaid
flowchart LR
    OpAdmin([Admin prestataire])
    OrgAdmin([Admin organisateur])
    Perso([Agent de personnalisation])
    Term([Terminal])
    Agent([Agent de guichet])
    Sup([Superviseur])
    Fest([Festivalier])
    Exploit([Exploitant])

    UC1((Gérer les clés))
    UC2((Gérer un lot))
    UC3((Commander les codes))
    UC4((Personnaliser un bracelet))
    UC5((Lire un bracelet))
    UC6((Activer et cautionner))
    UC7((Rendre ou remplacer))
    UC8((Rattacher par code))
    UC9((Confirmer au guichet))
    UC10((Sortir de liste noire))
    UC11((Contrôler les clés))

    OpAdmin --> UC1
    Exploit --> UC1
    Exploit --> UC11
    OrgAdmin --> UC2
    OrgAdmin --> UC3
    Perso --> UC4
    Term --> UC5
    Agent --> UC6
    Agent --> UC7
    Agent --> UC9
    Fest --> UC8
    Sup --> UC10
    UC6 -.inclut.-> UC5
    UC7 -.inclut.-> UC5
    UC9 -.inclut.-> UC5
    UC8 -.peut exiger.-> UC9
```

Les clés (création, rotation, retrait) et la sortie de liste noire passent par deux personnes. La création et la
désactivation d'une clé dans le service de clés sont faites par l'exploitant, avec une commande séparée.

## Lien avec la synthèse globale
Contribue à : `docs/02-use-case-diagram.md`, cas d'usage « Gérer clés et lots », « Activer un bracelet », « Gérer la
caution », « Remplacer un bracelet », « Rattacher un bracelet », « Sortir de liste noire » et, pour sa partie lecture,
« Payer par bracelet ».

## Nécessaire pour cette mission ? Oui — la mission introduit onze cas d'usage et un nouvel acteur (agent de personnalisation).
## Complet ? Oui au stade du plan ; à recaler après la review.
## Validé par : Agent, par délégation du porteur (13/10/2026) — diagramme en repli Mermaid (voir registre)
