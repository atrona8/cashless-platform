# Decision Moment `01M86TP0JH9S6SGW81JCCPB5Y3`

- **Mission:** `routes-backoffice-01M86KT6`
- **Origin flow:** `plan`
- **Slot key:** `plan.anomalies.classable-kinds`
- **Input key:** `classable_anomaly_kinds`
- **Status:** `resolved`
- **Created:** `2026-11-24T13:07:20.785750+00:00`
- **Resolved:** `2026-11-24T13:08:15.520844+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Quels types d'anomalie peut-on classer traitée sans écriture au grand livre ?

## Options

- Liste proposée (aucun argent en attente)
- Liste proposée sans les anomalies de sécurité du bracelet
- Other

## Final answer

Proposition : 10 types classables (CASH_DIFF, CLOCK_SKEW, CARD_VELOCITY, IDEMPOTENCY_CONFLICT, CHAIN_BROKEN, COUNTER_DUPLICATE, COUNTER_TIME_INVERSION, UID_MISMATCH, RETIRED_IDENTITY, SIGNATURE_MISMATCH), liste tenue dans la base ; 12 non classables. Classer ne bloque ni ne débloque aucun bracelet.

## Rationale

_(none)_

## Change log

- `2026-11-24T13:07:20.785750+00:00` — opened
- `2026-11-24T13:08:15.520844+00:00` — resolved (final_answer="Proposition : 10 types classables (CASH_DIFF, CLOCK_SKEW, CARD_VELOCITY, IDEMPOTENCY_CONFLICT, CHAIN_BROKEN, COUNTER_DUPLICATE, COUNTER_TIME_INVERSION, UID_MISMATCH, RETIRED_IDENTITY, SIGNATURE_MISMATCH), liste tenue dans la base ; 12 non classables. Classer ne bloque ni ne débloque aucun bracelet.")
