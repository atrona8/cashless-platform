# Séquences — mission fondations-grand-livre-01M4AY8M

> État : **implémentée** — 14/14 WP approuvés (2026-10-08), recalée sur le code après la review. Écarts au plan :
> `research.md` R-13.

## Flux internes propres à cette mission

### Écriture idempotente au grand livre (chaîne commune à toutes les futures routes)

```mermaid
sequenceDiagram
    participant C as Client
    participant I as Idempotence
    participant M as Moteur
    participant DB as Base

    C->>I: Requête + clé
    I->>DB: Réserver la clé
    alt Clé neuve
        I->>M: Commande
        M->>DB: Clé déjà écrite ?
        alt Nouvelle écriture
            M->>M: Statut accepte le type ?
            M->>M: Constructeur : lignes
            M->>DB: post_transaction
        else Déjà écrite
            M-->>I: Transaction existante
        end
        I->>DB: Enregistrer la réponse
        I-->>C: Réponse
    else Déjà traitée
        I-->>C: Réponse rejouée
    else En cours ou autre contenu
        I-->>C: 409
    end
```

Chaque appel base est précédé de `set_config('app.operator_id', …, true)` ; le travail métier et l'enregistrement
de la réponse sont dans la même transaction. Un refus de la base devient un `ProblemCode` (jamais de texte SQL).

### Rejeu du scénario de référence (test d'intégration)

```mermaid
sequenceDiagram
    participant T as Test
    participant M as Moteur
    participant DB as Base

    T->>DB: Fixture (rôle propriétaire)
    T->>DB: set_event_status LIVE
    loop 48 transactions, statuts intercalés
        T->>M: Commande métier
        M->>DB: post_transaction
        T->>DB: Lignes écrites = JSON ?
    end
    T->>DB: Soldes après T23 et fin
    T->>DB: CLOSED puis LOCKED
    T->>M: Second rejeu (LOCKED)
    M-->>T: 0 transaction créée
```

## Flux transverses auxquels cette mission participe (référence, pas dupliqué)

Voir `docs/05-sequence-diagrams.md`, flux : **« Clôture d'un événement »** (passages de statut par
`set_event_status`, exercés par le rejeu) ; la chaîne d'écriture idempotente ci-dessus sera réutilisée par
« Paiement en ligne par bracelet » et « Recharge mobile money ».

## Nécessaire pour cette mission ? Oui — la mission introduit des interactions entre composants (client, idempotence, moteur, base).
## Complet ? Oui — flux vérifiés contre le code et les tests d'intégration (2026-10-08).
## Validé par : agent, par délégation du porteur du projet (08/10/2026)
