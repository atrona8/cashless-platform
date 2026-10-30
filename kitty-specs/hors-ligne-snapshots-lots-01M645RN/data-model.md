# Data Model: Hors ligne : snapshots et lots

Tables existantes du schéma de référence (`S:`) complétées par migration, et tables nouvelles. **Toute table nouvelle
porte `operator_id` et `tenant_isolation` (ENABLE + FORCE)** ; aucune n'est écrite directement par `cashless_app`
(`INSERT, UPDATE, DELETE` retirés dans `post-roles.sql`, test générique) ; chaque écriture passe par une fonction
SECURITY DEFINER (`search_path = public, pg_temp`). Décisions : `research.md` (R-xx ; R-30 fait foi). Numéros de migration indicatifs : `contracts/interfaces.md` § 1 fait foi.

## offline_policy (S:747) — complétée (0043)

| Champ | Note |
|---|---|
| `scope_type` | `OPERATOR_CEILING` \| `ORGANIZER` \| `EVENT` \| `DEVICE` |
| `scope_id` | organisateur, événement, terminal du prestataire ; `operator_id` pour `OPERATOR_CEILING` (déclencheur de portée) |
| `offline_enabled`, `max_per_sale`, `max_per_media_per_device`, `max_total_per_device`, `max_snapshot_age` | nul = hérite ; montants ≥ 0 ; âge 0 à 24 h |
| `cash_topup_offline` | **`CHECK (cash_topup_offline IS NOT TRUE)`** (R-02) |
| `version` | +1 par `bump_offline_policy_version` (existant) |

Écriture : `set_offline_policy`, `clear_offline_policy`. Historique `offline_policy_history` écrit par
`log_offline_policy` devenu DEFINER (OP-N58). `cashless_app` : `SELECT` seul sur les deux tables.

## offline_snapshot (S:355) — complétée (0044)

Colonne ajoutée : `content_key_wrapped bytea NOT NULL` (clé de contenu `K_v` enveloppée par le KMS, R-08).
Inscription : `publish_offline_snapshot` seul (version = max + 1 sous verrou consultatif ; `DELTA` ⇒ `base_version` =
version précédente ; en-tête recalculé). Immuable (existant). `cashless_app` : `SELECT` seul (OP-N57).

## offline_snapshot_entry (nouvelle, 0044)

| Champ | Type | Note |
|---|---|---|
| `ledger_id`, `version` | uuid, bigint | FK `offline_snapshot (ledger_id, version)` |
| `token_hash` | bytea(32) | PK avec les deux précédents |
| `entry` | jsonb | champs de §4.1-1 sans mot de passe |
| `pwd_pack_enc` | bytea NULL | AES-256-GCM sous `K_v` (nonce ‖ chiffré ‖ tag) ; nul si retiré ou sans mot de passe |
| `removed` | boolean | vrai = `removed_token_hashes` |

`pwd_pack_sha256` (SHA-256 du chiffré) figure dans `entry` et donc dans le contenu signé (R-30.9). Contenu de chaque
artefact (tous les bracelets d'un `FULL`, changements d'un `DELTA`, rien pour une version de maintien). Purge : versions antérieures à
l'avant-dernier `FULL` (`purge_offline_snapshot_content`, producteur).

## offline_snapshot_state (nouvelle, 0044)

`(ledger_id, token_hash)` PK, `entry_sha256 bytea(32)`, `last_version bigint`, `removed boolean`. État courant par
grand livre ; sert au calcul d'un `DELTA`. Écrit par `publish_offline_snapshot` dans la même transaction.

## offline_snapshot_media_log (nouvelle, 0044)

