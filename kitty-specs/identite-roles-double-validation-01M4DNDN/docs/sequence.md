# Séquences — mission identite-roles-double-validation-01M4DNDN

> État : **plan finalisé** (2026-10-08). Source : `contracts/identity.md`, `contracts/approvals.md`.

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
    API->>API: act, act_hash, sub ≠ appelant
    API->>DB: Consommer le jeton
    API->>DB: Opération + audit
    API-->>C: Réponse
```

La demande puis approbation au back-office suit le flux global « Double validation au back-office »
(`docs/05-sequence-diagrams.md`), précisé ici : décision, exécution et journal dans la même transaction ;
échec de l'action → `FAILED` sans écriture partielle.

## Flux transverses auxquels cette mission participe (référence, pas dupliqué)

Voir `docs/05-sequence-diagrams.md`, flux **« Double validation au back-office »** (implémenté par cette mission
pour le mécanisme générique ; actions métier branchées par les missions suivantes).

## Nécessaire pour cette mission ? Oui — interactions personne, serveur d'identité, API, base.
## Complet ? Partiel — flux prévus au plan ; à vérifier contre le code à la review.
## Validé par : agent, par délégation du porteur du projet (08/10/2026)
