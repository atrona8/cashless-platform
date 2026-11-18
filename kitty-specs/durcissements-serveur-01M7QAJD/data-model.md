# Data Model: Durcissements serveur hérités

Aucune table métier nouvelle, sauf `device_app_attest_key` (si décision 3). Les changements portent sur les droits,
les contraintes et les fonctions.

## Droits de `cashless_app` (avant → après)

| Objet | Avant | Après | Point |
|---|---|---|---|
| `media_batch` | `INSERT`, `UPDATE` toutes colonnes | aucun `INSERT` ni `UPDATE` | OP-N60 |
| `media` | `UPDATE (status, claim_code_used_at, claim_attempts)` | `UPDATE (claim_code_used_at, claim_attempts)` | OP-N60 |
| `refund_request` | `INSERT` toutes colonnes | `INSERT` sur les 16 colonnes écrites par l'API | OP-N145 |
| `begin_vendor_pin_check`, `open_vendor_session` | `EXECUTE` | aucun (`EXECUTE` à `cashless_pin` seul) | OP-N76 |
| `refund_deposit_for_session(uuid, uuid)` | `EXECUTE` | fonction retirée | OP-N145 |
| `create_media_batch`, `update_media_batch` | — | `EXECUTE` (fonctions `DEFINER`) | OP-N60 |
| `advance_app_attest_counter` | — | `EXECUTE` (fonction `DEFINER`), **si décision 3** | OP-N64 |

Liste figée dans `tests_execute_grants.sql` ; droits de table et de colonne figés dans les tests de droits existants.

## Rôle nouveau

- **`cashless_pin`** : connexion du processus `vendor-pin` ; `EXECUTE` de `begin_vendor_pin_check` et
  `open_vendor_session` ; droits nécessaires au hachage d'un PIN à la création et au changement (à établir à
  l'implémentation, aucune table lue en entier) ; aucune autre table.

## Contraintes

- `vendor_session` : `UNIQUE (id, vendor_id)`.
- `sale_attribution` : `FOREIGN KEY (vendor_session_id, vendor_id) REFERENCES vendor_session (id, vendor_id)`.
- `refund_request` : déclencheur `BEFORE INSERT` (session `cashless_app`) : état initial, colonnes de transition nulles.
- Si décision 1 : `refund_request.iban` et `payout.iban` : `CHECK (iban IS NULL OR iban LIKE 'enc:v1:%') NOT VALID`.

## Fonctions

| Fonction | Sécurité | Règle |
|---|---|---|
| `create_media_batch(...)` | `DEFINER` | naît `ORDERED` ; organisateur et événement du prestataire de session ; historique avec auteur |
| `update_media_batch(batch, changes jsonb, actor)` | `DEFINER` | six colonnes permises ; lot `ORDERED` ; `quantity` refusée après émission des codes |
| `set_media_batch_status`, `issue_claim_codes` | `INVOKER` → `DEFINER` | corps identique |
| `media_set_status` | `INVOKER` → `DEFINER` | corps identique ; `p_to` limité à `SUSPENDED`, `BLACKLISTED` |
| `register_edge_gateway(...)` | `DEFINER` | rend `(gateway_id, ledger_id)` ; refus si 0 ou plusieurs grands livres |
| `enroll_device(...)` (nouvelle version) | `DEFINER` | garde la clé App Attest si fournie (si décision 3) |
| `advance_app_attest_counter(device, key_id, counter)` | `DEFINER` | mise à jour seulement si `counter` croît ; sinon refus (si décision 3) |

## Table nouvelle (si décision 3)

**`device_app_attest_key`** : `device_id` (clé), `operator_id`, `key_id` (bytea, unique), `public_key` (SPKI),
`counter` (bigint ≥ 0), `created_at`, `updated_at` ; RLS forcée par prestataire ; aucun droit de table pour
`cashless_app`.

## Valeurs chiffrées (si décision 1)

`enc:v1:<kid>:<base64url(iv12 ‖ chiffré ‖ tag16)>` ; données associées `CASHLESS/IBAN/v1|<operator_id>` ; payload
d'approbation : `iban` chiffré et `iban_mask` à côté.

## Audit

`PAYOUT_CONFIRM_REPLAYED` (nouvelle action, texte libre en base, union TypeScript `AuditAction`).
