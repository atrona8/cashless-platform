# Decision Moment `01M4AYCMYA8NFD6SRQRGD0BBMC`

- **Mission:** `fondations-grand-livre-01M4AY8M`
- **Origin flow:** `specify`
- **Slot key:** `specify.tooling.local-pgtap`
- **Input key:** `local_pgtap_strategy`
- **Status:** `resolved`
- **Created:** `2026-10-07T10:26:18.698331+00:00`
- **Resolved:** `2026-10-07T10:28:55.182597+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Comment faire tourner les 464 assertions pgTAP en local (pgTAP absent du PostgreSQL 17 Windows, pas de Docker) ?

## Options

- pgTAP chargé en SQL dans le PostgreSQL 17 Windows + pg_prove via Perl de Git Bash
- PostgreSQL 17 + pgTAP installés dans WSL Ubuntu 24.04
- CI GitHub seulement, pas de pgTAP local
- Other

## Final answer

pgTAP chargé en SQL dans le PostgreSQL 17 Windows + pg_prove via Perl de Git Bash (script du dépôt, sans make ni droits admin)

## Rationale

_(none)_

## Change log

- `2026-10-07T10:26:18.698331+00:00` — opened
- `2026-10-07T10:28:55.182597+00:00` — resolved (final_answer="pgTAP chargé en SQL dans le PostgreSQL 17 Windows + pg_prove via Perl de Git Bash (script du dépôt, sans make ni droits admin)")
