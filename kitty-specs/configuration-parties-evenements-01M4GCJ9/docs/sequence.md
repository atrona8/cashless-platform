# Séquences — mission configuration-parties-evenements-01M4GCJ9

> État : **mergée** (2026-10-13, squash `d9e3779`) — 13/13 WP ; recalé sur le code livré à la review du 2026-10-12.

## Flux internes propres à cette mission

### Création d'un événement

```mermaid
sequenceDiagram
    actor Org as Admin organisateur
    participant API
    participant DB as Base centrale

    Org->>API: POST /operators/{op}/events (Idempotency-Key)
    API->>API: Bornes (catalogue, prestataire, loi)
    API->>DB: INSERT event (DRAFT)
    API->>DB: open_event_ledger(événement)
    API->>DB: config_version EVENT v1, audit
    API-->>Org: 201 événement + ledger_id
```

### Passage en LIVE à deux

```mermaid
sequenceDiagram
    actor Auteur as Admin organisateur
    actor Val as Second admin
    participant API
    participant DB as Base centrale

    Auteur->>API: GET status-conditions?to=LIVE
    API->>DB: event_transition_conditions
    API-->>Auteur: Conditions et état
    Auteur->>API: POST status-transitions {to: LIVE}
    API->>DB: approval_request EVENT_GO_LIVE
    API-->>Auteur: 202 PENDING
    Val->>API: POST /approval-requests/{id}/approve
    API->>DB: decide_approval_request
    API->>DB: Revérifie, set_event_status(LIVE)
    API-->>Val: EXECUTED
```

### Écriture de plateforme

```mermaid
sequenceDiagram
    actor Plat as Admin plateforme
    participant API
    participant DBP as Base (rôle plateforme)

    Plat->>API: POST /operators (Idempotency-Key)
    API->>DBP: Réserve la clé (operator_id NULL)
    API->>DBP: INSERT party OPERATOR, audit
    API-->>Plat: 201 prestataire
```

## Flux transverses auxquels cette mission participe (référence, pas dupliqué)
Voir `docs/05-sequence-diagrams.md`, flux : « Double validation au back-office » (actions de configuration branchées),
« Clôture d'un événement » (passages de statut exposés par l'API).

## Nécessaire pour cette mission ? Oui — interactions back-office, API, base (deux rôles).
## Complet ? Oui — flux conformes au code livré. Précisions : la date d'effet d'une version est posée par l'horloge
de la base ; deux écritures concurrentes d'une même portée donnent 409 à la perdante ; `LIVE` passe par l'action à
deux `EVENT_GO_LIVE`, qui échoue (`FAILED`) si la configuration a changé depuis la demande.
## Validé par : Agent, par délégation du porteur (12/10/2026, « ok tu peux continuer par toi mm maintenant »)
