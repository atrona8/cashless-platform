# Interfaces partagées entre lots (mission 9b)

Fichier de référence pour les lots : noms, signatures et propriétaires. Un lot ne change pas une interface qu'il ne
possède pas ; il signale le besoin à l'orchestrateur.

## Base de données

| Objet | Propriétaire (préoccupation) | Consommateurs |
|---|---|---|
| Migration conditions de statut (`set_event_status`, `event_transition_conditions`) | IC-01 (après IC-05, qui fournit `account_reconciliation`) | IC-02 |
| `closing_step`, `record_closing_step` | IC-01 | IC-02 |
| `payout` (colonnes, droits, déclencheur), `create_payout_batch`, `settle_payout` | IC-03 | IC-05 (rapprochement par `settled_tx_id`), IC-08 |
| `statement_import`, `external_statement_line` (colonnes, droits, garde), `import_statement_lines`, `match_statement_line`, `account_reconciliation` | IC-05 | IC-01 (`PSP_RECONCILED`), IC-07 (OP-N126) |
| `refund_request_transition_guard`, `refund_deposit_for_session(…, actor, approver)` | IC-07 | — |
| `ops_*`, `ops_raise_alert` | IC-08 | — |
| `account_mapping` | IC-09 | — |
| Prochain SQLSTATE : `CL055` (`PAYOUT_EXCEEDS_ENTITLEMENT`) | IC-03 | — |

## TypeScript

| Interface | Fichier | Propriétaire |
|---|---|---|
| `ClosingStepService.list(eventId)`, `.preview(eventId, step)`, `.execute(eventId, step, actor, key)` | `apps/api/src/closing/closing-steps.service.ts` | IC-02 |
| `ClosingCalculator` (un calcul par étape, partagé aperçu/exécution) | `apps/api/src/closing/calculators/*.ts` | IC-02 |
| `EntitlementService.forLedger(ledgerId)` (droit net moins versements en cours) | `apps/api/src/payouts/entitlements.ts` | IC-03 |
| Action `PAYOUT` : `PAYOUT_ROLES_BY_BENEFICIARY`, `PayoutBatchPayload` | `apps/api/src/payouts/payout-action.ts` | IC-03 |
| `Csv.write(rows, columns)` (RFC 4180, UTF-8, anti-injection de formules), `Csv.parse(text, columns)` | `apps/api/src/common/csv.ts` | IC-03 (premier utilisateur) ; réutilisé par IC-05 et IC-09 |
| `isValidIban(value)`, `normalizeIban(value)` | `apps/api/src/common/iban.ts` | IC-07 ; réutilisé par IC-03 |
| `moneyAccountFor(method)` étendu à `BANK_TRANSFER` → `A-BANQUE` | `apps/api/src/ledger/builders/festival/refund.ts` | IC-06 |
| Port `SealExternalCopy`, `FakeSealCopy`, `createSealCopy(config)`, jeton `SEAL_COPY` | `apps/api/src/sealing/` | IC-08 |
| `OpsAlerts.raise(code, detail)` | `apps/api/src/processes/ops-alerts.ts` | IC-08 |
| Textes des nouveaux codes de condition | `apps/api/src/events/status/status-messages.ts` | IC-01 |

## Codes d'alarme du processus `maintenance`

| Code | Travailleur |
|---|---|
| 7 | `ledger-seal`, `audit-seal` (échec de scellement ou de copie) |
| 8 | `seal-verify` (écart de chaîne ou de copie ; « copie simulée » n'est pas un écart) |
| 9 | `ledger-controls` (somme, droits = argent, cache, comptes chauds) |
| 10 | `payout-overdue`, `statement-unmatched`, `open-anomalies` |
| 11 | `long-transactions` |

## Ordre des verrous (éviter les interblocages)

Grand livre (verrou consultatif d'autorité) → événement → étape de clôture (verrou consultatif) → bracelet →
portefeuilles (ordre des identifiants) → comptes d'un bénéficiaire (ordre des identifiants) → ligne de relevé.
