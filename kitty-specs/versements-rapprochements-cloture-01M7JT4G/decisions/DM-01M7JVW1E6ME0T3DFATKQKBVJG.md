# Decision Moment `01M7JVW1E6ME0T3DFATKQKBVJG`

- **Mission:** `versements-rapprochements-cloture-01M7JT4G`
- **Origin flow:** `plan`
- **Slot key:** `plan.controls.alert_channel`
- **Input key:** `alert_channel`
- **Status:** `resolved`
- **Created:** `2026-11-16T19:03:18.214691+00:00`
- **Resolved:** `2026-11-16T19:26:53.383741+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Par quel chemin une alerte atteint-elle l exploitation ?

## Options

- Ligne d audit + journal structuré ALERT + pg_notify ; envoi réel en 12b
- Envoi réel (courriel ou SMS) dès la 9b
- Other

## Final answer

Ligne d'audit + journal structuré ALERT + pg_notify ; envoi réel en 12b, dette consignée

## Rationale

_(none)_

## Change log

- `2026-11-16T19:03:18.214691+00:00` — opened
- `2026-11-16T19:26:53.383741+00:00` — resolved (final_answer="Ligne d'audit + journal structuré ALERT + pg_notify ; envoi réel en 12b, dette consignée")
