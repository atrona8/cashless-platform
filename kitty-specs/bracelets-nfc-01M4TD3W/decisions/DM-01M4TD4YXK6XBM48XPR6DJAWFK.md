# Decision Moment `01M4TD4YXK6XBM48XPR6DJAWFK`

- **Mission:** `bracelets-nfc-01M4TD3W`
- **Origin flow:** `specify`
- **Slot key:** `specify.scope.terminal-authentication`
- **Input key:** `terminal_authentication`
- **Status:** `resolved`
- **Created:** `2026-10-13T10:32:51.891283+00:00`
- **Resolved:** `2026-10-13T10:34:18.952390+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Les routes des bracelets appelées par un terminal (POST /taps, /media/auth-keys, activation, caution, restitution, remplacement) exigent au contrat un terminal authentifié, livré par la mission 5. Comment la mission 4 les sert-elle ?

## Options

- A. Mission 4 livre les services et les routes derrière un port d identité du terminal, avec un faux terminal pour les tests ; la mission 5 branche l enrôlement réel
- B. Mission 4 livre seulement les services (sans routes de terminal) ; les routes arrivent en mission 5
- C. Mission 4 inclut un enrôlement minimal des terminaux
- Other

## Final answer

A. Mission 4 livre les services et les routes derrière un port d'identité du terminal, avec un faux terminal pour les tests ; la mission 5 branche l'enrôlement réel

## Rationale

_(none)_

## Change log

- `2026-10-13T10:32:51.891283+00:00` — opened
- `2026-10-13T10:34:18.952390+00:00` — resolved (final_answer="A. Mission 4 livre les services et les routes derrière un port d'identité du terminal, avec un faux terminal pour les tests ; la mission 5 branche l'enrôlement réel")
