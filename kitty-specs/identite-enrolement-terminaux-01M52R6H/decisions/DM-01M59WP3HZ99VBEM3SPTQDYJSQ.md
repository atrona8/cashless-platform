# Decision Moment `01M59WP3HZ99VBEM3SPTQDYJSQ`

- **Mission:** `identite-enrolement-terminaux-01M52R6H`
- **Origin flow:** `plan`
- **Slot key:** `plan.enrollment.serial-scope`
- **Input key:** `serial_scope`
- **Status:** `resolved`
- **Created:** `2026-10-19T10:52:58.815534+00:00`
- **Resolved:** `2026-10-19T11:00:35.097258+00:00`
- **Resolved by:** `porteur`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

L'index du schéma de référence rend le serial unique entre tous les prestataires : un prestataire apprend qu'un serial existe ailleurs et peut le bloquer. Garder l'unicité globale (référence) ou la borner au prestataire par migration ?

## Options

- Unicité par prestataire, par migration
- Unicité globale du schéma de référence
- Other

## Final answer

Unicité par prestataire, par migration

## Rationale

_(none)_

## Change log

- `2026-10-19T10:52:58.815534+00:00` — opened
- `2026-10-19T11:00:35.097258+00:00` — resolved (final_answer="Unicité par prestataire, par migration")
