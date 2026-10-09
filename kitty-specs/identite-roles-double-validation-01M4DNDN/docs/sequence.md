# Séquences — mission identite-roles-double-validation-01M4DNDN

> État : **review terminée** (2026-10-09), recalé sur le code livré. Source : `contracts/`, `apps/api/src/`.

## Flux internes propres à cette mission

### Requête authentifiée

```mermaid
sequenceDiagram
    participant P as Personne
    participant IdP as Serveur d'identité
    participant API
    participant DB as Base

    P->>IdP: Connexion
    IdP-->>P: Jeton d'accès
    P->>API: Requête + jeton
    API->>API: Signature, émetteur, expiration
    API->>DB: identify_person
    DB-->>API: Prestataire et rôles
    API->>API: Rôle sur la portée ?
    API->>DB: Travail (prestataire fixé)
    API-->>P: Réponse
```

### Validation sur place au guichet

```mermaid
sequenceDiagram
    participant C as Caissier
    participant V as Valideur
    participant IdP as Serveur d'identité
    participant API
    participant DB as Base

    C->>V: Demande de validation
    V->>IdP: Code personnel
    IdP-->>C: Jeton d'approbation
    C->>API: Requête + jeton
    API->>API: Garde : signature, act, act_hash
    API->>DB: identify_person(sub) : actif, même prestataire, ≠ appelant, rôle
    Note over API,DB: Une transaction (IdempotentTx)
    API->>DB: INSERT approval_token_use ON CONFLICT (jti) DO NOTHING
    API->>DB: Opération (valideur = sub) + audit APPROVAL_TOKEN_USED
    API-->>C: Réponse (jeton consommé seulement si le travail est validé)
```

La demande puis approbation au back-office suit le flux global « Double validation au back-office »
(`docs/05-sequence-diagrams.md`), précisé ici : décision, exécution et journal dans la même transaction ;
échec de l'action → `ROLLBACK TO SAVEPOINT`, `FAILED` sans écriture partielle ; demande échue → `EXPIRED` validé
(`CommittedProblem`) puis `409`.

## Flux transverses auxquels cette mission participe (référence, pas dupliqué)

Voir `docs/05-sequence-diagrams.md`, flux **« Double validation au back-office »** (implémenté par cette mission
pour le mécanisme générique ; actions métier branchées par les missions suivantes).

## Nécessaire pour cette mission ? Oui — interactions personne, serveur d'identité, API, base.
## Complet ? Oui — vérifié contre le code (garde, consommation dans la transaction, point de sauvegarde).
## Validé par : agent, par délégation du porteur du projet (09/10/2026)
