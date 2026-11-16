# Decision Moment `01M7AGA9XHFVJJSK267D76M9D4`

- **Mission:** `remboursements-01M7AG5V`
- **Origin flow:** `specify`
- **Slot key:** `specify.scope.backoffice-created-request`
- **Input key:** `backoffice_created_request`
- **Status:** `resolved`
- **Created:** `2026-11-13T13:07:27.281640+00:00`
- **Resolved:** `2026-11-13T13:09:28.834745+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Demande de remboursement créée par le back-office (virement bancaire, BANK_TRANSFER) : le contrat la déclare « opération à ajouter, non décrite ». L'ajouter dans la 9a (route rétrocompatible) ou la reporter ?

## Options

- Reporter (9b ou 11a), consigné
- Ajouter en 9a (route rétrocompatible)
- Other

## Final answer

Reporter : la demande créée par le back-office (virement BANK_TRANSFER) n'est pas dans la 9a ; consignée (OP + report en 9b), contrat inchangé

## Rationale

_(none)_

## Change log

- `2026-11-13T13:07:27.281640+00:00` — opened
- `2026-11-13T13:09:28.834745+00:00` — resolved (final_answer="Reporter : la demande créée par le back-office (virement BANK_TRANSFER) n'est pas dans la 9a ; consignée (OP + report en 9b), contrat inchangé")
