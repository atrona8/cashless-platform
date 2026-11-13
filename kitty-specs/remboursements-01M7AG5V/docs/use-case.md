# Cas d'usage : mission remboursements-01M7AG5V

> État : **plan finalisé le 13/11/2026, non implémenté** (mission 9a « Remboursements des festivaliers »). Source : `spec.md` (4 user stories,
> 20 FR, 5 NFR, 8 contraintes), `plan.md`, `research.md`, `data-model.md`, `contracts/`. Les cas d'usage décrivent ce qui est PRÉVU. Diagrammes
> `/illustre` (préférence du porteur du 13/10/2026), police sans empattement, rendus relus ; sources et générateur dans
> [`diagrams/`](diagrams/) (`generate.py`).

## Cas d'usage propres à cette mission

### Festivalier, titulaire et back-office

![Cas d'usage des remboursements](diagrams/usecase-remboursement.png)

Sources : [`usecase-remboursement.excalidraw`](diagrams/usecase-remboursement.excalidraw), [`usecase-remboursement.svg`](diagrams/usecase-remboursement.svg).

### Guichet de retour

![Cas d'usage du guichet de retour](diagrams/usecase-guichet.png)

Sources : [`usecase-guichet.excalidraw`](diagrams/usecase-guichet.excalidraw), [`usecase-guichet.svg`](diagrams/usecase-guichet.svg).

| Cas d'usage | Acteur | Règle principale (prévue) | Route |
|---|---|---|---|
| Demander un remboursement | Festivalier connecté | Vers son numéro vérifié (Wave ou Orange Money) ; solde payé positif, fenêtre de remboursement ouverte, règle de frais configurée, une seule demande ouverte par portefeuille ; montant estimé = solde payé moins frais ; crédits offerts exclus ; `Idempotency-Key` | `POST /me/refund-requests` (`createMyRefundRequest`) |
| Suivre mes demandes | Festivalier | Ses demandes seulement, paginées ; celles d'un autre festivalier sont invisibles (`404`) | `GET /me/refund-requests` (`listMyRefundRequests`) |
| Demander vers un autre numéro | Festivalier | Code à usage unique du nouveau numéro exigé et consommé ; statut `AWAITING_HOLDER` avec échéance `hold_until` si le titulaire est vérifié, sinon `REQUESTED` | `POST /me/refund-requests` |
| Confirmer ou bloquer (autre numéro) | Titulaire (numéro vérifié) | Code lié à la demande, envoyé à son numéro ; `CONFIRM` donne `REQUESTED`, `BLOCK` donne `BLOCKED` ; plus de blocage possible après l'échéance (`409`) ; sans réponse, la demande devient `REQUESTED` à l'échéance | `POST /refund-requests/{id}/holder-decision` (public) |
| Lister et refuser une demande | Back-office (`OPERATOR_ADMIN`, `ORGANIZER_ADMIN`) | Filtres statut et événement ; refus d'une demande `REQUESTED` avec motif, sans écriture | `GET /refund-requests`, `POST /refund-requests/{id}/reject` |
| Proposer l'approbation | Back-office, auteur | Crée une approbation `WALLET_REFUND` en attente (`202`), rien n'est écrit ; pour un montant au-delà du seuil vers un autre numéro, la vérification d'identité est notée | `POST /refund-requests/{id}/approve` |
| Approuver à deux | Back-office, valideur | Personne distincte de l'auteur et du demandeur ; une seule écriture `WALLET_REFUND` (solde payé à l'instant, frais déduits), demande `PROCESSING` ; refusé si la passerelle locale a l'autorité (`409`) | `POST /approval-requests/{id}/approve` |
| Confirmer le paiement | Back-office | Paiement fait hors système ; `PAID` avec référence (aucune écriture) ou `FAILED` avec motif (contre-passation, solde recrédité, nouvelle demande possible) | `POST /refund-requests/{id}/confirm` |
| Restituer et solder le bracelet | Caissier | Un seul appel, tout ou rien, dans l'ordre imposé : caution, expiration des crédits offerts, solde payé en espèces, espèces dues, restitution ; sur la session de caisse ouverte du terminal ; rejouable | `POST /media/{id}/release` avec `settle_balance` |
| Rendre le solde payé en espèces et les espèces dues | Caissier | Étapes de l'enchaînement ci-dessus ; espèces dues d'un bracelet remplacé rendues une fois et une seule (elles suivent le bracelet neuf) | idem |
| Approuver sur place (gros montant) | Superviseur | Jeton d'approbation sur place d'une seconde personne au-delà du plafond d'espèces par remboursement ; sans lui `403 APPROVAL_REQUIRED` et rien n'est écrit | en-tête `X-Approval-Token` |

Hors périmètre (reporté en 9b ou consigné) : demande créée par le back-office et virement bancaire (OP-N123), versements, rapprochements et
clôture (mission 9b), remboursement par carte (exclu de la V1).

## Lien avec la synthèse globale

Contribue à : `docs/02-use-case-diagram.md`, domaines « App festivalier » (demande et suivi), « Argent réel : PSP, caisses, rapprochements,
versements » (remboursements, circuit à deux) et « Bracelets NFC » (guichet de retour enchaîné). Pas de renommage ni de fusion de cas d'usage
globaux ; le cas « Demander un remboursement » existe déjà au diagramme global.

## Nécessaire pour cette mission ? Oui : quatre acteurs et onze cas d'usage nouveaux (demande, décision du titulaire, circuit à deux, guichet), donc les diagrammes sont générés (réponse proposée par l'Agent le 13/11/2026, en attente de confirmation du porteur).
## Complet ? Oui pour le plan (réponse proposée par l'Agent le 13/11/2026, en attente de confirmation du porteur). À recaler à la review sur le code livré (notamment le comportement réel du portefeuille bloqué et l'exécution de l'approbation).
## Validé par : réponse proposée par l'Agent le 13/11/2026, en attente de confirmation du porteur.
