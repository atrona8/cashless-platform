# Note aux équipes de l'app terminal et du back-office : rendu partiel en espèces au guichet (mission 9c)

Version du 23 novembre 2026. Ce document dit comment se servir du contrat livré (`packages/contracts/openapi.yaml`) : il ne le
remplace pas. En cas d'écart, le contrat fait foi. Routes préfixées par `/v1`. Décisions : ADR-233 ; limites : ADR-234.

## 1. Ce que fait l'opération

Au guichet, rendre en espèces un montant choisi du **solde payé** du portefeuille du bracelet lu, **sans libérer le bracelet** :
il reste actif et rattaché. Les crédits offerts et la caution ne bougent pas. Le rendu des espèces dues n'est pas couvert (il
reste sur le guichet de retour, `refundCashDue`).

`POST /media/{media_id}/partial-cash-refunds`, `operationId: refundPartialCash`.

- Terminal en mode `TOPUP_DESK`, avec ses trois preuves (mTLS, jeton, signature) ; personne `CASHIER` ou `SUPERVISOR` de
  l'événement ; session de caisse `OPEN` du terminal.
- En-têtes : `Idempotency-Key` (obligatoire) ; `X-Approval-Token` (facultatif, voir §3).
- Corps : `{ "tap_id": <entier> | "tap": {...}, "amount": <entier> }`. Un passage, **un seul des deux** (`tap_id` ou `tap`),
  comme `releaseMedia` ; aucun ou les deux : `400`. `amount` est le montant **débité** du solde payé, en unités mineures,
  au moins 1.
- Réponse `201` : `transaction_id`, `media_id`, `wallet_id`, `amount_debited`, `fee`, `cash_handed`, `paid_balance_after`,
  `day_cumulative`, `approved_by` (nul sans seconde personne), `cash_session_id`. **Espèces à remettre = `cash_handed` =
  `amount_debited` moins `fee`.**
- Rejouer la même clé avec le même corps rend la même réponse, sans nouvelle sortie d'espèces.

## 2. Deux réglages, faux par défaut

| Réglage | Qui | Où |
|---|---|---|
| `cash_partial_refund_allowed` | prestataire (`OPERATOR_ADMIN`) | configuration du prestataire (`createOperatorConfigVersion`) ; lisible dans la configuration résolue |
| `cash_partial_refund_enabled` | organisateur (`ORGANIZER_ADMIN`) | propriété facultative d'`Event` (lecture) et d'`EventUpdate` (`updateEvent`) ; en `LIVE`, demande à deux personnes |

Les deux doivent être vrais, lus à chaque rendu. Activer sans autorisation du prestataire : `422 VALIDATION_FAILED`, règle
`operator.cash_partial_refund_allowed` (l'écran du back-office doit afficher un message propre : le serveur n'a qu'un message de
repli, OP-N175). Désactiver est toujours permis. La création d'un événement ne peut pas activer le réglage.

## 3. Seconde personne

Le cumul du jour UTC des rendus partiels **du portefeuille** (tous ses bracelets), montant du rendu en cours compris, est comparé
à `event.cash_refund_single_max`. Au-dessus (strictement), le serveur répond `403 APPROVAL_REQUIRED` : l'écran demande une
seconde personne, qui obtient un jeton d'approbation sur place (comme au guichet de retour), puis le rendu est renvoyé avec
`X-Approval-Token`. Jeton invalide : `403 APPROVAL_INVALID`. Le guichet de retour garde son propre cumul.

## 4. Refus

| Réponse | Cas | À afficher |
|---|---|---|
| `422 REFUND_NOT_ALLOWED`, champ `reason` = `PARTIAL_CASH_REFUND_DISABLED` | fonction non autorisée ou non activée, `refund_policy` fermée ou sans canal `CASH` | orienter vers le guichet de retour ou l'app |
| `422 AMOUNT_OUT_OF_RANGE` | montant nul, négatif, sous `minimum_amount`, ou inférieur ou égal aux frais | corriger le montant |
| `422 INSUFFICIENT_FUNDS` | montant au-dessus du solde payé | corriger le montant |
| `422 WALLET_BLOCKED` | portefeuille bloqué (code existant, **non listé** dans la description de l'opération, OP-N176) | refus |
| `422 VALIDATION_FAILED` | phase de l'événement qui n'admet pas le rendu (par exemple `DRAFT`, OP-N179) | refus |
| `409 CONFLICT_STATE` | pas de session de caisse ouverte | ouvrir la session |
| `409 DEBIT_AUTHORITY_EDGE` | coupure : la passerelle locale a l'autorité de débit | refus, pas de rendu pendant `EDGE` |
| `409 MEDIA_STATE_INVALID` | bracelet qui n'est pas actif | refus |
| `403 FORBIDDEN` | rôle sans droit de guichet | refus |

Aucun code d'erreur nouveau n'est ajouté à l'énumération du contrat.

## 5. À savoir

- Les frais de `refund_policy` s'appliquent à **chaque** rendu, bracelet anonyme compris.
- Chaque rendu sort de la caisse de la session ouverte et est compté à sa fermeture.
- Un `REVERSAL` d'un rendu partiel ne diminue pas le cumul du jour (OP-N173).
- Rien à changer côté app festivalier : l'opération n'est pas ouverte aux comptes.
- **Toute route nouvelle a son cas dans les matrices transverses.** La batterie du code intégré a trouvé trois gardes sans
  cas pour `refundPartialCash` (`device-auth-matrix`, `media-isolation`, `media-port-swap`), complétées sans tolérance
  générale : une route ajoutée sans son cas dans ces matrices fait échouer la batterie.
