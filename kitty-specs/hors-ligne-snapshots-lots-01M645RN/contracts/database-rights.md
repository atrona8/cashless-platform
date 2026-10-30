# Contrat : droits de la base

Toute fonction de la mission : SECURITY DEFINER si elle écrit ou lit hors RLS, `SET search_path = public, pg_temp`,
`REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE` nominatif dans `post-roles.sql`, listes figées de
`tests/tests_execute_grants.sql` mises à jour. Fichiers à faire relire par une personne : `post-roles.sql`, migrations
0044, 0045, 0048, fonctions de snapshot, d'enveloppe et d'import.

## Retraits à `cashless_app` (dettes levées)

| Point | Retrait | Écriture légitime | Test de borne |
|---|---|---|---|
| OP-N57 | `INSERT, UPDATE ON offline_snapshot` | `publish_offline_snapshot` (rôle `cashless_snapsign`) | `tests_offline_rights.sql` : `INSERT` refusé, version = max + 1, concurrence |
| OP-N58 | `INSERT, UPDATE ON offline_policy_history` ; `INSERT, UPDATE, DELETE ON offline_policy` | `set_offline_policy`, `clear_offline_policy` ; `log_offline_policy` DEFINER | `tests_definer_trigger_writers.sql §3` inversé |
| OP-N68 | `ALTER DEFAULT PRIVILEGES FOR ROLE <propriétaire qui exécute migrate.ts> REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (41 suites adaptées) | `GRANT` nominatifs | `tests_execute_grants.sql §4` inversé (fonction créée à la main non exécutable) |
| OP-N69 | `UPDATE ON device` (toutes colonnes) | `record_device_heartbeat`, `ack_offline_snapshot`, `set_device_station_name`, fonctions d'enrôlement | `tests_device_rights.sql §1` : liste vide |
| OP-N75 | `EXECUTE` des deux purges | rôle `cashless_maint` | `tests_device_purge_window.sql` sous `cashless_maint` ; `tests_execute_grants.sql` |
| renforcement | `INSERT, UPDATE ON snapshot_signing_key` ; `INSERT ON anomaly` | `rotate_snapshot_signing_key` (`cashless_keyadmin`) ; `open_offline_anomaly` | `tests_offline_rights.sql` |

## `EXECUTE` accordés à `cashless_app`

`set_offline_policy`, `clear_offline_policy`, `effective_offline_policy`, `offline_max_exposure`, `policy_in_force`,
`offline_snapshot_for_device`, `ack_offline_snapshot`, `open_offline_batch`, `complete_offline_batch`,
`device_missing_seqs`, `check_seq_gap_waivable`, `waive_seq_gap`, `offline_media_state_at`, `device_status_at`,
`assert_vendor_session_at`, `record_sale_attribution_at`, `open_offline_anomaly`, `reduce_offline_shortfall`,
`record_offline_retry`, `record_offline_op_result`, `create_device_journal_import`, `begin_device_journal_import`,
`finish_device_journal_import`, `set_device_station_name`, `offline_device_exposure`, `offline_config_in_force`,
`offline_snapshot_ack_floor`. Chaque accord a un appelant nommé dans l'API ; `mark_seq_gap_alerted` et
`event_sync_deadline` ne sont pas accordés (R-30.12).

## Tables nouvelles

Toutes : `operator_id`, `tenant_isolation` forcée, `INSERT, UPDATE, DELETE` retirés à `cashless_app` ; `SELECT` retiré
aussi sur `offline_snapshot_entry`, `offline_snapshot_key`, `offline_snapshot_state`, `offline_snapshot_draft`,
`device_journal_import` (lecture par fonctions). Test générique : aucune table créée par 0043+ n'est écrivable par
`cashless_app`.

## Rôle `cashless_snapcontent` (nouveau ; LOGIN, NOINHERIT, NOBYPASSRLS ; `TEMPORARY` retiré)

Processus `snapshot-content` (`DecryptPort` + `DataKeyPort`). `EXECUTE` : `offline_snapshot_targets`,
`offline_snapshot_source`, `offline_snapshot_source_delta`, `save_offline_snapshot_draft`,
`wrap_offline_snapshot_key`, `offline_snapshot_keys_to_wrap`, `purge_offline_snapshot_content`. `SELECT (id,
operator_id, key_index, version, status, wrapping_kms_key_ref, encrypted_dek) ON tag_data_key`. Délais propres
(`statement_timeout` 30 s, `transaction_timeout` 60 s). Rien d'autre (liste figée par test).

## Rôle `cashless_snapsign` (nouveau ; LOGIN, NOINHERIT, NOBYPASSRLS ; `TEMPORARY` retiré)

Processus `snapshot-signer` (`SignPort` seul). `EXECUTE` : `offline_snapshot_drafts_ready`,
`offline_snapshot_draft_content`, `publish_offline_snapshot`, `offline_seq_gaps_to_alert`, `mark_seq_gap_alerted`,
`offline_retries_to_alert`. Aucun droit sur `tag_data_key`, `media`, ni sur les enveloppes. Rien d'autre.

## Rôle `cashless_maint` (nouveau ; LOGIN, NOINHERIT, NOBYPASSRLS)

`EXECUTE` : `purge_device_request_nonces(integer)`, `purge_device_enrollment_attempts()`. Rien d'autre.

## Rôle `cashless_keyadmin` (existant)

Ajout : `EXECUTE rotate_snapshot_signing_key`.

## Contraintes de base posées par la mission

- `offline_policy` : `cash_topup_offline IS NOT TRUE` ; portée cohérente (déclencheur).
- `snapshot_signing_key` : au plus deux clés `ACTIVE|RETIRED` par signataire.
- `offline_snapshot` : version calculée ; `DELTA` ⇒ base = version précédente.
- `complete_offline_batch` : numéro sans ligne de registre admis seulement s'il a une ligne `offline_batch_retry` du
  même lot (écart nommé, porteur).
- `ack_offline_snapshot` : jamais de recul.
- Garde de caisse (ADR-132) : inchangée.
