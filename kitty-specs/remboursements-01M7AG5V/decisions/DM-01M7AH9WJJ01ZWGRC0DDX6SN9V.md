# Decision Moment `01M7AH9WJJ01ZWGRC0DDX6SN9V`

- **Mission:** `remboursements-01M7AG5V`
- **Origin flow:** `plan`
- **Slot key:** `plan.ledger.reversal-after-closing`
- **Input key:** `reversal_after_closing`
- **Status:** `resolved`
- **Created:** `2026-11-13T13:24:42.194957+00:00`
- **Resolved:** `2026-11-13T13:35:05.352255+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Échec de paiement (FAILED) après RECONCILING : la matrice §12.1 refuse le REVERSAL en BACKOFFICE alors que §11.4 et le contrat l'exigent. Étendre la matrice au seul REVERSAL d'un WALLET_REFUND ?

## Options

- Étendre, seulement ce cas
- Refuser FAILED après RECONCILING
- Other

## Final answer

Étendre la matrice au seul REVERSAL d'un WALLET_REFUND (source back-office), partout où WALLET_REFUND est permis ; test négatif pour tout autre REVERSAL ; contradiction §11.4/§12.1 consignée (ADR)

## Rationale

_(none)_

## Change log

- `2026-11-13T13:24:42.194957+00:00` — opened
- `2026-11-13T13:35:05.352255+00:00` — resolved (final_answer="Étendre la matrice au seul REVERSAL d'un WALLET_REFUND (source back-office), partout où WALLET_REFUND est permis ; test négatif pour tout autre REVERSAL ; contradiction §11.4/§12.1 consignée (ADR)")
