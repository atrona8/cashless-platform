# Decision Moment `01M5HNVXD7J63V88AQK6JZSHXS`

- **Mission:** `terminaux-paiement-en-ligne-01M52QB9`
- **Origin flow:** `plan`
- **Slot key:** `plan.architecture.vendor-session-carriage`
- **Input key:** `vendor_session_carriage`
- **Status:** `resolved`
- **Created:** `2026-10-22T11:27:44.551962+00:00`
- **Resolved:** `2026-10-22T11:31:29.893640+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Comment une requête de vente désigne-t-elle la session de vendeur : la session ouverte du terminal, retrouvée par le serveur, avec son identifiant renvoyé par le terminal pour contrôle ; ou un jeton de session porté par le terminal ?

## Options

- Session ouverte du terminal + identifiant de contrôle
- Jeton de session de vendeur
- Other

## Final answer

Au plus une session ouverte par terminal, retrouvée par le serveur ; le terminal renvoie l'identifiant (non secret) de la session dans chaque vente et annulation, écart refusé ; aucun jeton de session

## Rationale

_(none)_

## Change log

- `2026-10-22T11:27:44.551962+00:00` — opened
- `2026-10-22T11:31:29.893640+00:00` — resolved (final_answer="Au plus une session ouverte par terminal, retrouvée par le serveur ; le terminal renvoie l'identifiant (non secret) de la session dans chaque vente et annulation, écart refusé ; aucun jeton de session")
