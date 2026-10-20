# Contrat — dettes de la base levées par la mission

Chaque dette : correction, test qui échouait avant et passe après, et mise à jour de `docs/POINTS_OUVERTS.md` (close)
et de l'ADR d'origine (« levée par la mission 5a »).

| Dette | Correction | Test | Borne inversée |
|---|---|---|---|
| OP-N59 (ADR-96) | `0021` : `ALTER FUNCTION … SET search_path = public, pg_temp` sur toute `SECURITY DEFINER` de `public` (parcours de `pg_proc`) ; `post-roles.sql` : `REVOKE TEMPORARY` sur `current_database()` (SQL dynamique) à `PUBLIC` ; test exécuté après toutes les migrations et `post-roles.sql` | `tests_definer_search_path.sql` : table temporaire homonyme sans effet sur chaque `tenant_of_*` ; création refusée à chaque `cashless_*` ; 0 fonction `SECURITY DEFINER` sans `pg_temp` en dernier | `tests_definer_trigger_writers.sql` §4 |
| OP-N44 (ADR-101) | `gen_tests.py` : `EXECUTE` accordé à `app_probe` explicitement ; `post-roles.sql` : `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC`, `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, `REVOKE ALL ON ALL ROUTINES … FROM cashless_app` (droit direct de `roles.sql`), puis droits rôle par rôle | `tests_execute_grants.sql` : chaque rôle de processus des clés n'exécute que sa liste ; `PUBLIC` n'exécute aucune fonction d'API | `tests_media_roles.sql` (limite décrite) |
| OP-N50 | `0024` : `consume_tap` refuse une lecture `confirmed_tap_id` d'une demande | `tests_consume_tap_claim.sql` | `tests_media_claim_tap.sql` |
| OP-N54 (ADR-99) | `request-hash.ts` : HMAC-SHA256 (`IDEMPOTENCY_HMAC_KEY`), hexadécimal 64 sans préfixe (décision du 20/10/2026) | unitaire : empreinte non recalculable sans la clé | — |
| OP-N62 (ADR-102) | `0025` : `retire_dedicated_key_for_job(job)` exige un travail `RETIRE_KEY` `RUNNING` issu d'une demande `EXECUTED` ; `retire_dedicated_key` retirée à `cashless_perso` par WP07 (`post-roles.sql`, qu'une migration ne peut pas précéder) ; `enqueue_tag_key_job` refuse une demande expirée (`CL023`) | sections 6 et 7 de `tests_tag_key_job_approval.sql` | idem |
| OP-N63 (ADR-105) | `0022` (`enroll_device`) + `post-roles.sql` : `cashless_app` perd `INSERT` sur `device`, `UPDATE` de `status`, `public_key`, `agreement_public_key`, `cert_sha256`, `serial`, `os`, `operator_id`, et toute écriture directe sur `device_enrollment_code`, `device_refresh_token`, `device_status_history`, `device_request_nonce` ; seules les fonctions de `data-model.md` les écrivent | réécriture directe refusée colonne par colonne, après rejeu de `roles.sql` puis `post-roles.sql` ; terminal `REVOKED` impossible à repasser `ACTIVE` | `tests_tag_key_job_approval.sql` §7 |
| OP-N42 (ADR-88) | identité réelle (`device-authentication.md`) | matrice des preuves ; garde de production | `production-guard.spec.ts` |

## Règles

- Les fichiers `.sql` générés (`tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`) ne sont modifiés que
  par leurs générateurs ; la suite de référence reste verte.
- `roles.sql` (kit) redonne tous les droits à chaque rejeu : toute réduction de droit est dans `post-roles.sql`, rejoué
  après, et un test l'exerce après un rejeu complet.
- Si une correction contredit un test de référence, la contradiction est signalée au porteur avant de choisir (§0.3).
