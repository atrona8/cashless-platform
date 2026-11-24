# Interfaces communes — mission 11b (routes serveur du back-office)

Ce fichier fait foi, pour les noms, signatures, propriétaires et codes, sur tout prompt de lot, `research.md`,
`data-model.md` et `contracts/backoffice-routes.md`. Un manque ou une contradiction se signale dans la note de lane,
jamais tranché en silence. Décisions du porteur : `research.md` D1 à D10 (toutes validées le 24/11/2026).

## 1. Carte des propriétaires (aucun fichier partagé entre lots)

| Fichier ou dossier | Lot |
|---|---|
| `packages/ledger-sql/migrations/0101_anomaly_classification_phone_models.sql`, `packages/ledger-sql/tests/tests_backoffice_writes.sql` | WP01 |
| `packages/ledger-sql/migrations/0102_backoffice_read_views.sql`, `packages/ledger-sql/tests/tests_backoffice_read_views.sql` | WP02 |
| `packages/contracts/openapi.yaml`, `packages/contracts/generated/**`, `packages/contracts/dart/lib/**`, `tools/contract-stability/contract-baseline.json`, `apps/api/test/unit/contracts/contract-additions-9b.spec.ts` | WP03 (WP04 y retouche ensuite, hors carte, même lane) |
| `tools/contract-stability/x-roles/**` | WP04 |
| `apps/api/src/audit/audit.service.ts`, `apps/api/src/staff-profile/**`, `apps/api/src/identity/identity.module.ts`, `apps/api/test/integration/backoffice/staff-profile.spec.ts`, `apps/api/test/integration/end-to-end/backoffice-isolation.spec.ts`, `apps/api/test/integration/end-to-end/backoffice-isolation-cases/registry.ts`, `apps/api/test/integration/end-to-end/backoffice-isolation-cases/staff-profile.cases.ts`, `apps/api/test/support/mission-11b-operations.ts`, `apps/api/test/integration/end-to-end/media-isolation.spec.ts` | WP05 |
| `apps/api/src/sales/**`, `apps/api/src/payments/payments.module.ts`, `apps/api/test/integration/backoffice/sales*.spec.ts`, `…/backoffice-isolation-cases/sales.cases.ts` | WP06 |
| `apps/api/src/anomalies/**`, `apps/api/src/app.module.ts`, `apps/api/test/integration/backoffice/anomalies*.spec.ts`, `…/backoffice-isolation-cases/anomalies.cases.ts` | WP07 |
| `apps/api/src/search/**`, `apps/api/src/media/media-public.module.ts`, `apps/api/test/integration/backoffice/search*.spec.ts`, `…/backoffice-isolation-cases/search.cases.ts` | WP08 |
| `apps/api/src/devices/phone-models/**`, `apps/api/src/devices/devices.module.ts`, `apps/api/src/devices/enrollment/enrollment.{dto,service}.ts`, `apps/api/src/devices/heartbeat/heartbeat.{dto,controller}.ts`, `apps/api/src/devices/admin/device-admin.{dto,service}.ts`, `apps/api/test/integration/backoffice/phone-models*.spec.ts`, `…/backoffice-isolation-cases/phone-models.cases.ts` | WP09 |
| `apps/api/test/integration/end-to-end/x-roles-matrix.spec.ts`, `apps/api/test/integration/end-to-end/x-roles-cases/**` | WP10 |
| `docs/SPECIFICATION.md`, `docs/DECISIONS_ADR.md`, `docs/POINTS_OUVERTS.md`, `PRD.md`, `PROMPTS-A-ENVOYER.md`, `docs/passation-11b/preuves.md`, `docs/passation-11b/note-equipes.md` | WP11 |

Les modules s'inscrivent chacun dans un module existant que leur lot est seul à toucher : `StaffProfileModule` dans
`IdentityModule` (WP05), `SalesModule` dans `PaymentsModule` (WP06), `AnomaliesModule` dans `AppModule` (WP07),
`SearchModule` dans `MediaPublicModule` (WP08), `PhoneModelsModule` dans `DevicesModule` (WP09).

