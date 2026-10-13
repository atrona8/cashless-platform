# Contrat — Routes ajoutées à `packages/contracts/openapi.yaml`

Conventions du contrat (problem+json RFC 9457, `X-Request-Id`, `Accept-Language` FR/EN, pagination par curseur
`cursor`/`limit`, `Idempotency-Key` obligatoire sur toute écriture). Sécurité : `humanBearer`. Préfixes de clé :
`bo:` (routes d'un prestataire), `plt:` (routes de plateforme). Un `operator_id` ou un `approved_by` reçu dans un
corps est ignoré. Les opérations à deux répondent `202 Accepted` avec une `ApprovalRequest` `PENDING` (mission 2).
Tags : `Plateforme`, `Organisation`, `Événements`, `Configuration`.

## Plateforme (rôle de base `cashless_platform`, `PLATFORM_ADMIN` seul)

| Méthode et chemin | operationId | Réponses |
|---|---|---|
| `GET /jurisdiction-profiles` | `listJurisdictionProfiles` | `200` page de `JurisdictionProfile` (aussi lisible par `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, par le rôle applicatif) |
| `POST /jurisdiction-profiles` | `createJurisdictionProfile` | `201` ; `409` si (pays, version 1) existe |
| `GET /jurisdiction-profiles/{profile_id}` | `getJurisdictionProfile` | `200` (avec `provisional_fields`) |
| `POST /jurisdiction-profiles/{profile_id}/versions` | `createJurisdictionProfileVersion` | `201` ; `202` si un plafond réglementaire change (`JURISDICTION_LIMITS_CHANGE`) |
| `GET /operators` · `POST /operators` | `listOperators` · `createOperator` | `200` · `201` |
| `GET /operators/{operator_id}` · `PATCH /operators/{operator_id}` | `getOperator` · `updateOperator` | `200` (données descriptives seules) |
| `GET /operators/{operator_id}/platform-contracts` · `POST …` | `listPlatformContracts` · `createPlatformContract` | `200` · `201` (version 1) |
| `POST /operators/{operator_id}/platform-contracts/{contract_id}/versions` | `createPlatformContractVersion` | `202` (`PLATFORM_CONTRACT_VERSION`) |
| `GET /platform/config-versions` · `POST …` | `listPlatformConfigVersions` · `createPlatformConfigVersion` | `200` · `201` |
| `GET /operators/{operator_id}/platform-fee-rules` · `POST …` | `listPlatformFeeRules` · `createPlatformFeeRule` | `200` · `201` (portée `PLATFORM_CONTRACT`) |

## Organisation d'un prestataire (rôle `cashless_app`, préfixe `/operators/{operator_id}`)

| Méthode et chemin | operationId | Rôles | Réponses |
|---|---|---|---|
| `GET/POST …/config-versions` | `listOperatorConfigVersions` / `createOperatorConfigVersion` | `OPERATOR_ADMIN` | `200` / `201` |
| `GET/POST …/organizers` | `listOrganizers` / `createOrganizer` | `OPERATOR_ADMIN` (lecture : + `ORGANIZER_ADMIN` sur le sien) | `200` / `201` |
| `GET/PATCH …/organizers/{organizer_id}` | `getOrganizer` / `updateOrganizer` | idem | `200` |
| `GET/POST …/organizers/{organizer_id}/config-versions` | `listOrganizerConfigVersions` / `createOrganizerConfigVersion` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` (clés permises) | `200` / `201` |
| `GET/POST …/organizers/{organizer_id}/contracts` | `listOrganizerContracts` / `createOrganizerContract` | `OPERATOR_ADMIN` (lecture : + `ORGANIZER_ADMIN`) | `200` / `201` (version 1) |
| `POST …/contracts/{contract_id}/versions` | `createOrganizerContractVersion` | `OPERATOR_ADMIN` | `202` (`CONTRACT_VERSION`) |
| `GET/POST …/merchants` | `listMerchants` / `createMerchant` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | `200` / `201` |
| `GET/PATCH …/merchants/{merchant_id}` | `getMerchant` / `updateMerchant` | idem (+ `MERCHANT_ADMIN` en lecture du sien) | `200` |

## Événements (rôle `cashless_app`, préfixe `/operators/{operator_id}`)

| Méthode et chemin | operationId | Rôles | Réponses |
|---|---|---|---|
| `GET/POST …/events` | `listEvents` / `createEvent` | `ORGANIZER_ADMIN` (sur l'organisateur), `OPERATOR_ADMIN` | `200` / `201` (événement `DRAFT`, `ledger_id`) |
| `GET …/events/{event_id}` | `getEvent` | + `SUPERVISOR` de l'événement | `200` |
| `PATCH …/events/{event_id}` | `updateEvent` | rôle de chaque clé (catalogue) | `200` ; `202` si `LIVE` ; `403` clé d'un autre rôle ; `422` borne (message qui cite la règle) ; clé `status` refusée |
| `GET …/events/{event_id}/config?at=` | `getResolvedEventConfig` | lecture de l'événement | `200` `ResolvedConfig` (valeur, niveau, version, provisoire) |
| `GET …/events/{event_id}/status-conditions?to=` | `getEventStatusConditions` | lecture de l'événement | `200` liste de `StatusCondition` |
| `POST …/events/{event_id}/status-transitions` | `transitionEventStatus` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | `200` (statut) ; `202` pour `LIVE` ; `409 EVENT_TRANSITION_INVALID` / `CLOSING_CONDITION_NOT_MET` |
| `GET/POST …/events/{event_id}/participations` | `listParticipations` / `createParticipation` | `ORGANIZER_ADMIN` | `200` / `201` ; `409` commerçant déjà inscrit |
| `GET/PATCH …/participations/{participation_id}` | `getParticipation` / `updateParticipation` | idem (+ `MERCHANT_ADMIN` en lecture) | `200` ; `202` si événement `LIVE` |
| `GET/POST …/participations/{participation_id}/points-of-sale` | `listPointsOfSale` / `createPointOfSale` | `ORGANIZER_ADMIN` | `200` / `201` |
| `GET/PATCH …/points-of-sale/{pos_id}` | `getPointOfSale` / `renamePointOfSale` | idem | `200` |
| `GET/POST …/fee-rules` | `listFeeRules` / `createFeeRule` | rôle de la portée (`OPERATOR_CONTRACT` : `OPERATOR_ADMIN` ; `EVENT`, `PARTICIPATION` : `ORGANIZER_ADMIN`) | `200` / `201` ; `202` si l'événement visé est `LIVE` |
| `POST …/fee-rules/{fee_rule_id}/replacements` | `replaceFeeRule` | idem | `201` ; `202` si `LIVE` |

## Schémas ajoutés

`JurisdictionProfile`, `JurisdictionProfileCreate`, `Operator`, `OperatorCreate`, `Organizer`, `Merchant`,
`PartyCreate`, `PartyUpdate`, `Contract`, `PlatformContractCreate`, `OrganizerContractCreate`, `ContractVersionCreate`,
`ConfigVersion`, `ConfigVersionCreate`, `ResolvedConfigView` (`{ key: { value, level, version, config_version_id,
provisional } }`), `Event`, `EventCreate`, `EventUpdate`, `StatusCondition` (`code`, `met` (booléen ou null),
`detail`, `source` : `DATABASE` | `CONFIGURATION` | `EXTERNAL`, `owner_mission`), `StatusTransition` (`to`),
`Participation`, `ParticipationCreate`, `ParticipationUpdate`, `PointOfSale`, `PointOfSaleCreate`, `FeeRule`,
`FeeRuleCreate`. `ApprovalAction` étendue des huit actions de `research.md` R-09. Aucun code ajouté à
`ProblemCode` (`VALIDATION_FAILED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT_STATE`, `EVENT_TRANSITION_INVALID`,
`CLOSING_CONDITION_NOT_MET`, `APPROVAL_*` existent).
