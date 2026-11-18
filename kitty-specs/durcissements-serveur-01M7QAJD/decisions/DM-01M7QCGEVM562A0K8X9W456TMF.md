# Decision Moment `01M7QCGEVM562A0K8X9W456TMF`

- **Mission:** `durcissements-serveur-01M7QAJD`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.refund-deposit-legacy`
- **Input key:** `refund_deposit_legacy`
- **Status:** `resolved`
- **Created:** `2026-11-18T13:11:02.260148+00:00`
- **Resolved:** `2026-11-18T14:37:22.642965+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

OP-N145 : retirer refund_deposit(uuid, uuid), appelée par refund_deposit_from_balance et par le générateur gen_tests.py (et définie dans le schéma de référence), ou la garder interne, exécutable par aucun rôle ?

## Options

- La garder interne, exécutable par personne (recommandé)
- La retirer (générateur et schéma de référence modifiés)
- Other

## Final answer

Garder refund_deposit(uuid, uuid) interne, exécutable par aucun rôle, prouvé par test ; écart à FR-012 neutre, consigné ; refund_deposit_for_session(uuid, uuid) retirée

## Rationale

_(none)_

## Change log

- `2026-11-18T13:11:02.260148+00:00` — opened
- `2026-11-18T14:37:22.642965+00:00` — resolved (final_answer="Garder refund_deposit(uuid, uuid) interne, exécutable par aucun rôle, prouvé par test ; écart à FR-012 neutre, consigné ; refund_deposit_for_session(uuid, uuid) retirée")
