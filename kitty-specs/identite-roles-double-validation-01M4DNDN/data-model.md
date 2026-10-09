# Data Model — Identité, rôles et double validation

Toutes les tables : RLS activée et forcée, politique `tenant_isolation` sur `operator_id`, tests pgTAP par
contrainte (§14.2). Les lignes de la plateforme ont `operator_id` NULL et ne sont lisibles que par les fonctions
SECURITY DEFINER désignées.

## `app_user` (S1, migration `0003`)

| Colonne | Type | Règle |
|---|---|---|
| `id` | uuid PK | identité interne, écrite comme auteur / valideur partout |
| `operator_id` | uuid NULL REFERENCES `party(id)` | NULL = personne de la plateforme ; sinon un `party` de type `OPERATOR` |
| `issuer` | text NOT NULL | émetteur OIDC |
| `subject` | text NOT NULL | `sub` chez l'émetteur ; `UNIQUE (issuer, subject)` |
| `email` | text | au moins un de `email`, `phone` |
| `phone` | text | E.164 |
| `display_name` | text NOT NULL | |
| `status` | text NOT NULL | `ACTIVE` \| `DISABLED` ; `DISABLED` ne revient pas `ACTIVE` dans cette mission |
| `created_by` | uuid | NULL seulement pour l'amorçage |
| `created_at`, `disabled_at` | timestamptz | `disabled_at` NOT NULL ssi `DISABLED` |

Garde : `id`, `operator_id`, `issuer`, `subject`, `created_*` immuables ; aucune suppression.

## `role_assignment` (S1, migration `0003`)

| Colonne | Type | Règle |
|---|---|---|
| `id` | uuid PK | |
| `operator_id` | uuid NULL | celui de la personne |
| `user_id` | uuid NOT NULL REFERENCES `app_user` | |
| `role` | text NOT NULL | liste fermée de §3.2 |
| `scope_type` | text NOT NULL | `PLATFORM`, `OPERATOR`, `ORGANIZER`, `EVENT`, `MERCHANT` |
| `scope_id` | uuid | NULL ssi `PLATFORM` ; `party` ou `event` du même prestataire (déclencheur) |
| `granted_by` | uuid | NULL seulement pour l'amorçage ; ≠ `user_id` |
| `granted_at` | timestamptz NOT NULL | |
| `revoked_by`, `revoked_at` | | renseignés ensemble, une seule fois |

Contraintes : rôle ↔ portée compatibles (`PLATFORM_ADMIN` ↔ `PLATFORM` ; `OPERATOR_ADMIN` ↔ `OPERATOR` ;
`ORGANIZER_ADMIN` ↔ `ORGANIZER` ; `SUPERVISOR`, `CASHIER` ↔ `EVENT` ou `ORGANIZER` ; `MERCHANT_ADMIN` ↔ `MERCHANT`) ;
une seule attribution active par (personne, rôle, portée) ; pas d'auto-attribution ; retrait du dernier
`PLATFORM_ADMIN` actif refusé ; aucune suppression, aucun rétablissement.

## `identify_person(p_issuer text, p_subject text)` (migration `0003`)

SECURITY DEFINER, accordée à `cashless_app`. Rend une ligne : `user_id`, `operator_id`, `status`, `assignments`
(jsonb : `[{role, scope_type, scope_id}]` actives). Aucune ligne si inconnu.

## `audit_log` (S3, migration `0004`)

| Colonne | Type | Règle |
|---|---|---|
| `id` | bigserial PK | |
| `operator_id` | uuid NULL | NULL = plateforme |
| `chain_key` | uuid NOT NULL | `operator_id`, ou `00000000-0000-0000-0000-000000000000` pour la plateforme |
| `seq` | bigint NOT NULL | posé par le déclencheur ; `UNIQUE (chain_key, seq)`, sans trou |
| `occurred_at` | timestamptz NOT NULL | posé par le déclencheur (`clock_timestamp()`) |
| `actor_id` | uuid | personne ; NULL pour une commande d'exploitation |
| `actor_role` | text | rôle exercé |
| `action` | text NOT NULL | ex. `USER_CREATED`, `ROLE_GRANTED`, `APPROVAL_REQUESTED`, `APPROVAL_EXECUTED`, `APPROVAL_TOKEN_USED` |
| `object_type`, `object_id` | text, text | |
| `before`, `after` | jsonb | |
| `approver_id` | uuid | valideur d'une action à deux |
| `origin` | text | adresse IP ou identifiant de terminal |
| `request_id` | uuid | `X-Request-Id` |
| `prev_hash`, `row_hash` | bytea (32) NOT NULL | posés par le déclencheur |

Déclencheurs : BEFORE INSERT (chaînage sous `pg_advisory_xact_lock` de la chaîne) ; BEFORE UPDATE OR DELETE
(refus, pour tout rôle). Droits : `INSERT` et `SELECT` seulement pour `cashless_app` (`post-roles.sql`).

## `audit_seal` (migration `0004`)

`chain_key`, `seal_no` (PK avec `chain_key`), `first_seq`, `last_seq`, `rows`, `rows_sha256`, `prev_seal_hash`,
`seal_hash`, `sealed_at`, `external_ref` (une seule fois). Ajout seul (déclencheur). Aucun droit d'écriture pour
`cashless_app`. Fonctions `seal_audit(chain_key)`, `verify_audit_chain(chain_key, since)` : `EXECUTE` retiré à
`cashless_app`.

## `approval_request` (existante) — ajout `result jsonb` (migration `0005`)

NULL sauf `EXECUTED`. `UPDATE (result)` accordé au rôle applicatif par `post-roles.sql`. Transitions inchangées
(garde de la base) : `PENDING → APPROVED | REJECTED | EXPIRED` ; `APPROVED → EXECUTED | FAILED`.

## `approval_token_use` (migration `0005`)

| Colonne | Type | Règle |
|---|---|---|
| `jti` | text PK | identifiant du jeton |
| `operator_id` | uuid NOT NULL | |
| `operation_id` | text NOT NULL | `act` |
| `approver_id` | uuid NOT NULL | personne du `sub` |
| `caller_id` | uuid NOT NULL | ≠ `approver_id` |
| `used_at`, `expires_at` | timestamptz NOT NULL | |

Ajout seul (déclencheur) ; insertion = consommation.

## Registre d'actions à deux (applicatif, non persistant)

`ApprovalActionDefinition` : `action` (`ApprovalAction`), `requiredRole`, `scopeOf(payload, target)`,
`execute(client, request, approver) → { result, executedTxId? }`. Une action non enregistrée ne peut pas être
demandée (`VALIDATION_FAILED`).

## Principal (applicatif)

`{ userId, operatorId | null, assignments[], tokenId, issuer, subject }` ; posé par la garde d'authentification,
lu par `TENANT_CONTEXT`, `RolesGuard`, `AuditService`.
