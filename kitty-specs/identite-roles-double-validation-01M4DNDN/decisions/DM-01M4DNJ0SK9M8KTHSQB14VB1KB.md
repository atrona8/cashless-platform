# Decision Moment `01M4DNJ0SK9M8KTHSQB14VB1KB`

- **Mission:** `identite-roles-double-validation-01M4DNDN`
- **Origin flow:** `specify`
- **Slot key:** `specify.scope.user-admin`
- **Input key:** `user_admin_routes`
- **Status:** `resolved`
- **Created:** `2026-10-08T11:49:40.787199+00:00`
- **Resolved:** `2026-10-08T11:49:50.817744+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Faut-il publier dans cette mission des routes de gestion des utilisateurs et de leurs rôles ?

## Options

- Oui, routes minimales ajoutées au contrat (utilisateurs, attribution et retrait de rôle), journalisées, plus un amorçage du premier administrateur
- Non, seulement la base et un script d'amorçage
- Other

## Final answer

Oui : routes minimales ajoutées à openapi.yaml (créer, lister, consulter, désactiver un utilisateur ; attribuer, retirer un rôle), chaque action journalisée dans audit_log ; amorçage du premier PLATFORM_ADMIN par une commande d'exploitation. Raison : sans elles aucun rôle ne peut être donné ; §10.4 demande d'ajouter les routes back-office au contrat. (décidé par l'agent, délégation du porteur du projet)

## Rationale

_(none)_

## Change log

- `2026-10-08T11:49:40.787199+00:00` — opened
- `2026-10-08T11:49:50.817744+00:00` — resolved (final_answer="Oui : routes minimales ajoutées à openapi.yaml (créer, lister, consulter, désactiver un utilisateur ; attribuer, retirer un rôle), chaque action journalisée dans audit_log ; amorçage du premier PLATFORM_ADMIN par une commande d'exploitation. Raison : sans elles aucun rôle ne peut être donné ; §10.4 demande d'ajouter les routes back-office au contrat. (décidé par l'agent, délégation du porteur du projet)")
