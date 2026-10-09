# Decision Moment `01M4DP98VACN4PKE6H1WD239C4`

- **Mission:** `identite-roles-double-validation-01M4DNDN`
- **Origin flow:** `plan`
- **Slot key:** `plan.api.platform-admin-tenant`
- **Input key:** `platform_admin_tenant`
- **Status:** `resolved`
- **Created:** `2026-10-08T12:02:22.698559+00:00`
- **Resolved:** `2026-10-08T12:03:06.285988+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Comment un PLATFORM_ADMIN (sans prestataire) agit-il dans un prestataire ?

## Options

- Par l'objet visé dans le chemin (/operators/{operator_id}/...), après vérification de son rôle plateforme ; les autres personnes ne peuvent viser que leur propre prestataire (404 sinon)
- Paramètre libre
- Other

## Final answer

Par l'objet visé dans le chemin (/operators/{operator_id}/…) : un PLATFORM_ADMIN peut viser tout prestataire ; toute autre personne seulement le sien (404 sinon, identique à un objet inexistant) ; jamais par un paramètre libre ni par le jeton. (décidé par l'agent, délégation du porteur du projet)

## Rationale

_(none)_

## Change log

- `2026-10-08T12:02:22.698559+00:00` — opened
- `2026-10-08T12:03:06.285988+00:00` — resolved (final_answer="Par l'objet visé dans le chemin (/operators/{operator_id}/…) : un PLATFORM_ADMIN peut viser tout prestataire ; toute autre personne seulement le sien (404 sinon, identique à un objet inexistant) ; jamais par un paramètre libre ni par le jeton. (décidé par l'agent, délégation du porteur du projet)")
