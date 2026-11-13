# Notes d'architecture : mission remboursements-01M7AG5V

> État : **plan finalisé le 13/11/2026, non implémenté**. Sources : `plan.md`, `research.md` (R-01 à R-12), `data-model.md`, `contracts/`. Aucun
> conteneur nouveau : tout vit dans l'API centrale et la base existantes.

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **Module `refunds`** de l'API centrale (`apps/api/src/refunds/`, NestJS 11, TypeScript) : deux contrôleurs (`/me/refund-requests`,
  `/refund-requests`), service de demandes, calcul d'éligibilité (fenêtre, blocage, frais, montant estimé), action d'approbation
  `WALLET_REFUND` (modèle de l'annulation de vente), défi du titulaire.
- **Base centrale** (PostgreSQL 17) : migration prévue `0081_refund_requests.sql` : table `refund_request` (S16, isolation par prestataire,
  une demande ouverte au plus par portefeuille, aucun `DELETE`), colonnes `purpose` et `subject_id` d'`otp_challenge`, fonctions
  `refund_request_operator` et `promote_due_refund_requests`, nouvelle version de `post_transaction` (garde de statut) et de `replace_media`
  (espèces dues). Droits : section 11 de `post-roles.sql`.
- **Authentification du festivalier** (`customer-auth`) : vérification d'un défi extraite sans émission de jetons, réutilisée pour le code du
  nouveau numéro et pour celui du titulaire.
- **Guichet de retour** (`media/lifecycle/release.*`) : enchaînement `settle_balance` en une transaction, refus `release.no_chaining` retiré.
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

## Dette de sécurité et fichiers à faire relire

Aucun écart qui affaiblit la sécurité n'est prévu. L'élargissement de la matrice (R-03) porte sur un crédit au festivalier et est borné par un
test négatif. Renforcements : défi lié à la demande, code du nouveau numéro vérifié contre la destination, seuil d'espèces du guichet contrôlé
pour le solde payé. À faire relire par une personne : section 11 de `post-roles.sql`, fonction `SECURITY DEFINER` `refund_request_operator`,
nouvelle version de `post_transaction`, `replace_media`.

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » et ligne de détail de la mission. La vue C4 n'est pas modifiée
(aucun conteneur nouveau).

## Nécessaire pour cette mission ? Oui : décisions de sécurité (garde de la base élargie, défi lié, droits) et nouveau module, sans nouveau conteneur (réponse proposée par l'Agent le 13/11/2026, en attente de confirmation du porteur).
## Complet ? Oui pour le plan (réponse proposée par l'Agent le 13/11/2026, en attente de confirmation du porteur). À recaler à la review sur les migrations réelles (numéros, fichiers de droits) et sur l'écart éventuel entre plan et livré.
## Validé par : réponse proposée par l'Agent le 13/11/2026, en attente de confirmation du porteur.