`(ledger_id, version, token_hash)` PK, `media_status`, `batch_status`, `batch_event_id`, `wallet_status`,
`in_snapshot boolean`. Journal sans secret des changements par version (une ligne par entrée d'un artefact) ; état à la
version `s` = dernière ligne de version ≤ `s`. Conservé jusqu'à `LOCKED` + rétention de l'événement. Lu par
`offline_media_state_at(ledger, token_hash, version)` (DEFINER STABLE, accordée à `cashless_app`).

## offline_snapshot_key (nouvelle, 0044)

`(ledger_id, version, device_id, agreement_key_sha256)` PK, `operator_id`, `envelope jsonb` (`{alg, epk, iv,
wrapped_key}`), `created_at`. Écrite par `wrap_offline_snapshot_key` (rôle `cashless_snapcontent` ; terminal `ACTIVE`
de l'événement, clé d'accord courante, version conservée). Lue par `offline_snapshot_for_device(device,
since_version)` (DEFINER STABLE) qui rend en-tête, signature, entrées et l'enveloppe du seul terminal appelant pour sa
clé d'accord courante ; terminal `SUSPENDED`, `REVOKED` ou hors ligne interdit → refus.

## offline_snapshot_draft (nouvelle, 0044)

`id`, `operator_id`, `ledger_id`, `kind`, `base_version`, `version` (réservée), en-tête complet sauf signature,
`content_key_wrapped`, `status` (`READY` → `PUBLISHED` | `DISCARDED`), `created_at`. Écrit par `snapshot-content`
(`save_offline_snapshot_draft`), lu et publié par `snapshot-signer` (`publish_offline_snapshot(draft, signature,
key_id)`), qui recalcule l'en-tête et l'empreinte depuis les entrées.

## offline_snapshot_ack (nouvelle, 0047)

`(device_id, version)` PK, `operator_id`, `ledger_id`, `acked_at` (heure de la base). Historique des accusés (R-30.4) ;
`device.last_snapshot_version` reste le maximum.

## snapshot_signing_key (S:2291) — complétée (0044)

Déclencheur : au plus deux clés `ACTIVE|RETIRED` par signataire `(owner, operator_id, edge_gateway_id)` ; rotation par
`rotate_snapshot_signing_key` (nouvelle `ACTIVE`, ancienne `RETIRED`, la plus ancienne `RETIRED` → `REVOKED`).
`cashless_app` : `SELECT` seul.

## device_seq_registry (S:1998) — inchangée

Mapping résultat API ↔ registre : `ACCEPTED` (écrit) ↔ `ACCEPTED` ; `ACCEPTED_WITH_SHORTFALL` ↔ idem ;
`DUPLICATE` ↔ résultat mémorisé (transaction d'origine) ; `ACCEPTED` sans effet (`VOID`, `ONLINE_REF` non exécuté) ↔
`VOID` ; `REJECTED` ↔ `REJECTED` + raison ; `INSUFFICIENT_FUNDS_RETRY` ↔ **aucune ligne** ; levée ↔ `WAIVED`.
Canal `BATCH` (lot), `IMPORT` ajouté (0045).

## offline_batch (S:2119) — complétée (0045)

`received_via` admet `IMPORT` ; `size_bytes int` (≤ 1 048 576, contrôle d'API reporté en base) ; `import_id uuid NULL`.
`open_offline_batch` remplacée sans retrait : borne de débordement de `seq_from + n − 1`, grand livre = celui de
l'événement du terminal. `complete_offline_batch` remplacée : numéros sans ligne admis seulement s'ils sont
`retryable` (`INSUFFICIENT_FUNDS_RETRY`) dans `p_results`.

## offline_op_result (nouvelle, 0045)

`(batch_id, seq)` PK, `operator_id`, `result jsonb` (résultat rendu de l'opération), `created_at`. Écrite dans la
transaction de chaque opération ; relue à la reprise et à la clôture (R-30.7).

## offline_batch_retry (nouvelle, 0045)

`(batch_id, seq)` PK, `operator_id`, `device_id`, `reason` (`INSUFFICIENT_FUNDS_RETRY`), `created_at`, `closed_at`.
Écrite par `record_offline_retry` dans la transaction de l'opération ; seule admise par `complete_offline_batch` pour
un numéro sans ligne de registre ; close quand le numéro reçoit un résultat final ; alerte à 24 h (porteur, R-30.11).

États : `PROCESSING` → `COMPLETED` (résultats) ; `PROCESSING` → `REJECTED` (`ABANDONED` à l'ouverture du suivant après
15 min ; `CHAIN_BROKEN` à l'ouverture).

## device_journal_import (nouvelle, 0045)

| Champ | Note |
|---|---|
| `id` uuid PK, `operator_id`, `device_id` | terminal `REVOKED` (vérifié à la création) |
| `batches` jsonb, `batches_sha256` | lots exportés tels que reçus (≤ 20 lots de 500), signatures vérifiées à la création et revérifiées à l'exécution |
| `summary` jsonb | nombre d'opérations, total des ventes, plage de numéros, opérations datées après la dernière présence serveur |
| `approval_request_id` | demande `DEVICE_JOURNAL_IMPORT` |
| `status` | `PENDING` → `PROCESSING` → `APPLIED` \| `FAILED` ; `PENDING` → `REJECTED` |
| `requested_by`, `approved_by`, `result jsonb`, `created_at`, `applied_at` | |

Écrite par `create_device_journal_import` et `begin/finish_device_journal_import` ; traitée une seule fois, avec
reprise par opération (travailleur `journal-import`).

## anomaly (S:837) — complétée (0046)

Colonnes : `loss_bearer text NULL CHECK IN ('OPERATOR','ORGANIZER','MERCHANT')`, `detail jsonb NULL`,
`batch_id uuid NULL`. Écriture : `open_offline_anomaly` (types de la mission, idempotente), `reduce_offline_shortfall`
(annulation), `mark_seq_gap_alerted` ; `INSERT` direct retiré à `cashless_app` (R-17). Partie porteuse (non conforme) :
`provided_by` `PLATFORM|OPERATOR` → `OPERATOR`, `ORGANIZER` → `ORGANIZER`, `MERCHANT` → `MERCHANT`.

## wallet_status_history (nouvelle, 0046)

`id bigserial`, `wallet_id`, `operator_id`, `from_status`, `to_status`, `at timestamptz` (heure de la base). Écrite par
déclencheur `AFTER UPDATE OF status ON wallet` (DEFINER) ; ligne de départ à la migration pour les portefeuilles
`BLOCKED|CLOSED`. Sert à `t_blocage` (§7.3, inconnu → bloqué avant) et à la cadence 5 s.

## Fonctions du terminal et du vendeur (0047)

`ack_offline_snapshot(device, version, content_sha256)` ; `set_device_station_name(device, name, actor)` ;
`assert_vendor_session_at(device, session, at)` ; `record_sale_attribution_at(...)` (variante datée de 0033) ;
`device_status_at(device, at)` (statut à une heure, depuis `device_status_history`).

## Rôles (post-roles.sql)

| Rôle | Droits |
|---|---|
| `cashless_app` | `EXECUTE` des fonctions de la mission listées dans `contracts/database-rights.md` ; plus d'`UPDATE` sur `device`, plus d'`INSERT` sur `anomaly`, `offline_snapshot`, `offline_policy*`, `snapshot_signing_key` ; plus d'`EXECUTE` des purges |
| `cashless_snapcontent` (nouveau) | source, brouillon, enveloppes, purge du contenu ; `SELECT` de colonnes de `tag_data_key` |
| `cashless_snapsign` (nouveau) | lecture des brouillons, publication, alerte des trous et des numéros `RETRY` |
| `cashless_maint` (nouveau) | `EXECUTE` de `purge_device_request_nonces`, `purge_device_enrollment_attempts` |
| `cashless_keyadmin` (existant) | `EXECUTE` de `rotate_snapshot_signing_key` en plus |

Défaut global : `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (OP-N68).

## États et transitions clés

- Opération de lot : reçue → (registre) résultat final `ACCEPTED|ACCEPTED_WITH_SHORTFALL|DUPLICATE|REJECTED`, ou
  `REJECTED retryable` sans ligne (renvoyée plus tard).
- Trou : `SEQ_GAP OPEN` → `RESOLVED` (numéro reçu, ou levée à deux) ; alerte unique après 24 h.
- Version de snapshot : produite → servie (enveloppe) → accusée (`last_snapshot_version`, jamais en recul) → purgée
  (contenu) ; en-tête et journal conservés.
