---
affected_files: []
cycle_number: 1
mission_slug: hors-ligne-snapshots-lots-01M645RN
reproduction_command:
reviewed_at: '2026-10-30T15:55:09Z'
reviewer_agent: claude
wp_id: WP08
---

# Relecture WP08 (droits de la base) — rejet, cycle 1

Droits, rôles, politiques, défaut global, bornes : conformes (voir note). Un constat bloquant.

## B1 (bloquant) — le retrait de tout UPDATE sur `device` casse les verrous de ligne de l'API (27 suites Jest, 202 tests)
`SELECT … FROM device … FOR UPDATE | FOR NO KEY UPDATE | FOR SHARE` exige le privilège UPDATE sur la table. Après
`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON device FROM cashless_app` (post-roles.sql 8c) et la suppression du
`GRANT UPDATE (station_name, …)`, ces verrous échouent sous `cashless_app` (42501 `permission denied for table device`,
traduit en 403 `DEVICE_REVOKED`). Reproduit à la main : `SET ROLE cashless_app; SELECT 1 FROM device FOR UPDATE` /
`FOR NO KEY UPDATE` / `FOR SHARE` -> refus.
Appelants (le `grep "UPDATE device"` du prompt ne les voyait pas) :
- `apps/api/src/payments/device-seq-registry.ts:106` (`FOR UPDATE`, chemin de vente, record_device_seq)
- `apps/api/src/topups/cash/cash-topup.service.ts:150` (`FOR UPDATE`)
- `apps/api/src/devices/config/device-config.service.ts:138` (`FOR NO KEY UPDATE`)
Suites en échec (batterie complète, `cashless_wp08`, après reset-db) : payments (payments, payments-refusals,
payments-locks, payments-concurrency, get-payment, heartbeat-etag), payment-requests (merchant-qr, customer-qr),
topups (cash-topup, cash-topup-refusals, cash-desk-guard), devices (config, heartbeat), reversals (backoffice,
supervisor, vendor), catalog-config, end-to-end (media-isolation, media-port-swap, device-auth-matrix,
payment-isolation, payment-journey, device-isolation, payment-secrets, device-journey, device-secrets,
payment-concurrency). Bilan : Test Suites 27 failed / 140 passed / 2 skipped ; Tests 202 failed / 2356 passed.
Aucun lot suivant ne prévoit de réparer ces verrous (WP10 ne répare que `device-purge`).
Correction attendue (sans élargir le droit sur les colonnes) : une des deux voies, à soumettre au porteur si elle
élargit un droit :
 (a) fonction DEFINER de verrou du terminal (ex. `lock_device(p_device uuid)` : `PERFORM 1 FROM device WHERE id =
     p_device AND operator_id = tenant courant FOR UPDATE|NO KEY UPDATE`, assert_tenant), accordée à `cashless_app`
     par nom, appelée par les trois sites (renforce ; migration 0049 ou nouvelle fonction, `interfaces.md` § 1 fige la
     numérotation : la mettre dans 0049) ; ou
 (b) accorder UPDATE sur une colonne inoffensive (affaiblit : à soumettre au porteur AVANT codage, règle 1).
Ajouter un test pgTAP qui prouve le verrou sous `cashless_app`. Relancer la batterie Jest complète : 0 suite en échec
hors instabilités connues. Les deux échecs `permission denied for function purge_device_request_nonces`
(media-port-swap, device-secrets) sont attendus : WP10 (`device-purge` sous `DATABASE_URL_MAINT`).

## Mineurs (non bloquants)
M1. `tests/_grants_for_tests.sql` exécuté seul (hors transaction, ex. `pg_prove tests/*.sql`) pose le défaut
    `GRANT EXECUTE … TO PUBLIC` de façon permanente sur la base (constaté : base réouverte jusqu'au prochain
    post-roles.sql). Ajouter une garde (échec hors transaction explicite) ou le déplacer hors de `tests/`.
M2. Mutants survivants : `GRANT DELETE ON anomaly TO cashless_app` ne casse aucun test (la borne d'`anomaly` ne
    couvre que INSERT) ; `ALTER DEFAULT PRIVILEGES … GRANT … TO PUBLIC` posé à chaud ne casse rien (le test OP-N68
    rejoue post-roles.sql ; le mutant sur la ligne 8a de post-roles.sql, lui, est tué).
M3. `tools/dev-db/env.test.example` n'a pas les trois nouveaux mots de passe ; `apps/api/test/support/db.ts` n'a pas
    d'URL pour les trois rôles (WP10+).
M4. `cashless_app` garde SELECT sur `offline_snapshot` (dont `content_key_wrapped`, `signature`) : hors liste de
    fermeture du contrat, mais à confirmer par le porteur (clé de contenu enveloppée lisible par le rôle de l'API).
M5. Fonctions accordées à `cashless_app` hors liste de database-rights.md mais couvertes par interfaces.md
    (« cashless_app par défaut ») : offline_policy_level, snapshot_public_keys, offline_batch_state, offline_op_results,
    offline_batch_retries_open, open_imported_batch, device_journal_import_view, offline_block_time,
    offline_snapshot_meta, device_revoked_at. Aucune sans source.
