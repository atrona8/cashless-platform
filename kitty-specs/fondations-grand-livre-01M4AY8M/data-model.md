# Data Model — Fondations du grand livre et de l'API

Le schéma de référence (`packages/ledger-sql/schema_grand_livre_cashless.sql`) est repris **sans modification** par
la migration `0001`. Cette mission n'ajoute qu'une table (S21) et une table technique de migrations.

## `ops.schema_migrations` (technique, schéma `ops`, hors RLS)

| Colonne | Type | Règle |
|---|---|---|
| `version` | text PK | ex. `0001_schema_reference` |
| `checksum` | text NOT NULL | SHA-256 du contenu exécuté ; une migration appliquée dont la somme change → refus |
| `applied_at` | timestamptz NOT NULL DEFAULT now() | |

Propriétaire : rôle de migration. Placée dans un schéma `ops` distinct : `roles.sql` ne donne des droits que sur
`public`, donc `cashless_app` n'a aucun droit sur `ops` (pas d'`USAGE`).

## `api_idempotency` (S21, migration `0002`)

| Colonne | Type | Règle |
|---|---|---|
| `id` | uuid PK DEFAULT `gen_random_uuid()` | |
| `operator_id` | uuid NOT NULL REFERENCES `party(id)` | RLS : politique `tenant_isolation` `USING (operator_id = current_setting('app.operator_id', true)::uuid)`, même forme que les tables du schéma |
| `scope` | text NOT NULL | préfixe client (`app:`, `bo:`, `pos:<client_id>:`) ou `device:<serial>` ; non vide |
| `idempotency_key` | text NOT NULL | 1 à 255 caractères |
| `request_hash` | text NOT NULL | 64 caractères hexadécimaux minuscules |
| `status` | text NOT NULL | `IN_PROGRESS` \| `COMPLETED` |
| `lease_until` | timestamptz | NOT NULL si `IN_PROGRESS` |
| `response_status` | smallint | NOT NULL si `COMPLETED` ; 200-599 |
| `response_body` | jsonb | |
| `response_headers` | jsonb | en-têtes rejoués (liste blanche : `Location`, `Content-Type`) |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `completed_at` | timestamptz | NOT NULL si `COMPLETED` |
| `expires_at` | timestamptz NOT NULL | > `created_at` |

Contraintes : `UNIQUE (operator_id, scope, idempotency_key)` ; `CHECK` de cohérence statut ↔ colonnes ci-dessus ;
déclencheur de garde : `request_hash`, `operator_id`, `scope`, `idempotency_key` immuables ; `COMPLETED` ne revient
pas à `IN_PROGRESS`. RLS **activée et forcée**. Aucun `DELETE` (cohérent avec `roles.sql`).

Transitions : `∅ → IN_PROGRESS → COMPLETED` ; `IN_PROGRESS` expirée → `IN_PROGRESS` (reprise : nouveau bail).

Tests pgTAP (`packages/ledger-sql/tests/tests_api_idempotency.sql`) : unicité, chaque `CHECK`, immuabilité,
interdiction du retour arrière, RLS (un autre prestataire ne voit ni ne modifie la ligne), absence de `DELETE` pour
`cashless_app`, RLS forcée (`relforcerowsecurity`).

## Objets du schéma utilisés (non modifiés)

| Objet | Usage dans la mission |
|---|---|
| `post_transaction(...)` | Seul point d'écriture appelé par le moteur |
| `take_deposit`, `refund_deposit`, `forfeit_deposit`, `refund_cash_due`, `preload_media` | Types délégués |
| `set_event_status(event, status, actor)` | Passages de statut du rejeu |
| `ledger`, `account`, `account_balance`, `journal_transaction`, `posting` | Lecture (soldes, comparaison du rejeu) |
| `party`, `event`, `jurisdiction_profile`, `contract`, `fee_rule`, `config_version`, `media_batch`, `media`, `wallet` | Fixture du scénario (rôle propriétaire) |

## Modèle applicatif (TypeScript, non persistant)

- `Money` = `bigint` (unités mineures) + devise ; `RateBps` = `bigint`.
- `LedgerCommand`, `BuildContext`, `Line` : voir [contracts/engine-command.md](contracts/engine-command.md).
- `TenantContext` : `{ operatorId: uuid }`, fourni par un port (fournisseur de test dans cette mission).
- `ProblemCode` : importé des types générés de `packages/contracts`.
