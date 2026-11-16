# Notes d'architecture : mission remboursements-01M7AG5V

> État : **review terminée le 16/11/2026 (sept lots approuvés), acceptation à venir, non fusionnée**, recalé sur le code livré (lane-g). Sources : `plan.md`, `research.md` (R-01 à R-12), `data-model.md`, `contracts/`. Aucun
> conteneur nouveau : tout vit dans l'API centrale et la base existantes.

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **Module `refunds`** de l'API centrale (`apps/api/src/refunds/`, NestJS 11, TypeScript) : deux contrôleurs (`/me/refund-requests`,
  `/refund-requests`), service de demandes, calcul d'éligibilité (fenêtre, blocage, frais, montant estimé), action d'approbation
  `WALLET_REFUND` (modèle de l'annulation de vente), défi du titulaire.
- **Base centrale** (PostgreSQL 17) : migrations `0081_refund_requests.sql` et `0082_replace_media_cash_due.sql` (numéros conformes au plan). `0081` : table `refund_request` (S16, isolation par prestataire,
  une demande ouverte au plus par portefeuille, aucun `DELETE`), colonnes `purpose` et `subject_id` d'`otp_challenge`, fonctions
  `refund_request_operator` et `promote_due_refund_requests`, garde d'insertion `refund_request_scope_guard` et CHECK jumelés. `0082` : `replace_media` seul (espèces dues
  suivent le bracelet neuf, OP-N55 levé). **Écart au plan : `post_transaction` n'a PAS de nouvelle version** ; l'élargissement de la matrice (ADR-189) est porté par le moteur
  (`status-matrix.ts` : `reversesType`, `readReversedType` sous RLS) et la base ne refuse que `LOCKED`. Droits : section 11 de `post-roles.sql`.
- **Authentification du festivalier** (`customer-auth`) : vérification d'un défi extraite sans émission de jetons (`verifyChallenge`, `issueChallenge`), réutilisée pour le code du
  nouveau numéro et pour celui du titulaire ; le port `OtpSender` reçoit un `link` optionnel (`refund_request_id`, `otp_request_id`) pour l'usage titulaire (décision 14, OP-N129 levé) ; faux envoyeur toujours refusé en production.
- **Guichet de retour** (`media/lifecycle/release.*`) : enchaînement `settle_balance` en une transaction, refus `release.no_chaining` retiré ; seuil de la seconde personne sur le cumul des espèces sorties (décision 11, ADR-190) ; bracelet non `ACTIVE` refusé (`409 MEDIA_STATE_INVALID`).
- **Autorité de débit** : routes de remboursement classées (`debit-paths.ts`) ; refus `409 DEBIT_AUTHORITY_EDGE` sur les écritures.
- **Maintenance** : promotion des demandes `AWAITING_HOLDER` échues (rôle `cashless_maint`).
- Contrat `openapi.yaml` inchangé (C-002) ; aucune dépendance nouvelle ; aucune intégration externe (paiement manuel, C-003).

## Décisions d'architecture prises dans cette mission

| Décision | Justification | Alternative envisagée |
|---|---|---|
| Paiement manuel : l'approbation écrit `WALLET_REFUND`, le paiement est fait hors système puis confirmé (R-01, ADR-53) | SPEC §8.5 et §11.4 ; aucun faux de plus | Port de versement avec faux jusqu'à la 12b |
| `REVERSAL` d'un `WALLET_REFUND` accepté par la garde de statut partout où `WALLET_REFUND` l'est (R-03, ADR-189 à consigner) | Contradiction SPEC §11.4 (échec de paiement recrédite) et §12.1 (`REVERSAL` interdit après `RECONCILING`) tranchée par le porteur : recrédit ; test négatif pour tout autre `REVERSAL` | Refuser `FAILED` après `RECONCILING` (festivalier non recrédité) |
| Défi du titulaire lié à la demande (`purpose`, `subject_id`) (R-05) | Un code générique pourrait décider une autre demande | Réutiliser le défi de connexion tel quel |
| Identifiant `uuid` de demande, index unique partiel sur le portefeuille (R-02) | FR-003 et NFR-002 garantis par la base | Identifiant d'affichage `RF-0001` |
| Enchaînement du guichet en une seule transaction (R-08) | Tout ou rien, rejouable ; pas de bracelet à moitié soldé | Plusieurs transactions avec reprise |
| Espèces dues d'un bracelet remplacé transférées au bracelet neuf par `replace_media` (R-09, OP-N55) | Le contrat n'a pas de route de rendu au back-office | Nouvelle route (interdite par C-002) |
| Portefeuille bloqué remboursable seulement si le blocage vient d'une perte (R-04) | Décision du porteur du 13/11/2026 | Tout blocage refuse |
| Règle de frais obligatoire (refus `422` sans règle) ; rôles `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` | Décisions du porteur au plan | Frais nuls par défaut |
| Virement créé par le back-office reporté (OP-N123) | Le contrat le déclare « non décrit » | L'ajouter au contrat (interdit par C-002) |
| Ajoutées à la review (16/11/2026) : seuil du guichet sur le cumul (décision 11, ADR-190) ; `FAILED` refusé au proposant et à l'exécutant (décision 13, ADR-191) ; lien du titulaire remis à l'envoyeur (décision 14) ; FR-012 amendée, compte sans identité refusé (décision 15, ADR-194) | Renforcements, contrat inchangé | — |

## Dette de sécurité et fichiers à faire relire

Écarts qui renforcent la sécurité (faits puis consignés, ADR-189 et 190) : défi lié à la demande, code du nouveau numéro vérifié et consommé, seuil du guichet sur le cumul,
`FAILED` refusé au proposant et à l'exécutant, bracelet non `ACTIVE` refusé, garde d'insertion et CHECK jumelés. Dette acceptée et nommée (aucun affaiblissement non soumis) :
OP-N124 (code du titulaire consommé avant sa décision, ADR-192), OP-N125 (quota commun, alerte de `BLOCK` en audit, ADR-193), OP-N126 (une seule personne étrangère recrédite un
`FAILED`, ADR-191, levée par la 9b), OP-N128 (`approved_by` nul sur la caution seule, cumul lu sous le verrou du bracelet, ADR-195, proposée) ; OP-N127 clos (ADR-194), OP-N129 levé, OP-N51 et
OP-N55 levés ; OP-N123 reste ouvert pour la 9b. À faire relire par une personne : `0081`, `0082`, section 11 de `post-roles.sql`, `status-matrix.ts`, `customer-auth.service.ts`,
`holder-decision.controller.ts`, `holder-challenge.service.ts`, `refund-eligibility.ts`, `refund-requests.service.ts`, `wallet-refund-action.ts`, `refund-confirm.service.ts`,
`release.service.ts` (liste complète dans ADR-189).

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » et ligne de détail de la mission. La vue C4 n'est pas modifiée
(aucun conteneur nouveau).

## Nécessaire pour cette mission ? Oui : décisions de sécurité (matrice élargie dans le moteur, défi lié, seuil cumulé, `FAILED` restreint, droits) et nouveau module, sans nouveau conteneur (réponse recalée à la review le 16/11/2026, proposition de l'Agent, en attente de confirmation du porteur).
## Complet ? Oui, recalé sur les migrations réelles (`0081`, `0082`), l'absence de nouvelle version de `post_transaction` et la dette OP-N124 à N128 (proposition de l'Agent, en attente de confirmation du porteur).
## Validé par : réponse proposée par l'Agent le 16/11/2026, en attente de confirmation du porteur.