## 2. Base de données

### WP01 — migration `0101_anomaly_classification_phone_models.sql`

```sql
ALTER TABLE anomaly
  ADD COLUMN classified_by uuid REFERENCES app_user(id),
  ADD COLUMN classified_at timestamptz,
  ADD COLUMN classification_reason text;
-- CHECK : les trois colonnes sont toutes nulles ou toutes non nulles ; reason de 1 à 500 caractères ;
-- classified_by non nul ⇒ status = 'RESOLVED' AND resolution_tx_id IS NULL
--   AND kind IN (10 types de research D1).

CREATE FUNCTION anomaly_classifiable(p_kind text) RETURNS boolean IMMUTABLE;   -- vrai pour les 10 types de D1

CREATE FUNCTION classify_anomaly(p_anomaly uuid, p_reason text, p_actor uuid)
  RETURNS anomaly  -- la ligne après classement
  SECURITY DEFINER SET search_path = public, pg_temp;  -- pg_temp en dernier, exigé par tests_definer_search_path.sql
-- Sous la RLS de l'appelant (operator_id = app.operator_id). SELECT … FOR UPDATE.
-- Erreurs : CL066 introuvable ou autre prestataire → 404 ; CL067 type non classable → 422
--   (reason ANOMALY_KIND_NOT_CLASSIFIABLE) ; CL068 statut ≠ OPEN → 409 CONFLICT_STATE ;
--   CL069 motif vide ou > 500 → 422 VALIDATION_FAILED. N'écrit RIEN au grand livre.
-- EXECUTE : cashless_app seulement (REVOKE de PUBLIC).

-- D4 (renforcement) : si aucun code de l'API ne fait UPDATE anomaly en direct (à prouver par grep dans la note de
-- lane), REVOKE UPDATE (status, resolution_tx_id) ON anomaly FROM cashless_app ; sinon déclencheur
-- anomaly_resolve_guard qui refuse OPEN → RESOLVED sans resolution_tx_id hors des fonctions habilitées.

CREATE TABLE phone_model (
  manufacturer text NOT NULL, model text NOT NULL,          -- normalisés : lower(btrim), espaces réduits
  nfc_level text NOT NULL CHECK (nfc_level IN ('RECOMMENDED','TOLERATED')),
  measured_at date NOT NULL, updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (manufacturer, model));
-- SELECT à cashless_app ; écriture par upsert_phone_model / delete_phone_model, EXECUTE au rôle de plateforme seul.
CREATE FUNCTION normalize_phone_model(p text) RETURNS text IMMUTABLE;
CREATE FUNCTION upsert_phone_model(p_manufacturer text, p_model text, p_level text, p_measured date, p_actor uuid)
  RETURNS phone_model;
CREATE FUNCTION delete_phone_model(p_manufacturer text, p_model text, p_actor uuid) RETURNS boolean;

ALTER TABLE device ADD COLUMN manufacturer text, ADD COLUMN model text;  -- 1 à 100 caractères, normalisés
-- Écriture par les chemins d'enrôlement et de signal de vie EXISTANTS : nouvelle version des fonctions SQL s'ils
-- passent par une fonction ; s'ils écrivent par un droit de colonne, NE PAS élargir ce droit : fonction
-- set_device_model(p_device uuid, p_manufacturer text, p_model text) SECURITY DEFINER, EXECUTE à cashless_app.
-- RETENU PAR WP01 (24/11/2026) : set_device_model(...) RETURNS void, appelé par WP09 dans la même transaction, après
-- l'enrôlement et après le signal de vie ; NULL/NULL sans effet, un NULL n'efface pas la valeur connue ; erreurs CL001
-- (valeur invalide), P0002 (terminal introuvable ou d'un autre prestataire), 42501 (terminal révoqué). Les signatures
-- d'enroll_device et de record_device_heartbeat restent inchangées.
-- Droits posés dans post-roles.sql § 15 (rejoué après roles.sql par migrate.ts), pas dans la migration.
-- cashless_platform n'a PAS de SELECT sur phone_model : la liste se lit par le pool applicatif (WP09).

-- Index pour la limite de débit (D8), si absent : audit_log (actor_id, action, occurred_at).
```

