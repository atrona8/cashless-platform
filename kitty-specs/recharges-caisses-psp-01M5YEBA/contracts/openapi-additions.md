# Contrat : ajouts et corrections de `openapi.yaml`

Types TypeScript et Dart régénérés ; `npm run check -w @cashless/contracts` vert.

## Corrections d'opérations existantes (contradictions signalées)

| Opération | Avant | Après | Raison |
|---|---|---|---|
| `openCashSession` | `humanBearer` ; `cash_account_id` requis | terminal (trois preuves) + `X-Staff-Authorization` ; `cash_account_id` facultatif, doit être la caisse du terminal | R-01, R-04 (renforcement) |
| `countCashSession` | `humanBearer` | terminal + personne ; réponse sans théorique | R-03, R-04 |
| `closeCashSession` | `SUPERVISOR` | `SUPERVISOR` ≠ auteur du dernier comptage (`403`) ; back-office ou terminal + personne | R-03 |
| `initiatePspTopup` | `deviceMtls` ou `humanBearer` ; `CARD_DAILY_LIMIT` à l'initiation | terminal + personne, ou festivalier (`CustomerAuth`) ; `CARD_DAILY_LIMIT` retiré de l'initiation | R-11, R-16 |
| `receivePspWebhook` | « rien n'est écrit » | + `413` au-delà de 64 Kio ; refus signalés (journal de sécurité, alerte bornée) | R-10 |
| `takeDeposit`, `refundDeposit` | sans `cash_session_id` | `cash_session_id` facultatif ; espèces : session ouverte du terminal | R-02 |
| `refundCashDue`, `releaseMedia` | `cash_session_id` refusé (`409`) tant que les sessions n'existent pas | accepté, renvoyé dans la réponse | FR-008 |
| `PspTopup.status` | 5 statuts | inchangé ; `failure_reason` ajouté | R-11 |
| `ApprovalAction` | — | + `WALLET_UNBLOCK`, `CASH_DEPOSIT` | R-14, R-15 |

## Opérations ajoutées

| operationId | Route | Qui |
|---|---|---|
| `getCashSession` | `GET /cash-sessions/{id}` | contracts/cash.md règle 5 |
| `listCashSessions` | `GET /events/{event_id}/cash-sessions` | `SUPERVISOR`, `ORGANIZER_ADMIN` |
| `createPspConfiguration` | `POST /organizers/{organizer_id}/psp-configurations` | `OPERATOR_ADMIN` |
| `listPspConfigurations` | `GET /organizers/{organizer_id}/psp-configurations` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` |
| `getPspConfiguration` | `GET /psp-configurations/{id}` | idem |
| `getEventPspSelections` | `GET /events/{event_id}/psp-selections` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` |
| `setEventPspSelection` | `PUT /events/{event_id}/psp-selections/{method}` | `ORGANIZER_ADMIN` (`200`, ou `202` + demande pendant `LIVE`) |
| `cancelPspTopup` | `POST /topups/psp/{topup_id}/cancel` | demandeur |

Nouveaux codes : `PSP_TOPUP_NOT_CREDITED` (motif d'échec), `CASH_SESSION_REQUIRED` n'est pas créé : le refus sans
session garde `409 CONFLICT_STATE` (ADR-89).
