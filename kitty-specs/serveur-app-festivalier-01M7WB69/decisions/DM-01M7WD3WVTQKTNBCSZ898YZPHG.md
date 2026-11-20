# Decision Moment `01M7WD3WVTQKTNBCSZ898YZPHG`

- **Mission:** `serveur-app-festivalier-01M7WB69`
- **Origin flow:** `plan`
- **Slot key:** `plan.op-n47.reemission`
- **Input key:** `claim_rotation_reissue`
- **Status:** `resolved`
- **Created:** `2026-11-20T11:57:51.354247+00:00`
- **Resolved:** `2026-11-20T12:01:51.926349+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Après rotation du secret, comment les bracelets déjà codés deviennent-ils réémissibles (aujourd'hui l'import refuse MEDIA_ALREADY_HAS_CODE) ?

## Options

- version du secret avec chaque empreinte
- commande de purge
- Other

## Final answer

Version du secret portée par chaque empreinte ; une empreinte d'une ancienne version compte comme absente (code refusé, bracelet réémissible)

## Rationale

_(none)_

## Change log

- `2026-11-20T11:57:51.354247+00:00` — opened
- `2026-11-20T12:01:51.926349+00:00` — resolved (final_answer="Version du secret portée par chaque empreinte ; une empreinte d'une ancienne version compte comme absente (code refusé, bracelet réémissible)")
