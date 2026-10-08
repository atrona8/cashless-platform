# Diagrammes de séquence (message) — flux transverses clés

> Statut de complétude : voir `06-docs-status.md`. Un diagramme par flux critique
> qui traverse plusieurs composants (les flux internes à un seul composant vivent
> dans le détail local de la mission concernée). Rendu en repli Mermaid (skill `/illustre` non installé).
> Dernière mise à jour : initialisation du 07/10/2026. Flux **cibles**, tirés de `SPECIFICATION.md` et `sync_protocol.md`.

## Flux : Paiement en ligne par bracelet (un seul aller-retour, §7.6)

```mermaid
sequenceDiagram
    actor Vendeur
    participant Terminal
    participant Bracelet
    participant API
    participant DB as Base centrale

    Vendeur->>Terminal: Saisit le montant
    Terminal->>Bracelet: UID, page 4, READ_SIG
    Terminal->>Terminal: PWD et PACK (snapshot ou auth-keys)
    Terminal->>Bracelet: PWD_AUTH, lecture, INCR_CNT
    Terminal->>API: POST /payments (lecture, seq, signé)
    API->>DB: register_tap
    API->>DB: post_transaction (PURCHASE)
    API->>DB: consume_tap
    DB-->>API: Transaction validée
    API-->>Terminal: 201 Payé
    Terminal-->>Vendeur: Succès affiché
```

## Flux : Vente hors ligne puis synchronisation (§9.3 à §9.6)

```mermaid
sequenceDiagram
    actor Vendeur
    participant Terminal
    participant API
    participant DB as Base centrale

    Note over Terminal: Réseau coupé
    Vendeur->>Terminal: Encaisse
    Terminal->>Terminal: Contrôle snapshot et plafonds
    Terminal->>Terminal: Journal local (fsync)
    Note over Terminal: Réseau revenu
    Terminal->>API: POST /offline-batches (lot signé, chaîné)
    API->>DB: open_offline_batch
    loop Chaque opération, dans l'ordre des seq
        API->>DB: post_transaction (OFFLINE_SYNC)
        Note over DB: Part non couverte en S-ATTENTE
    end
    API->>DB: complete_offline_batch
    API-->>Terminal: Résultat par opération
```

## Flux : Bascule vers la passerelle et retour (§9.7)

```mermaid
sequenceDiagram
    participant Passerelle
    participant API
    participant DB as Base centrale
    participant Terminal

    Passerelle->>API: Demande d'autorité
    API->>DB: grant_edge_authority (époque +1)
    API-->>Passerelle: Autorité accordée
    Passerelle->>API: ack du handover
    Note over Passerelle,Terminal: Coupure internet
    Terminal->>Passerelle: Paiements (LAN)
    Note over Passerelle,API: Internet revenu
    Passerelle->>API: POST /edge/handovers/{id}/release
    Passerelle->>API: POST /edge/sync-batches (EDGE_SYNC)
    API->>DB: record_edge_seq, post_transaction
    API->>DB: complete_edge_release (époque +1)
    API-->>Passerelle: Autorité rendue au central
```

## Flux : Recharge mobile money (§8.5, §11.1)

```mermaid
sequenceDiagram
    actor Festivalier
    participant App as App festivalier
    participant API
    participant PSP
    participant DB as Base centrale

    Festivalier->>App: Recharge 20 000 XOF
    App->>API: POST /topups/psp
    API->>PSP: Initie le paiement
    PSP-->>App: Validation par le client
    PSP->>API: Webhook signé
    API->>API: Vérifie la signature, stocke brut
    API->>DB: post_transaction (TOPUP, frais PSP)
    API->>DB: take_deposit si caution due
    API-->>PSP: 200
    App->>API: GET /topups/psp/{id}
    API-->>App: Recharge réussie
```

## Flux : Double validation au back-office (§3.2)

```mermaid
sequenceDiagram
    actor Auteur
    actor Valideur
    participant BO as Back-office
    participant API
    participant DB as Base centrale

    Auteur->>BO: Lance une action à deux
    BO->>API: Appel de l'opération
    API->>DB: Crée approval_request (24 h)
    API-->>BO: 202 demande PENDING
    Valideur->>BO: Ouvre la demande
    BO->>API: POST /approval-requests/{id}/approve
    API->>DB: decide_approval_request (valideur ≠ auteur)
    API->>DB: Exécute l'action une fois
    API-->>BO: Demande EXECUTED
```

## Flux : Clôture d'un événement (§12.1)

```mermaid
sequenceDiagram
    actor Org as Organisateur
    participant BO as Back-office
    participant API
    participant DB as Base centrale

    Org->>BO: Passe à l'étape suivante
    BO->>API: Vérifie caisses, PSP, terminaux
    API->>DB: set_event_status
    DB->>DB: Verrous, conditions calculées
    alt Condition non remplie
        DB-->>API: CL019 (condition nommée)
        API-->>BO: Liste des conditions
    else Conditions remplies
        DB->>DB: Statut des grands livres
        DB-->>API: Statut changé
        API-->>BO: Nouveau statut
    end
```

## Index des flux couverts

| Flux | Domaines traversés | Mission(s) source |
|---|---|---|
| Paiement en ligne par bracelet | Terminal, bracelets, API, grand livre | à définir |
| Vente hors ligne puis synchronisation | Terminal, synchronisation, grand livre | à définir |
| Bascule vers la passerelle et retour | Passerelle, API, grand livre | à définir |
| Recharge mobile money | App festivalier, PSP, API, grand livre | à définir |
| Double validation au back-office | Back-office, API, base | à définir |
| Clôture d'un événement | Back-office, API, base | `fondations-grand-livre-01M4AY8M` (passages de statut exercés par le rejeu du scénario, tous acceptés sans `CL019` ; pas encore de back-office) |

## Questions de nécessité/complétude posées lors de la dernière révision
- Nécessaire pour ce projet ? Voir `06-docs-status.md`.
- Complet au vu des flux transverses réellement implémentés à ce jour ? Voir `06-docs-status.md`.
- Validé par : en attente.
