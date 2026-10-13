# Séquences — mission bracelets-nfc-01M4TD3W

> État : **plan finalisé** (2026-10-13).

## Flux internes propres à cette mission

### Personnalisation d'un bracelet

```mermaid
sequenceDiagram
    actor Poste as Poste de personnalisation
    participant Perso as Processus de personnalisation
    participant KMS as Service de clés
    participant DB as Base centrale

    Poste->>Perso: Enregistrer (empreinte, UID, signature, lot, clé à usage unique)
    Perso->>KMS: Calculer le mot de passe
    Perso->>KMS: Clé de données (si absente)
    Perso->>Perso: Chiffrer pour stockage
    Perso->>DB: Bracelet PERSONALIZED, audit
    Perso->>Perso: Chiffrer pour le poste, effacer
    Perso-->>Poste: Mot de passe sous enveloppe
```

### Lecture d'un bracelet par un terminal

```mermaid
sequenceDiagram
    participant Term as Terminal
    participant Cles as Processus des clés
    participant KMS as Service de clés
    participant API as API publique
    participant DB as Base centrale

    Term->>Cles: POST /media/auth-keys (index, UID)
    Cles->>DB: Chiffré du bracelet
    Cles->>KMS: Déchiffrer la clé de données (hors cache)
    Cles-->>Term: Mot de passe chiffré pour ce terminal
    Term->>API: POST /taps (empreinte, UID, compteur, signature)
    API->>DB: register_tap
    DB-->>API: Résultat, tap_id
    API-->>Term: 200 résultat, solde
```

### Lecture suspecte dans une opération

```mermaid
sequenceDiagram
    participant Term as Terminal
    participant API as API publique
    participant DB as Base centrale

    Term->>API: Opération avec lecture embarquée
    API->>DB: register_tap (transaction de l'opération)
    DB-->>API: CLONE_SUSPECTED
    API->>DB: ROLLBACK
    API->>DB: register_tap seul, COMMIT (liste noire, anomalie)
    API-->>Term: Erreur MEDIA_CLONE_SUSPECTED
```

### Rattachement d'un bracelet approvisionné

```mermaid
sequenceDiagram
    actor Fest as Festivalier
    actor Agent as Agent de guichet
    participant API as API publique
    participant DB as Base centrale

    Fest->>API: Code imprimé
    API->>DB: claim_media (solde non nul)
    API-->>Fest: 202 demande, code à 6 chiffres
    Agent->>API: Lecture du bracelet + code de confirmation
    API->>DB: confirm_media_claim
    API-->>Agent: Portefeuille rattaché
```

### Création d'une clé, à deux

```mermaid
sequenceDiagram
    actor A as Admin prestataire
    actor B as Second admin
    actor Ex as Exploitant
    participant API as API publique
    participant Adm as Commande d'administration
    participant Perso as Processus de personnalisation
    participant DB as Base centrale

    A->>API: Demander une clé
    B->>API: Approuver
    API->>DB: Travail CREATE_KEY
    Ex->>Adm: Lancer la commande
    Adm->>DB: Clé créée, travail CREATE_DEK
    Perso->>DB: Clé de données v1, clé utilisable
```

## Lien avec la synthèse globale
Contribue à : `docs/05-sequence-diagrams.md`, flux « Paiement en ligne par bracelet » (la lecture et la demande de mot de
passe) et « Double validation au back-office » (actions de clé et sortie de liste noire).

## Nécessaire pour cette mission ? Oui — interactions entre terminal, poste, quatre processus, service de clés et base.
## Complet ? Oui au stade du plan.
## Validé par : Agent, par délégation du porteur (13/10/2026) — diagrammes en repli Mermaid (voir registre)
