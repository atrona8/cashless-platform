# Data Model — Configuration, parties et événements

Tables existantes du schéma de référence réutilisées telles quelles : `party`, `jurisdiction_profile`, `event`,
`contract`, `config_version`, `merchant_participation`, `point_of_sale`, `fee_rule`, `ledger`, `account`,
`event_status_transition`, `event_status_history`, `set_event_status`, `approval_request`, `audit_log`,
`api_idempotency`. Ci-dessous : ce que les migrations `0007` à `0009` ajoutent ou durcissent, et les invariants.
Toute contrainte nouvelle a son test pgTAP (`packages/ledger-sql/tests/tests_configuration.sql`,
`tests_event_ledger.sql`, `tests_platform_scope.sql`).

## Migration 0007 — Intégrité de la configuration (`0007_configuration.sql`)

### `event` (colonnes ajoutées)

| Colonne | Type | Règle |
|---|---|---|
| `issuer` | `text NOT NULL DEFAULT 'ORGANIZER'` | `CHECK (issuer IN ('ORGANIZER','OPERATOR'))` (§4.2) |
| `funds_holder_party_id` | `uuid REFERENCES party(id)` | `CHECK ((funds_holder = 'THIRD_PARTY') = (funds_holder_party_id IS NOT NULL))` ; la partie est de type `THIRD_PARTY` et du même prestataire (déclencheur) |
| `jurisdiction_id`, `contract_id` | existantes | `contract_id` : contrat `OPERATOR_ORGANIZER` du même organisateur et du même prestataire (déclencheur `event_references_guard`) |

Déclencheur `event_jurisdiction_bounds` (BEFORE INSERT OR UPDATE) : `refund_deadline` NULL ou ≥ `ends_at` +
`min_refund_window_days` du profil ; `ends_at ≥ starts_at` ; `currency` dans la liste des devises connues
(`XOF`, `XAF`, `EUR`, `USD`, extensible par la table `currency_exponent`, ajoutée ici : `code char(3) PRIMARY KEY,
exponent smallint`). Erreur : `CL001`.

Déclencheur `event_status_guard` existant : inchangé (statut seulement par `set_event_status`).

### `merchant_participation` (colonnes ajoutées)

| Colonne | Type | Règle |
|---|---|---|
| `pitch_fee` | `bigint NOT NULL DEFAULT 0` | `CHECK (pitch_fee >= 0)` (unités mineures) |
| `pitch_fee_reference` | `text` | `CHECK (pitch_fee_mode <> 'PREPAID' OR pitch_fee = 0 OR pitch_fee_reference IS NOT NULL)` |
| `payout_to` | existante | Déclencheur : `INTERNAL` ⇒ organisateur de l'événement ; `EXTERNAL` ⇒ le commerçant |

Le commerçant (`merchant_id`) est une partie `MERCHANT` du même prestataire ; l'événement n'est pas `CLOSED`
(déclencheur `participation_guard`, `CL001`).

### Immuabilité (versionnement)

| Table | Règle (déclencheur, pour tout rôle) |
|---|---|
| `contract` | Aucun `UPDATE` ni `DELETE` ; `UNIQUE (operator_id, kind, counterparty_id, version)` ; nouvelle version = `version` précédente + 1 et `valid_from` ≥ celle de la précédente |
| `config_version` | Aucun `UPDATE` ni `DELETE` ; nouvelle version = précédente + 1 |
| `jurisdiction_profile` | Aucun `UPDATE` ni `DELETE` |
| `fee_rule` | Aucun `DELETE` ; seul `valid_to` peut passer de NULL à une date ≥ `valid_from` ; `UNIQUE` de (portée, payeur, bénéficiaire, assiette, version) ; `rate_bps` 0 à 10 000, montants ≥ 0, `min ≤ max` |
| `point_of_sale` | `participation_id` et `operator_id` immuables (seul `name` change) |

### Cohérence `fee_rule`

