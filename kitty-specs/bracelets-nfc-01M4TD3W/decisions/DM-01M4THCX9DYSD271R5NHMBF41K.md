# Decision Moment `01M4THCX9DYSD271R5NHMBF41K`

- **Mission:** `bracelets-nfc-01M4TD3W`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.dek-memory-cache`
- **Input key:** `dek_memory_cache`
- **Status:** `resolved`
- **Created:** `2026-10-13T11:47:06.669592+00:00`
- **Resolved:** `2026-10-13T11:55:15.535229+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Clé de données déchiffrée en mémoire par le processus des clés de bracelet : le contrat parle d un déchiffrement mis en cache mémoire, la spécification demande l effacement à la fin. Quelle règle ?

## Options

- A. Cache court (5 minutes au plus, réglable, effacé à l expiration et à l arrêt)
- B. Aucun cache : un déchiffrement par demande, effacé aussitôt
- C. Cache pendant toute la vie du processus
- Other

## Final answer

A. Cache court (5 minutes au plus, réglable, effacé à l'expiration et à l'arrêt)

## Rationale

_(none)_

## Change log

- `2026-10-13T11:47:06.669592+00:00` — opened
- `2026-10-13T11:55:15.535229+00:00` — resolved (final_answer="A. Cache court (5 minutes au plus, réglable, effacé à l'expiration et à l'arrêt)")
