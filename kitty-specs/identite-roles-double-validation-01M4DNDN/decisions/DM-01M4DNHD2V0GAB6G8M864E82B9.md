# Decision Moment `01M4DNHD2V0GAB6G8M864E82B9`

- **Mission:** `identite-roles-double-validation-01M4DNDN`
- **Origin flow:** `specify`
- **Slot key:** `specify.auth.roles-source`
- **Input key:** `roles_source`
- **Status:** `resolved`
- **Created:** `2026-10-08T11:49:20.603838+00:00`
- **Resolved:** `2026-10-08T11:49:30.460218+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

D'où viennent les rôles et le prestataire d'une personne authentifiée ?

## Options

- De la base (app_user + role_assignment), le jeton ne fait que prouver l'identité
- Des claims du jeton
- Other

## Final answer

De la base : le sub du jeton désigne un app_user actif ; prestataire et rôles viennent de app_user et role_assignment (retrait immédiat d'un rôle) ; un claim operator_id différent du prestataire de l'utilisateur est refusé. Raison : §10.3 prestataire déduit de l'identité, rôle vérifié pour chaque validation. (décidé par l'agent, délégation du porteur du projet)

## Rationale

_(none)_

## Change log

- `2026-10-08T11:49:20.603838+00:00` — opened
- `2026-10-08T11:49:30.460218+00:00` — resolved (final_answer="De la base : le sub du jeton désigne un app_user actif ; prestataire et rôles viennent de app_user et role_assignment (retrait immédiat d'un rôle) ; un claim operator_id différent du prestataire de l'utilisateur est refusé. Raison : §10.3 prestataire déduit de l'identité, rôle vérifié pour chaque validation. (décidé par l'agent, délégation du porteur du projet)")
