# Decision Moment `01M7AHA44G4WAMEJBK1KFN4FS8`

- **Mission:** `remboursements-01M7AG5V`
- **Origin flow:** `plan`
- **Slot key:** `plan.rules.blocked-wallet`
- **Input key:** `blocked_wallet_refund`
- **Status:** `resolved`
- **Created:** `2026-11-13T13:24:49.936997+00:00`
- **Resolved:** `2026-11-13T13:35:12.945108+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Portefeuille bloqué ou bracelet suspendu : remboursable ?

## Options

- Perte oui, contestation/fraude non
- Toujours
- Jamais
- Other

## Final answer

Remboursable si le seul blocage vient d'un bracelet déclaré perdu (SUSPENDED) ; refus 422 REFUND_NOT_ALLOWED si portefeuille bloqué pour contestation, fraude ou other_block, ou bracelet BLACKLISTED

## Rationale

_(none)_

## Change log

- `2026-11-13T13:24:49.936997+00:00` — opened
- `2026-11-13T13:35:12.945108+00:00` — resolved (final_answer="Remboursable si le seul blocage vient d'un bracelet déclaré perdu (SUSPENDED) ; refus 422 REFUND_NOT_ALLOWED si portefeuille bloqué pour contestation, fraude ou other_block, ou bracelet BLACKLISTED")
