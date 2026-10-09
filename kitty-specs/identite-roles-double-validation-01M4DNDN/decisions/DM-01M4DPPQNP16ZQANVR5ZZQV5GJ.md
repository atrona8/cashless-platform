# Decision Moment `01M4DPPQNP16ZQANVR5ZZQV5GJ`

- **Mission:** `identite-roles-double-validation-01M4DNDN`
- **Origin flow:** `plan`
- **Slot key:** `plan.approval.act-hash-format`
- **Input key:** `act_hash_canonical`
- **Status:** `resolved`
- **Created:** `2026-10-08T12:09:43.862757+00:00`
- **Resolved:** `2026-10-08T12:09:58.750779+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Format exact de la requête canonique hachée dans act_hash (remplace la décision 01M4DPB4C16Q7C4HDP80MSPS9T, enregistrée sans réponse) ?

## Options

- SHA-256 hex de la méthode, du chemin réel et du corps JCS séparés par des sauts de ligne
- Other

## Final answer

SHA-256 hex de : méthode HTTP en majuscules, saut de ligne, chemin réel de la requête avec le préfixe /v1 et sans chaîne de requête, saut de ligne, corps en JSON canonique JCS (null si absent). Même construction que l'empreinte S21 de la mission 1, mais avec le chemin réel ; écrite dans le contrat pour le serveur d'identité et les terminaux. Décidé par l'agent, délégation du porteur du projet.

## Rationale

_(none)_

## Change log

- `2026-10-08T12:09:43.862757+00:00` — opened
- `2026-10-08T12:09:58.750779+00:00` — resolved (final_answer="SHA-256 hex de : méthode HTTP en majuscules, saut de ligne, chemin réel de la requête avec le préfixe /v1 et sans chaîne de requête, saut de ligne, corps en JSON canonique JCS (null si absent). Même construction que l'empreinte S21 de la mission 1, mais avec le chemin réel ; écrite dans le contrat pour le serveur d'identité et les terminaux. Décidé par l'agent, délégation du porteur du projet.")
