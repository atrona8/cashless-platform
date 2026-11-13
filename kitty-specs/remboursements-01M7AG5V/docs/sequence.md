# Séquences : mission remboursements-01M7AG5V

> État : **plan finalisé le 13/11/2026, non implémenté**. Flux PRÉVUS, tirés de `plan.md`, `research.md`, `data-model.md` et
> `contracts/served-operations.md`. Diagrammes `/illustre`, rendus relus ; sources dans [`diagrams/`](diagrams/) (`generate.py`).

## Flux internes propres à cette mission

### Demande, approbation à deux, confirmation du paiement

![Demande et approbation](diagrams/sequence-demande-approbation.png)

Sources : [`sequence-demande-approbation.excalidraw`](diagrams/sequence-demande-approbation.excalidraw), [`sequence-demande-approbation.svg`](diagrams/sequence-demande-approbation.svg).
La demande est créée `REQUESTED` avec le montant estimé. Un premier membre du back-office propose l'approbation (`202`, rien d'écrit) ; un
second l'exécute : une seule écriture `WALLET_REFUND` au solde payé du moment, la demande passe `PROCESSING`. Le paiement est fait hors
système ; `PAID` exige une référence et n'écrit rien, `FAILED` exige un motif et passe un `REVERSAL` qui recrédite le portefeuille. Même
personne que l'auteur ou le demandeur : refus ; autorité `EDGE` : `409`.

### Autre numéro : décision du titulaire et échéance

![Autre numéro](diagrams/sequence-autre-numero.png)

Sources : [`sequence-autre-numero.excalidraw`](diagrams/sequence-autre-numero.excalidraw), [`sequence-autre-numero.svg`](diagrams/sequence-autre-numero.svg).
Le code du nouveau numéro est vérifié contre la destination et consommé. Avec un titulaire vérifié, la demande est `AWAITING_HOLDER` jusqu'à
`hold_until` (48 h par défaut) et un code lié à la demande est envoyé à son numéro. `CONFIRM` donne `REQUESTED`, `BLOCK` donne `BLOCKED` ; sans
réponse, la demande devient `REQUESTED` à l'échéance (lecture ou maintenance, au plus 5 min de retard).

### Guichet de retour enchaîné

![Guichet de retour](diagrams/sequence-guichet-retour.png)

Sources : [`sequence-guichet-retour.excalidraw`](diagrams/sequence-guichet-retour.excalidraw), [`sequence-guichet-retour.svg`](diagrams/sequence-guichet-retour.svg).
Un seul appel `releaseMedia` avec `settle_balance` : caution, expiration des crédits offerts, solde payé en espèces, espèces dues, restitution,
dans une transaction, sur la session de caisse ouverte du terminal. Au-delà du plafond d'espèces, jeton d'approbation sur place exigé
(`403 APPROVAL_REQUIRED`) ; un refus à une étape n'écrit rien ; rejeu avec la même clé : même réponse.

## Flux transverses auxquels cette mission participe (référence, pas dupliqué)

Voir `docs/05-sequence-diagrams.md`, flux : « Double validation au back-office » (l'action `WALLET_REFUND` s'y ajoute) et « Clôture d'un
événement » (matrice des statuts, `REVERSAL` d'un `WALLET_REFUND`, mission 9b pour la clôture).

## Nécessaire pour cette mission ? Oui : trois interactions inter-composants nouvelles (circuit à deux, décision du titulaire, guichet) (réponse proposée par l'Agent le 13/11/2026, en attente de confirmation du porteur).
## Complet ? Oui pour le plan (réponse proposée par l'Agent le 13/11/2026, en attente de confirmation du porteur). Flux non diagrammés : liste des demandes, refus (`REJECTED`, sans écriture), transfert des espèces dues lors d'un remplacement ; à reconsidérer à la review.
## Validé par : réponse proposée par l'Agent le 13/11/2026, en attente de confirmation du porteur.
