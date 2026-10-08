# Contrat — Routes ajoutées à `packages/contracts/openapi.yaml`

Conventions du contrat (problem+json, `X-Request-Id`, `Accept-Language`, curseur, `Idempotency-Key` sur les
écritures, préfixe de clé `bo:`). Sécurité : `humanBearer`. Tag : `Personnes`.

| Méthode et chemin | operationId | Rôles | Réponses |
|---|---|---|---|
| `GET /operators/{operator_id}/users` | `listUsers` | `PLATFORM_ADMIN`, `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | `200` page de `StaffUser` |
| `POST /operators/{operator_id}/users` | `createUser` | idem | `201` `StaffUser` ; `409 CONFLICT_STATE` si (émetteur, sujet) déjà connu |
| `GET /operators/{operator_id}/users/{user_id}` | `getUser` | idem | `200` `StaffUser` (avec attributions actives) |
| `POST /operators/{operator_id}/users/{user_id}/disable` | `disableUser` | `PLATFORM_ADMIN`, `OPERATOR_ADMIN` | `200` |
| `POST /operators/{operator_id}/users/{user_id}/role-assignments` | `grantRole` | selon le rôle donné (contrat `identity.md`) | `201` `RoleAssignment` |
| `POST /operators/{operator_id}/role-assignments/{assignment_id}/revoke` | `revokeRole` | idem | `200` |
| `POST /platform-admins` | `createPlatformAdmin` | `PLATFORM_ADMIN` | `201` `StaffUser` |

Schémas : `StaffUser` (`user_id`, `operator_id`, `issuer`, `subject`, `email`, `phone`, `display_name`, `status`,
`created_at`, `disabled_at`, `role_assignments`), `StaffUserCreate` (`issuer`, `subject`, `display_name`, `email`
ou `phone`), `RoleAssignment` (`assignment_id`, `role`, `scope_type`, `scope_id`, `granted_by`, `granted_at`,
`revoked_at`), `RoleGrant` (`role`, `scope_type`, `scope_id`), énumérations `StaffRole`, `RoleScopeType`.

Codes : `FORBIDDEN` (droit insuffisant, auto-attribution, dernier `PLATFORM_ADMIN`), `NOT_FOUND`, `VALIDATION_FAILED`
(rôle et portée incompatibles), `CONFLICT_STATE` (personne déjà connue, attribution déjà active ou déjà retirée) ;
aucun code ajouté à `ProblemCode`. Description générale du contrat complétée par la formule de `act_hash`
(`contracts/approvals.md`).
