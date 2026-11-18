# Ajouts au contrat `openapi.yaml` (mission 9b) — **validés par le porteur le 17/11/2026, tels quels**

Décision du porteur du 17/11/2026 (C-002) : les opérations absentes sont ajoutées, listées ici et validées avant
l'implémentation. **Rien d'existant ne change** : aucune route, aucun champ, aucun code ni aucune valeur d'enum existants
ne sont modifiés ou retirés. Tout est `x-process: public`, sécurité `humanBearer`, erreurs `Problem`, pagination
`Cursor`/`Limit`/`PageMeta`, en-tête `Idempotency-Key` sur toute écriture.

**Déjà au contrat et servi par la 9b sans changement** : `postLateClaim` (`POST /ledgers/{ledger_id}/late-claims`), les
actions d'approbation `PAYOUT`, `LATE_CLAIM` et `ADJUSTMENT`, et le code `CLOSING_CONDITION_NOT_MET`.

## 1. Opérations ajoutées (20 opérations sur 19 lignes)

### Clôture (4)

| # | Méthode et chemin | operationId | Rôle | Réponse |
|---|---|---|---|---|
| 1 | `GET /operators/{operator_id}/events/{event_id}/closing-steps` | `listEventClosingSteps` | ORGANIZER_ADMIN, OPERATOR_ADMIN, SUPERVISOR (lecture) | `200` liste `ClosingStepState` dans l'ordre |
| 2 | `GET /operators/{operator_id}/events/{event_id}/closing-steps/{step}/preview` | `previewEventClosingStep` | ORGANIZER_ADMIN, OPERATOR_ADMIN | `200` `ClosingStepPreview` (rien n'est écrit) |
| 3 | `POST /operators/{operator_id}/events/{event_id}/closing-steps/{step}` | `executeEventClosingStep` | ORGANIZER_ADMIN, OPERATOR_ADMIN | `200` `ClosingStepResult` ; `409 CLOSING_CONDITION_NOT_MET` (ordre, statut) |
| 4 | `GET /operators/{operator_id}/events/{event_id}/remaining-balances` | `getEventRemainingBalances` | ORGANIZER_ADMIN, OPERATOR_ADMIN | `200` `RemainingBalances` ; `format=csv` → `text/csv` |

### Versements (5)

| # | Méthode et chemin | operationId | Rôle | Réponse |
|---|---|---|---|---|
| 5 | `GET /ledgers/{ledger_id}/payout-entitlements` | `listPayoutEntitlements` | ORGANIZER_ADMIN, OPERATOR_ADMIN | `200` droits nets par partie, moins les versements en cours |
| 6 | `POST /ledgers/{ledger_id}/payout-batches/approval-requests` | `requestPayoutBatch` | selon le bénéficiaire : ORGANIZER_ADMIN (commerçants, organisateur), OPERATOR_ADMIN (prestataire, plateforme) | `202` `ApprovalRequestAccepted` (action `PAYOUT`) |
| 7 | `GET /ledgers/{ledger_id}/payouts` | `listPayouts` | ORGANIZER_ADMIN, OPERATOR_ADMIN | `200` page de `Payout` (filtres `status`, `approval_request_id`) |
| 8 | `GET /ledgers/{ledger_id}/payout-batches/{approval_request_id}/export` | `exportPayoutBatch` | rôle du lot | `200 text/csv` (bénéficiaire, moyen, numéro ou IBAN, montant, référence) ; non rejouée (ajoutée à la liste de `IdempotencyKey`) |
| 9 | `POST /payouts/{payout_id}/confirm` | `confirmPayout` | rôle du lot | `200` `Payout` ; `CONFIRMED` + `external_reference` ou `FAILED` + `failure_reason` |

### Rapprochement (4)

| # | Méthode et chemin | operationId | Rôle | Réponse |
|---|---|---|---|---|
| 10 | `POST /ledgers/{ledger_id}/accounts/{account_id}/statements` | `importAccountStatement` | ORGANIZER_ADMIN, OPERATOR_ADMIN | corps `text/csv` + paramètres `source`, `statement_date`, `closing_balance` ; `201` `StatementImportResult` (créées, rapprochées, déjà présentes) |
| 11 | `GET /ledgers/{ledger_id}/statement-lines` | `listStatementLines` | ORGANIZER_ADMIN, OPERATOR_ADMIN | `200` page de `StatementLine` (filtres `account_id`, `matched`) |
| 12 | `POST /statement-lines/{statement_line_id}/match` | `matchStatementLine` | ORGANIZER_ADMIN, OPERATOR_ADMIN | corps `{transaction_id}` ou `{anomaly_id}` ; `200` `StatementLine` |
| 13 | `GET /ledgers/{ledger_id}/reconciliation` | `getLedgerReconciliation` | ORGANIZER_ADMIN, OPERATOR_ADMIN, SUPERVISOR | `200` état par compte d'argent (lignes, non rapprochées, solde relevé, solde grand livre, rapproché oui ou non) |

### Réclamations tardives (1)

| # | Méthode et chemin | operationId | Rôle | Réponse |
|---|---|---|---|---|
| 14 | `POST /ledgers/{ledger_id}/late-adjustments` | `postLateAdjustment` | ORGANIZER_ADMIN, OPERATOR_ADMIN | `202` `ApprovalRequestAccepted` (action `ADJUSTMENT`) ; corps `LateAdjustmentRequest` |

### Demande de remboursement du back-office (1)

| # | Méthode et chemin | operationId | Rôle | Réponse |
|---|---|---|---|---|
| 15 | `POST /refund-requests` | `createRefundRequest` | ORGANIZER_ADMIN, OPERATOR_ADMIN | `201` `RefundRequest` (`REQUESTED`) ; corps `RefundRequestBackofficeCreate` (`wallet_id`, `destination` WAVE, ORANGE_MONEY ou BANK_TRANSFER avec `iban`, `reason`) |

### Relevés et export (4)

| # | Méthode et chemin | operationId | Rôle | Réponse |
|---|---|---|---|---|
| 16 | `GET /operators/{operator_id}/events/{event_id}/statements/{party_kind}` | `getPartyStatement` | `MERCHANT_ADMIN` (son commerçant), ORGANIZER_ADMIN, OPERATOR_ADMIN, PLATFORM_ADMIN selon `party_kind` (`MERCHANT`, `ORGANIZER`, `OPERATOR`, `PLATFORM`) et `party_id` | `200` `PartyStatement` ou `text/csv` (`format=csv`) |
| 17 | `GET /me/wallets/{wallet_id}/statement` | `getMyWalletStatement` | festivalier (son portefeuille) | `200 text/csv` |
| 18 | `GET /operators/{operator_id}/account-mappings` et `POST` (nouvelle version) | `listAccountMappings`, `createAccountMappingVersion` | OPERATOR_ADMIN (écriture), lecture aussi ORGANIZER_ADMIN | `200` / `201` `AccountMappingVersion` |
| 19 | `GET /operators/{operator_id}/accounting-exports` | `exportAccounting` | OPERATOR_ADMIN, ORGANIZER_ADMIN (son entité) | `text/csv` ; paramètres `entity`, `from`, `to` ; couples non mappés listés en tête de fichier et dans l'en-tête `X-Unmapped-Count` |

Note : la ligne 18 compte deux opérations sur un même chemin. Le total est donc 20 `operationId`.

## 2. Schémas ajoutés

`ClosingStep` (enum : `PITCH_FEES`, `OPERATOR_FEE`, `PLATFORM_FEE`, `OPERATOR_FEE_REGULARIZATION`, `BREAKAGE`,
`DEPOSIT_FORFEIT`, `PROMO_EXPIRY`), `ClosingStepState`, `ClosingStepPreview`, `ClosingStepResult`, `RemainingBalances`,
`PayoutEntitlement`, `PayoutBatchRequest`, `PayoutLine`, `Payout`, `PayoutConfirm`, `StatementImportResult`,
`StatementLine`, `StatementLineMatch`, `AccountReconciliation`, `LateAdjustmentRequest`, `RefundRequestBackofficeCreate`,
`PartyStatement`, `AccountMapping`, `AccountMappingVersion`.

## 3. Valeurs d'enum ajoutées à des schémas existants

- `StatusCondition.code` : `NO_OPEN_CASH_SESSION`, `REFUND_DEADLINE_REACHED`, `CLOSING_STEPS_DONE`. Ce sont des ajouts ;
  `PSP_RECONCILED` passe de « externe » à « calculée », avec la même valeur.

## 4. Codes d'erreur ajoutés (`ProblemCode`)

| Code | Statut | SQLSTATE | Sens |
|---|---|---|---|
| `PAYOUT_EXCEEDS_ENTITLEMENT` | 409 | `CL055` | Montant d'un versement supérieur au droit net disponible du bénéficiaire (versements en cours déduits) |

Tous les autres refus réutilisent des codes existants : `CLOSING_CONDITION_NOT_MET`, `CONFLICT_STATE`,
`VALIDATION_FAILED` (IBAN, CSV, devise), `NOT_FOUND`, `FORBIDDEN`, `LATE_CLAIM_INVALID`, `LEDGER_LOCKED`,
`DEBIT_AUTHORITY_EDGE`, `IDEMPOTENCY_KEY_REUSED`.

## 5. Ce qui n'est PAS ajouté

- Aucune route d'envoi de paiement : paiement manuel (C-003).
- Aucune route d'alerte : les alertes restent internes (C-010).
- Aucun PDF (décision du 17/11/2026).
