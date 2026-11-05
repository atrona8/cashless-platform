# Decision Moment `01M6NQ48PGNN5HVVQM81XR6YAB`

- **Mission:** `passerelle-locale-01M6NM1S`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.staff-token-expiry`
- **Input key:** `staff_token_expiry`
- **Status:** `resolved`
- **Created:** `2026-11-05T11:22:26.384485+00:00`
- **Resolved:** `2026-11-05T11:26:05.548995+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Pendant EDGE, que faire d'un jeton de personne expiré au guichet ?

## Options

- Tolérance bornée : même personne, même terminal, session ouverte, 12 h
- Refus strict
- Other

## Final answer

Tolérance bornée, sur la passerelle seulement : jeton expiré mais bien signé, personne qui a ouvert la session, même terminal, session ouverte, 12 h au plus après la bascule, chaque usage audité. Risque accepté par le porteur le 05/11/2026 : compte révoqué pendant la coupure utilisable sur ce guichet. Dette nommée (OP, ADR, test).

## Rationale

_(none)_

## Change log

- `2026-11-05T11:22:26.384485+00:00` — opened
- `2026-11-05T11:26:05.548995+00:00` — resolved (final_answer="Tolérance bornée, sur la passerelle seulement : jeton expiré mais bien signé, personne qui a ouvert la session, même terminal, session ouverte, 12 h au plus après la bascule, chaque usage audité. Risque accepté par le porteur le 05/11/2026 : compte révoqué pendant la coupure utilisable sur ce guichet. Dette nommée (OP, ADR, test).")
