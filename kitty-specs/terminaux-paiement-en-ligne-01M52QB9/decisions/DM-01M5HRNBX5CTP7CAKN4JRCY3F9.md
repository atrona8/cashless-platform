# Decision Moment `01M5HRNBX5CTP7CAKN4JRCY3F9`

- **Mission:** `terminaux-paiement-en-ligne-01M52QB9`
- **Origin flow:** `plan`
- **Slot key:** `plan.reversal.supervisor-path`
- **Input key:** `reversal_supervisor_path`
- **Status:** `resolved`
- **Created:** `2026-10-22T12:16:35.749776+00:00`
- **Resolved:** `2026-10-22T12:24:51.018453+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Annulation hors fenêtre ou d'un autre vendeur : comment le SUPERVISOR intervient (terminal par jeton sur place adapté, back-office à deux, back-office à une personne) ?

## Options

_(none)_

## Final answer

Au terminal : jeton d'approbation sur place du SUPERVISOR de l'événement, lié à la requête, usage unique, appelant = terminal et session de vendeur (variante de garde, deux personnes distinctes et portée événement gardées) ; au back-office : demande d'approbation à deux personnes, source BACKOFFICE

## Rationale

_(none)_

## Change log

- `2026-10-22T12:16:35.749776+00:00` — opened
- `2026-10-22T12:24:51.018453+00:00` — resolved (final_answer="Au terminal : jeton d'approbation sur place du SUPERVISOR de l'événement, lié à la requête, usage unique, appelant = terminal et session de vendeur (variante de garde, deux personnes distinctes et portée événement gardées) ; au back-office : demande d'approbation à deux personnes, source BACKOFFICE")
