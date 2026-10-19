# Decision Moment `01M59WNZSSTN4YP1W38GPTHMMP`

- **Mission:** `identite-enrolement-terminaux-01M52R6H`
- **Origin flow:** `plan`
- **Slot key:** `plan.tokens.refresh-grace`
- **Input key:** `refresh_reuse_grace`
- **Status:** `resolved`
- **Created:** `2026-10-19T10:52:54.969780+00:00`
- **Resolved:** `2026-10-19T11:00:30.499275+00:00`
- **Resolved by:** `porteur`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Rafraîchissement : un jeton déjà consommé représenté par le même terminal (mTLS + preuve de possession) dans les 60 s révoque-t-il la famille (strict), ou est-il accepté une fois (réponse perdue sur le réseau) ?

## Options

- Strict : famille révoquée
- Grâce de 60 s pour le même terminal
- Other

## Final answer

Grâce de 60 s pour le même terminal

## Rationale

_(none)_

## Change log

- `2026-10-19T10:52:54.969780+00:00` — opened
- `2026-10-19T11:00:30.499275+00:00` — resolved (final_answer="Grâce de 60 s pour le même terminal")
