# Decision Moment `01M4TFX26WKVWWFPNQF88G6N5A`

- **Mission:** `bracelets-nfc-01M4TD3W`
- **Origin flow:** `plan`
- **Slot key:** `plan.architecture.database-roles`
- **Input key:** `database_roles`
- **Status:** `resolved`
- **Created:** `2026-10-13T11:20:58.844296+00:00`
- **Resolved:** `2026-10-13T11:22:22.791663+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Les quatre processus se connectent-ils à la base avec le même rôle applicatif, qui lit aujourd'hui toutes les tables (dont les mots de passe chiffrés et les clés de données chiffrées), ou avec des rôles de base distincts ?

## Options

- A. Rôles de base distincts : seuls les processus des clés lisent les mots de passe chiffrés et les clés de données chiffrées ; l API publique en perd la lecture
- B. Même rôle applicatif pour tous ; la séparation repose sur le KMS seul
- Other

## Final answer

A. Rôles de base distincts : seuls les processus des clés lisent les mots de passe chiffrés et les clés de données chiffrées ; l'API publique en perd la lecture (sous réserve de la suite de référence, §0.3)

## Rationale

_(none)_

## Change log

- `2026-10-13T11:20:58.844296+00:00` — opened
- `2026-10-13T11:22:22.791663+00:00` — resolved (final_answer="A. Rôles de base distincts : seuls les processus des clés lisent les mots de passe chiffrés et les clés de données chiffrées ; l'API publique en perd la lecture (sous réserve de la suite de référence, §0.3)")