### WP02 — migration `0102_backoffice_read_views.sql`

- Vue `sale_overview` (`security_invoker = true`) : une ligne par `journal_transaction` `type = 'PURCHASE'` :
  `transaction_id, operator_id, ledger_id, event_id, occurred_at, amount, currency, pos_id, merchant_id,
  participation_id, vendor_id, device_id, source, channel, reversal_transaction_id`. `merchant_id` et
  `participation_id` par le compte `MERCHANT` crédité (même jointure que `payment-read.service.ts` l. 63-80). `pos_id`
  par `device.pos_id`, à défaut `sale_line.pos_id` (première ligne).
- Vue `anomaly_overview` (`security_invoker = true`) : colonnes d'`anomaly` + `event_id` (par le grand livre) +
  `currency` + `classifiable` (`anomaly_classifiable(kind)`).
- Index nécessaires à NFR-001 (200 000 ventes, p95 < 500 ms), décidés par mesure et notés dans la note de lane.
- Aucun droit nouveau : `SELECT` sur les vues à `cashless_app` (les tables sous-jacentes sont déjà lisibles).

## 3. Contrat (WP03, WP04)

Opérations, toutes avec `x-process: public` et la sécurité du personnel (jeton OIDC) :

| operationId | Méthode et chemin | Rôles (`x-roles`) |
|---|---|---|
| `getStaffProfile` | `GET /staff/me` | tous les rôles du personnel |
| `listEventSales` | `GET /events/{event_id}/sales` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `MERCHANT_ADMIN` |
| `getSale` | `GET /sales/{transaction_id}` | idem |
| `listAnomalies` | `GET /anomalies` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` |
| `classifyAnomaly` | `POST /anomalies/{anomaly_id}/classification` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` |
| `searchMedia` | `GET /search/media` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER`, `MERCHANT_ADMIN` |
| `getWalletOverview` | `GET /search/wallets/{wallet_id}` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER` |
| `searchCustomerByPhone` | `POST /search/customers` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR` (pas `PLATFORM_ADMIN` : renforcement du 24/11/2026, une recherche sans prestataire porterait sur tous les prestataires) |
| `listPhoneModels` | `GET /phone-models` | `PLATFORM_ADMIN`, `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` |
| `upsertPhoneModel` | `PUT /phone-models/{manufacturer}/{model}` | `PLATFORM_ADMIN` |
| `deletePhoneModel` | `DELETE /phone-models/{manufacturer}/{model}` | `PLATFORM_ADMIN` |

Schémas : `StaffProfile`, `StaffAssignment`, `SalePage`, `SaleSummary`, `SaleDetail`, `SaleLine`, `AnomalyPage`,
`Anomaly`, `AnomalyClassificationCreate`, `MediaSearchResult`, `WalletOverview`, `CustomerSearchRequest`,
`CustomerSearchResult`, `PhoneModel`, `PhoneModelPage`, `PhoneModelUpsert`, `DeviceModel`, `NfcLevel`. Champs :
`contracts/backoffice-routes.md`. Ajouts facultatifs : `device_model` sur `DeviceEnrollmentRequest`,
`HeartbeatRequest`, `DeviceAdminDetail`, élément de `DevicePage` ; `nfc_level` sur les deux derniers.

`x-roles` (WP04) : tableau sur **chaque** opération, valeurs parmi `PLATFORM_ADMIN`, `OPERATOR_ADMIN`,
`ORGANIZER_ADMIN`, `MERCHANT_ADMIN`, `SUPERVISOR`, `CASHIER`, `PERSONALIZER`, `VENDOR`, `CUSTOMER`, `DEVICE`,
`GATEWAY`, `PUBLIC`. Source relue : `tools/contract-stability/x-roles/roles.json` (`operationId` → rôles, avec
`source` = fichier:ligne du contrôle). Entrées de référence produites par `tools/contract-stability/x-roles/apply.mjs`.

Codes : aucun nouveau (D10). `reason` `ANOMALY_KIND_NOT_CLASSIFIABLE` dans le détail d'un `422 VALIDATION_FAILED`.

## 4. API

```ts
// apps/api/src/audit/audit.service.ts (WP05) — ajoutés à AuditAction :
'ANOMALY_CLASSIFIED' | 'PHONE_MODEL_UPSERTED' | 'PHONE_MODEL_DELETED'
  | 'STAFF_CUSTOMER_SEARCH' | 'STAFF_CUSTOMER_SEARCH_RATE_LIMITED'

