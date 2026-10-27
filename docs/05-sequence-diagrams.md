# Diagrammes de séquence (message) — flux transverses clés

> Statut de complétude : voir `06-docs-status.md`. Un diagramme par flux critique
> qui traverse plusieurs composants (les flux internes à un seul composant vivent
> dans le détail local de la mission concernée). Flux écrits avant la mission « Bracelets NFC » : Mermaid ; flux
> ajoutés depuis : `/illustre` (préférence du porteur du 13/10/2026), sources dans [`diagrams/`](diagrams/).
> Dernière mise à jour : 21/10/2026 (flux « Enrôlement et requête signée d'un terminal », mission « Identité et
> enrôlement des terminaux », mergée le 21/10/2026).
> Flux **cibles**, tirés de `SPECIFICATION.md` et `sync_protocol.md`.

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
    Note over Terminal,API: auth-keys : processus des clés, distinct de l'API publique
    Terminal->>Bracelet: PWD_AUTH, lecture, INCR_CNT
    Terminal->>API: POST /payments (lecture, seq, signé)
    API->>DB: register_tap
    API->>DB: post_transaction (PURCHASE)
    API->>DB: consume_tap
    DB-->>API: Transaction validée
    API-->>Terminal: 201 Payé
    Terminal-->>Vendeur: Succès affiché
```

## Flux : Enrôlement et requête signée d'un terminal (§8.1, §8.2, §10.3 ; `sync_protocol.md` §3.1)

![Enrôlement et requête signée d'un terminal](diagrams/sequence-terminal-transverse.png)

Sources : [`sequence-terminal-transverse.excalidraw`](diagrams/sequence-terminal-transverse.excalidraw),
[`sequence-terminal-transverse.svg`](diagrams/sequence-terminal-transverse.svg), produits par
[`diagrams/generate.py`](diagrams/generate.py). Implémenté (mission « Identité et enrôlement des terminaux ») :
code d'enrôlement émis par un administrateur, enrôlement sans compte (attestation, certificat client, jetons), puis
chaque requête du terminal avec ses trois preuves. Les flux détaillés (limites et refus audités, ordre des contrôles,
rafraîchissement avec grâce de 60 s, révocation) sont dans le `sequence.md` de la mission. Autorité des terminaux et
signataire des jetons : faux seulement, refusés en production (OP-N73).

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

## Flux : Annulation d'une vente, au terminal et au back-office (mission « Encaissement en ligne » ; ADR-122, ADR-123, ADR-129)

Au terminal, les contrôles se font dans l'ordre terminal, vendeur, puis fenêtre (heure de la base) : l'autre vendeur
reçoit `422 REVERSAL_NOT_ALLOWED` sans connaître l'âge de la vente. Hors fenêtre, un `SUPERVISOR` donne un jeton sur place,
lié à la vente et à usage unique.

![Annulation au terminal](../kitty-specs/terminaux-paiement-en-ligne-01M52QB9/docs/diagrams/sequence-annulation.png)

Au back-office, `reversePayment` ne touche pas au grand livre : il crée une demande `SALE_REVERSAL` (`202`) qu'une seconde
personne distincte approuve, ce qui exécute l'annulation.

![Annulation au back-office](../kitty-specs/terminaux-paiement-en-ligne-01M52QB9/docs/diagrams/sequence-annulation-backoffice.png)

Sources et autres flux de la mission (session de vendeur, paiement par bracelet, QR commerçant, QR client) :
[`sequence.md`](../kitty-specs/terminaux-paiement-en-ligne-01M52QB9/docs/sequence.md).

## Index des flux couverts

| Flux | Domaines traversés | Mission(s) source |
|---|---|---|
| Paiement en ligne par bracelet | Terminal, bracelets, API, grand livre | `bracelets-nfc-01M4TD3W` (✅ mergée le 16/10/2026, dans `main` par la PR #3 : demande de mot de passe au processus des clés et lecture `POST /taps` servies ; lecture embarquée dans une opération, avec lecture suspecte persistée malgré l'échec ; le paiement lui-même vient en mission 5) ; `terminaux-paiement-en-ligne-01M52QB9` (✅ mergée le 26/10/2026 sur `feat/terminaux-paiement-en-ligne`, PR vers `main` à venir) : vente attribuée au vendeur, lignes, annulation à deux voies, QR commerçant et client — flux remonté dans la section « Annulation d'une vente » ci-dessus, six flux locaux dans [`sequence.md`](../kitty-specs/terminaux-paiement-en-ligne-01M52QB9/docs/sequence.md)) |
| Enrôlement et requête signée d'un terminal | Back-office, terminal, API, autorité des terminaux, attestation, base | `identite-enrolement-terminaux-01M52R6H` (✅ mergée le 21/10/2026, dans `main` par la PR #4 : flux remonté ici, détail dans [`sequence.md`](../kitty-specs/identite-enrolement-terminaux-01M52R6H/docs/sequence.md) ; la demande de mot de passe et la lecture du flux « Paiement en ligne par bracelet » passent par les trois preuves) |
| Vente hors ligne puis synchronisation | Terminal, synchronisation, grand livre | à définir |
| Bascule vers la passerelle et retour | Passerelle, API, grand livre | à définir |
| Recharge mobile money | App festivalier, PSP, API, grand livre | à définir |
| Double validation au back-office | Back-office, API, base | `terminaux-paiement-en-ligne-01M52QB9` (annulation d'une vente `SALE_REVERSAL`, ADR-129 : demande `202` puis approbation par une seconde personne) ; `identite-roles-double-validation-01M4DNDN` (✅ mergée le 09/10/2026 (10/10 WP, acceptée) : mécanisme générique livré et prouvé par une action de démonstration ; actions branchées par les missions suivantes) ; `configuration-parties-evenements-01M4GCJ9` (✅ mergée le 13/10/2026 : huit actions de configuration, dont deux de niveau plateforme) ; `bracelets-nfc-01M4TD3W` (✅ mergée le 16/10/2026, dans `main` par la PR #3 : trois actions de clé `TAG_KEY_CREATE`, `TAG_DEK_ROTATE`, `TAG_KEY_RETIRE`, exécutées par un travail de clé, et sortie de liste noire `REINSTATE_MEDIA`) |
| Clôture d'un événement | Back-office, API, base | `fondations-grand-livre-01M4AY8M` (passages de statut exercés par le rejeu du scénario, tous acceptés sans `CL019` ; pas encore de back-office) ; `configuration-parties-evenements-01M4GCJ9` (✅ mergée le 13/10/2026 : conditions et passages de statut servis par l'API, `LIVE` à deux par `EVENT_GO_LIVE`) |

## Questions de nécessité/complétude posées lors de la dernière révision
- Nécessaire pour ce projet ? Voir `06-docs-status.md`.
- Complet au vu des flux transverses réellement implémentés à ce jour ? Voir `06-docs-status.md`.
- Validé par : en attente.
