# Decision Moment `01M4DP5QQ56PTB4M3GC99VZ20S`

- **Mission:** `identite-roles-double-validation-01M4DNDN`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.jwt-library`
- **Input key:** `jwt_library`
- **Status:** `resolved`
- **Created:** `2026-10-08T12:00:26.853815+00:00`
- **Resolved:** `2026-10-08T12:00:42.035889+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Quelle bibliothèque pour vérifier les JWT et lire les clés publiques du serveur d'identité ?

## Options

- jose 6.2.12 épinglé (aucune dépendance, aucun script d'installation)
- Vérification maison avec node:crypto
- Other

## Final answer

jose 6.2.12 épinglé (panva, aucune dépendance, aucun script d'installation, publié il y a 33 jours) ; ESM seul, chargé comme canonicalize (require(esm) en production, exception transformIgnorePatterns en test). (décidé par l'agent, délégation du porteur du projet)

## Rationale

_(none)_

## Change log

- `2026-10-08T12:00:26.853815+00:00` — opened
- `2026-10-08T12:00:42.035889+00:00` — resolved (final_answer="jose 6.2.12 épinglé (panva, aucune dépendance, aucun script d'installation, publié il y a 33 jours) ; ESM seul, chargé comme canonicalize (require(esm) en production, exception transformIgnorePatterns en test). (décidé par l'agent, délégation du porteur du projet)")