// Pagination (WP06, WP07, WP09) : curseur opaque au format de `users.dto.ts` `encodeCursor` / `decodeCursor` (réutilisé ou imité, sans modifier ce fichier) ;
// limit entier 1..200, défaut 50 ; curseur invalide → 422 VALIDATION_FAILED.

// Masque de numéro (WP08) : maskPhone('+221771234512') === '+221 77 *** ** 12' (indicatif, 2 chiffres, 3 étoiles,
// 2 étoiles, 2 derniers chiffres ; pour un autre format : indicatif + étoiles + 2 derniers chiffres).

// Limite de débit (WP08) : 20 STAFF_CUSTOMER_SEARCH par actor_id sur 60 s glissantes, comptées en base ; au-delà,
// ligne STAFF_CUSTOMER_SEARCH_RATE_LIMITED puis 429 RATE_LIMITED, Retry-After en secondes.
// Réglage : variable d'environnement STAFF_PHONE_SEARCH_PER_MINUTE (défaut 20).

// Niveau NFC (WP09) : nfcLevelFor(manufacturer?: string|null, model?: string|null): 'RECOMMENDED'|'TOLERATED'|'UNTESTED'
```

Portée : tout filtre de portée dans la requête SQL (jamais après lecture), à partir de `principal.assignments` et de
`exercisedRole` / `scope-resolver.ts`. Hors portée ou autre prestataire : `404 NOT_FOUND` ou liste vide, sans indice.

## 5. Balayage d'isolement de la mission (WP05, puis chaque lot de routes)

- `apps/api/test/support/mission-11b-operations.ts` : `export const MISSION_11B_OPERATIONS: readonly string[]` (les 11
  `operationId` ci-dessus). `media-isolation.spec.ts` les exclut (comme `MISSION_9B_OPERATIONS`), parce que
  `backoffice-isolation.spec.ts` les couvre.
- `backoffice-isolation.spec.ts` : pour chaque opération de `MISSION_11B_OPERATIONS`, appelle les cas du registre
  `backoffice-isolation-cases/registry.ts` (lecture des fichiers `*.cases.ts` du dossier, comme
  `device-auth-cases/registry.ts`) : personnel d'un autre prestataire → 403 ou 404, jamais 2xx, aucune donnée de A ;
  sans jeton → 401 ; jeton festivalier → refus ; jeton terminal → refus. **Une opération SERVIE par l'application (route
  inscrite dans Nest) sans cas fait échouer le test** ; une opération pas encore servie (lot non fusionné) est sautée
  et nommée dans la sortie. Aucune liste d'attente partagée : `registry.ts` n'est modifié par aucun autre lot que WP05.
  WP10 vérifie que les 11 opérations sont toutes servies et ont toutes leur cas.
- Forme d'un cas : `export const cases: BackofficeIsolationCase[]` avec `{ operationId, method, path(fx), body?(fx) }`.

## 6. Matrice `x-roles` (WP10)

Pour chaque opération du contrat : un appel avec un rôle déclaré, dans la bonne portée → **jamais 403 pour droit** ;
un appel avec un rôle non déclaré, même portée → **403** (ou refus d'authentification pour un appelant d'une autre
nature). Préparation des appels par fichiers `x-roles-cases/<domaine>.cases.ts` ; une opération sans cas fait échouer
le test. Lancement seul, en série (`SKIP_LATENCY` l'écarte de la passe parallèle).
