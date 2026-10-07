# Diagramme de cas d'utilisation — synthèse globale

> Statut de complétude : voir `06-docs-status.md`. Mermaid n'a pas de notation UML
> "cas d'utilisation" native — on la simule avec un flowchart : acteurs en
> rectangles arrondis (stadium), cas d'usage en ellipses, relations "include" en
> pointillés. Rendu en repli Mermaid (skill `/illustre` non installé).
> Dernière mise à jour : initialisation du 07/10/2026. Cas d'usage tirés de `SPECIFICATION.md` §3.2, §7, §8, §11, §12.

## Vue d'ensemble — terrain (festivalier, vendeur, guichet)

```mermaid
flowchart LR
    Fest([Festivalier])
    Vend([Vendeur])
    Cais([Caissier])
    Sup([Superviseur])

    U1((Payer par bracelet))
    U2((Payer par QR))
    U3((Recharger en ligne))
    U4((Consulter son solde))
    U5((Rattacher un bracelet))
    U6((Déclarer une perte))
    U7((Demander un remboursement))
    U8((Encaisser une vente))
    U9((Annuler une vente))
    U10((Recharger en espèces))
    U11((Activer un bracelet))
    U12((Gérer la caution))
    U13((Rembourser en espèces))
    U14((Remplacer un bracelet))
    U15((Identifier un festivalier))
    U16((Valider à deux))
    U17((Lever un trou de séquence))
    U18((Sortir de liste noire))

    Fest --> U1
    Fest --> U2
    Fest --> U3
    Fest --> U4
    Fest --> U5
    Fest --> U6
    Fest --> U7
    Vend --> U8
    Vend --> U9
    Cais --> U10
    Cais --> U11
    Cais --> U12
    Cais --> U13
    Cais --> U14
    Cais --> U15
    Sup --> U16
    Sup --> U17
    Sup --> U18

    U8 -.include.-> U1
    U8 -.include.-> U2
    U13 -.include.-> U16
    U18 -.include.-> U16
    U17 -.include.-> U16
```

## Vue d'ensemble — administration (back-office)

```mermaid
flowchart LR
    Plat([Admin plateforme])
    Ope([Admin prestataire])
    Org([Admin organisateur])
    Mch([Admin commerçant])

    A1((Gérer les prestataires))
    A2((Gérer les organisateurs))
    A3((Gérer clés et lots))
    A4((Configurer un PSP))
    A5((Configurer l'événement))
    A6((Régler le hors ligne))
    A7((Gérer catalogues))
    A8((Enrôler un terminal))
    A9((Clôturer l'événement))
    A10((Verser les droits))
    A11((Approuver une demande))
    A12((Consulter ses relevés))
    A13((Exporter la comptabilité))

    Plat --> A1
    Ope --> A2
    Ope --> A3
    Ope --> A4
    Org --> A5
    Org --> A6
    Org --> A7
    Org --> A8
    Org --> A9
    Org --> A10
    Org --> A11
    Org --> A13
    Mch --> A7
    Mch --> A12

    A10 -.include.-> A11
    A4 -.include.-> A11
```

## Détail par mission

| Mission | Cas d'usage propres | Lien vers détail local |
|---|---|---|
| (aucune mission lancée à ce jour) | — | — |

## Questions de nécessité/complétude posées lors de la dernière révision
- Nécessaire pour ce projet ? Voir `06-docs-status.md`.
- Complet au vu des missions mergées à ce jour ? Voir `06-docs-status.md`.
- Validé par : en attente.
