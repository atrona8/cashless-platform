# Decision Moment `01M7QCGPMJE5K4FGCYTEH01MFD`

- **Mission:** `durcissements-serveur-01M7QAJD`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.app-attest-grants`
- **Input key:** `app_attest_grants`
- **Status:** `resolved`
- **Created:** `2026-11-18T13:11:10.226295+00:00`
- **Resolved:** `2026-11-18T14:37:30.181624+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

OP-N64 : garder la clé App Attest à l'enrôlement (nouvelle version d'enroll_device, même droit) et donner à cashless_app l'EXECUTE d'une fonction étroite advance_app_attest_counter (compteur strictement croissant, refus sinon) ?

## Options

- Oui, un seul EXECUTE nouveau et étroit (recommandé)
- Non, reporter tout OP-N64 côté serveur à la mission 12
- Other

## Final answer

Oui : un seul EXECUTE nouveau pour cashless_app sur advance_app_attest_counter (mise à jour seulement si le compteur croît), figé dans tests_execute_grants.sql ; clé gardée par une nouvelle version d'enroll_device ; risque de déni de service des assertions consigné

## Rationale

_(none)_

## Change log

- `2026-11-18T13:11:10.226295+00:00` — opened
- `2026-11-18T14:37:30.181624+00:00` — resolved (final_answer="Oui : un seul EXECUTE nouveau pour cashless_app sur advance_app_attest_counter (mise à jour seulement si le compteur croît), figé dans tests_execute_grants.sql ; clé gardée par une nouvelle version d'enroll_device ; risque de déni de service des assertions consigné")