`scope_type` → objet visé : `PLATFORM_CONTRACT` / `OPERATOR_CONTRACT` → `contract` du bon type ;
`EVENT` → `event` ; `PARTICIPATION` → `merchant_participation`, du même prestataire que la règle. `tax_code` NULL ou
clé de `rules.taxes` du profil de législation de la portée (contrôlé par l'API, R-06).

## Migration 0008 — Grand livre d'événement (`0008_event_ledger.sql`)

### `open_event_ledger(p_event uuid) RETURNS uuid` — `SECURITY INVOKER`

1. `event` visible (sinon `no_data_found`) et sans grand livre `EVENT` existant (sinon `CL001`).
2. Titulaire des fonds : organisateur, prestataire ou `funds_holder_party_id` ; émetteur : organisateur ou
   prestataire ; partie plateforme : l'unique `party` `PLATFORM`.
3. `INSERT INTO ledger (scope_type 'EVENT', scope_id, currency, issuer_id, funds_holder_id, operator_id)`.
4. Comptes fixes (research R-04), codes et attributs du tableau §5.2 ; `L-LEGAL-CASSE` si
   `breakage_destination = 'LEGAL_ACCOUNT'`.
5. Rend l'identifiant du grand livre.

### `open_participation_account(p_participation uuid) RETURNS uuid` — `SECURITY INVOKER`

Compte `L-MCH-<participation_id>` (`CLAIM`, `MERCHANT`, titulaire = commerçant, `participation_id`, sens C) dans le
grand livre de l'événement ; chaud et négatif permis posés par `account_merchant_hot`. Idempotente : rend le compte
existant.

### `event_transition_conditions(p_event uuid, p_to event_status)` — `SECURITY DEFINER`, `STABLE`

`RETURNS TABLE (code text, met boolean, detail text, source text)` ; `assert_tenant(tenant_of_event(p_event))`.
Codes : `TRANSITION_ALLOWED`, `DEBIT_AUTHORITY_CENTRAL`, `SUSPENSE_ZERO`, `PARTY_POSITIONS_ZERO`,
`PAYOUT_PENDING_ZERO`, `POSITIONS_SETTLED`, `DEVICES_CAUGHT_UP` (avant la date limite), chacun calculé comme dans
`set_event_status` (mêmes fonctions internes, lecture seule). `source = 'DATABASE'`. Les conditions de configuration
et externes sont ajoutées par l'API (R-08).

## Migration 0009 — Portée plateforme (`0009_platform_scope.sql`)

- `api_idempotency.operator_id` : `DROP NOT NULL` ; contrainte `api_idempotency_uniq` remplacée par
  `UNIQUE NULLS NOT DISTINCT (operator_id, scope, idempotency_key)`.
- `approval_request.operator_id` : `DROP NOT NULL` ; `CHECK (operator_id IS NOT NULL OR action IN
  ('PLATFORM_CONTRACT_VERSION','JURISDICTION_LIMITS_CHANGE'))` ; liste fermée `action` étendue des huit actions de R-09.
- `decide_approval_request` remplacée (même signature) : `operator_id` NULL ⇒ `platform_session()` exigée (fonction
  interne `SECURITY INVOKER` qui teste l'appartenance de `session_user` au rôle nommé par le réglage
  `app.platform_role`, défaut `cashless_platform`, sans référence statique au rôle) ; sinon `assert_tenant`.
- `post-roles.sql` : création de `cashless_platform`, droits et politiques `TO cashless_platform` (R-01), retrait
  d'`INSERT, UPDATE` sur `jurisdiction_profile` à `cashless_app`, `EXECUTE` des nouvelles fonctions accordé à
  `cashless_app` (`open_event_ledger`, `open_participation_account`, `event_transition_conditions`).

## Cascade de configuration

| Niveau (`scope_type`) | `scope_id` | `operator_id` | Écrit par | Rôle de base |
|---|---|---|---|---|
| `PLATFORM` | id de la partie plateforme | NULL | `PLATFORM_ADMIN` | `cashless_platform` |
| `OPERATOR` | prestataire | prestataire | `OPERATOR_ADMIN` | `cashless_app` |
| `ORGANIZER` | organisateur | prestataire | `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` (clés permises) | `cashless_app` |
| `EVENT` | événement | prestataire | selon la clé (catalogue) | `cashless_app` |
| `PARTICIPATION` | participation | prestataire | `ORGANIZER_ADMIN` | `cashless_app` |

Clés du catalogue (extrait ; liste complète dans `apps/api/src/configuration/settings-catalog.ts`) :

| Clé | Stockage | Niveaux | Réglée par | Bornes |
|---|---|---|---|---|
| `wallet_scope` | settings | ORGANIZER, EVENT | ORGANIZER_ADMIN | `EVENT` seul accepté dans cette mission (C-007) |
| `spend_order` | settings | PLATFORM → EVENT | ORGANIZER_ADMIN | `PROMO_FIRST`, `PAID_FIRST` |
| `psp_fee_bearer` | settings | OPERATOR → EVENT | ORGANIZER_ADMIN | `ORGANIZER`, `OPERATOR`, `CUSTOMER` |
| `refund_policy` | settings | OPERATOR → EVENT | ORGANIZER_ADMIN | borné par la législation |
| `cash_refund_single_max_cap` | settings | OPERATOR | OPERATOR_ADMIN | ≥ 0 ; plafonne `event.cash_refund_single_max` |
| `identity_mode`, `activation_modes`, `lost_media_policy` | colonnes | EVENT | ORGANIZER_ADMIN | CHECK du schéma |
| `cash_refund_single_max`, `refund_deadline`, `reversal_window_minutes` | colonnes | EVENT | ORGANIZER_ADMIN | schéma, maximum du prestataire, législation |
| `tap_replay_window_seconds`, `sync_deadline_hours`, `refund_new_number_*`, `card_*`, réglages terminaux §9.8 | colonnes | EVENT | OPERATOR_ADMIN | CHECK du schéma (§9.8) |

## Invariants

| # | Invariant | Garanti par |
|---|---|---|
| I-1 | Le statut d'un événement ne change que par `set_event_status` | Déclencheur existant ; aucune route ne l'écrit |
| I-2 | Un événement a exactement un grand livre `EVENT` dès sa création | `open_event_ledger` dans la transaction de création ; `UNIQUE (scope_type, scope_id, currency)` |
| I-3 | Une participation a son compte commerçant dès sa création | `open_participation_account` dans la même transaction |
| I-4 | Contrats, versions de configuration, profils et règles de frais ne se modifient pas | Déclencheurs d'immuabilité (0007) |
| I-5 | Aucune donnée d'un prestataire n'est visible d'un autre | RLS forcée (existante) ; politiques plateforme nominatives |
| I-6 | `cashless_app` n'écrit aucune donnée de plateforme | RLS de `party` (existante), retrait des droits sur `jurisdiction_profile`, politiques nominatives |
| I-7 | `cashless_platform` n'a aucun droit sur le grand livre | Droits de `post-roles.sql` ; pgTAP |
| I-8 | Valideur ≠ auteur pour toute demande, y compris de plateforme | `approval_request` (CHECK existant) ; `decide_approval_request` |
| I-9 | `refund_deadline ≥ ends_at + min_refund_window_days` | `BoundsValidator` (API) et `event_jurisdiction_bounds` (base) |

## Transitions d'état

Statuts d'événement : diagramme §12.1 (inchangé). Demandes d'approbation : `PENDING → APPROVED | REJECTED |
EXPIRED`, `APPROVED → EXECUTED | FAILED` (inchangé, y compris au niveau plateforme).
