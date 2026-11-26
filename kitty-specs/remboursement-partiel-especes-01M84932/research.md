# Research: Remboursement partiel en espèces au guichet

Décisions du plan prises par défaut le 23/11/2026, pendant l'absence du porteur, à partir des modèles existants du
projet. **Toutes validées par le porteur le 23/11/2026** (D2 et D3 après correction), ainsi que les ajouts au contrat
de `contracts/partial-cash-refund.md`. Aucune dépendance nouvelle : la section « chaîne
d'approvisionnement » est sans objet.

## Décisions du porteur reprises du specify (23/11/2026)

- Cumul de la seconde personne : par bracelet et par jour.
- Bracelets anonymes acceptés ; frais de remboursement à chaque rendu.
- Le prestataire autorise, l'organisateur active.

## D1 — Où vivent les deux réglages

- **Decision**: autorisation du prestataire = clé de cascade `cash_partial_refund_allowed` (niveau `OPERATOR`, réglée
  par `OPERATOR_ADMIN`, défaut `false`), écrite par `createOperatorConfigVersion` (carte de réglages ouverte,
  `additionalProperties: true`). Activation = colonne `event.cash_partial_refund_enabled` (défaut `false`), réglée par
  `ORGANIZER_ADMIN` via `updateEvent`, comme `cash_refund_single_max`.
- **Rationale**: le prestataire règle déjà ses maximums par la cascade (`cash_refund_single_max_cap`) ; l'organisateur
  règle déjà ses réglages de guichet par colonnes d'événement (circuit à deux personnes en `LIVE` compris). Aucune
  nouvelle route de réglage.
- **Alternatives considered**: deux colonnes d'événement (le prestataire devrait régler chaque événement) ; une
  clé de cascade au niveau `ORGANIZER` (activation pour tous ses événements, contraire à « événement par événement »).

## D2 — Montant saisi : brut ou net

- **Validé par le porteur le 23/11/2026.**
- **Decision**: le caissier saisit le **montant débité** du solde payé (brut) ; les espèces remises sont ce montant
  moins les frais de `refund_policy`. La réponse donne les deux, pour l'écran.
- **Rationale**: même convention que le guichet de retour (`WALLET_REFUND` du montant brut, espèces lues sur la ligne de
  caisse) ; le seuil de la seconde personne porte déjà sur le brut (ADR-190).
- **Alternatives considered**: saisir le net remis (le moteur devrait inverser le calcul des frais, nouveau code).

## D3 — Cumul du jour

- **Renforcement validé par le porteur le 23/11/2026** : cumul par **portefeuille** (et non par bracelet), pour qu'un
  portefeuille à plusieurs bracelets ne multiplie pas le seuil (relevé par l'addendum post-plan).
- **Decision**: somme des montants **bruts** des `WALLET_REFUND` marqués rendu partiel (`metadata.partial_cash_refund`)
  sur le portefeuille, tous bracelets confondus, depuis 00:00 UTC, plus le montant demandé ; lue **après** le verrou du solde payé ; comparée `>` au
  `cash_refund_single_max` de l'événement. Le guichet de retour garde son propre cumul (inchangé, C-002).
- **Rationale**: ADR-190 (comparaison au cumul), ADR-195 / OP-N128 (lecture sous verrou), journée UTC (§2.2).
- **Alternatives considered**: inclure le guichet de retour dans le cumul (change un comportement existant, hors
  périmètre) ; cumul par portefeuille (un bracelet remplacé repartirait de zéro : limite à consigner, voir L1).

## D4 — Codes de réponse

- **Decision**: aucun code d'erreur nouveau. Fonction non permise : `422 REFUND_NOT_ALLOWED` avec un `reason` distinct
  (`PARTIAL_CASH_REFUND_DISABLED`) dans le détail ; montant ≤ 0 ou sous `minimum_amount` : `422 AMOUNT_OUT_OF_RANGE` ;
  montant > solde payé : `422 INSUFFICIENT_FUNDS` ; seconde personne : `403 APPROVAL_REQUIRED` / `APPROVAL_INVALID` ;
  session absente : `409 CONFLICT_STATE` ; coupure : `409 DEBIT_AUTHORITY_EDGE` ; statut du bracelet : mêmes codes que
  `releaseMedia`.
- **Rationale**: l'énumération des codes est gelée par le test `contract-additions-9b.spec.ts` ; les codes existants
  couvrent tous les cas.
- **Alternatives considered**: un code `PARTIAL_CASH_REFUND_DISABLED` dans l'énumération (ajout au contrat de plus).

## D5 — Route

- **Decision**: `POST /media/{media_id}/partial-cash-refunds`, `operationId: refundPartialCash`, sécurité des routes de
  guichet (trois preuves du terminal + `staffBearer`), corps `{ tap_id, amount }`, en-têtes `Idempotency-Key`
  (obligatoire) et `X-Approval-Token` (facultatif).
- **Rationale**: même famille que `/media/{media_id}/cash-due-refunds` et `/release`.
- **Alternatives considered**: un paramètre `amount` sur `releaseMedia` (mélange restitution et rendu, change une route).

## D6 — Spécification et ADR

- **Decision**: amender `SPECIFICATION.md` §8.5 (rendu partiel en espèces, conditions) et §17 (deux réglages et leurs
  défauts) ; ADR-233 « rendu partiel en espèces au guichet, autorisé par le prestataire, activé par l'organisateur ».
- **Rationale**: règle de priorité §0.3 ; réalise ADR-53 point 3.

## Limites relevées (à consigner au moment du code)

- **L1**: levée avant codage : le cumul suit le portefeuille, un bracelet remplacé ne repart pas de zéro.
- **L2**: le rendu partiel ne rend pas les espèces dues (`refundCashDue` reste la seule voie, C-002).
