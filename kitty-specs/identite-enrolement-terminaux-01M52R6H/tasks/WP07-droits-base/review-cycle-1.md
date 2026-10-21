---
affected_files: []
cycle_number: 1
mission_slug: identite-enrolement-terminaux-01M52R6H
reproduction_command: spec-kitty agent tasks move-task WP07 --to approved --mission identite-enrolement-terminaux-01M52R6H
reviewed_at: '2026-10-20T11:23:41Z'
reviewer_agent: user
wp_id: WP07
---

Approved by user: Relecture indépendante (session distincte de l'implémenteur), verdict enregistré par l'orchestrateur. # WP07 : relecture indépendante, APPROUVÉ (20/10/2026)

Lot relu : commits a34a39f et ba927de (base ba927de~2 = a34a39f~1 = 1e3933f, vérifié). Les tests ont tourné sur un cluster PG 18 privé (port 5492), arrêté depuis.

1. Droits avant et après, rôle par rôle (deux bases construites, catalogue comparé). Aucun droit n'est élargi, à une exception près : `cashless_tagkeys` reçoit la lecture de `device.public_key`, `cert_sha256`, `os` et `nfc_enabled`, et EXECUTE sur `consume_device_nonce`, `device_token_family_active` et `assert_device_active`. T032 le demande, et le compte rendu le consigne. Tout le reste est retiré : EXECUTE hérité de PUBLIC (112 à 141 fonctions par rôle), TEMPORARY, INSERT sur `device`, UPDATE sur `status`, `public_key`, `agreement_public_key` et `cert_sha256`, écritures sur les tables S5, et `media_claim.confirmed_tap_id`.
2. Liste de `cashless_app`. Elle correspond aux appels de `apps/api/src` (51 fonctions appelées, recensement refait). Les fonctions retirées et encore appelées (`claim_tag_key_job*`, `finish_tag_key_job`) ne le sont que par les workers des processus des clés, qui les ont gardées. J'ai calculé la clôture des fonctions INVOKER et des déclencheurs pour chaque rôle : aucun manque. Le seul signalement (`check_media_transition` pour `cashless_tagkeys`) est un faux positif : le déclencheur porte sur `UPDATE OF status`, une colonne que ce rôle ne peut pas écrire. Aucune politique, aucun défaut de colonne, aucune contrainte et aucune vue n'appelle une fonction.
3. OP-N44, la fin d'OP-N59 et OP-N63 sont levés. Mutations faites sur une copie de `post-roles.sql` : sans le retrait de PUBLIC, 16 assertions échouent ; sans le retrait de TEMPORARY, 13 ; sans le retrait sur `device`, 11 ; avec `confirmed_tap_id` rendu à `cashless_app`, 4.
4. Migration 0026. Comparée à 0024, elle ne change que le filtre `operator_id` de la garde OP-N50 et le passage de `consume_tap_for_claim` en SECURITY DEFINER avec `search_path = public, pg_temp`. Chaque lecture est filtrée par le prestataire de la session. Le droit est retiré à PUBLIC.
5. `migrate.ts`. Une seule transaction, et le verrou consultatif est pris dans cette transaction. Aucun secret n'est journalisé. `migrate-rights.spec.ts` échoue si la validation se fait avant le rejeu des droits (test 2) ou si le retrait de PUBLIC disparaît (tests 1 et 2). La base jetable est bien supprimée.
6. `check:generated` est vert. pgTAP passe à 1972/1972 sur le cluster privé. Les commandes de format et de lint sont propres, ainsi que le contrôle de types de ledger-sql.

Points mineurs, non bloquants :
- `tests_device_rights.sql` §6 ne contient pas `consume_tap_for_claim`, contrairement à ce que dit le compte rendu. C'est sans conséquence : la fonction filtre elle-même par le prestataire de la session. Il suffit de corriger le compte rendu.
- Aucun test ne couvre le verrou consultatif : je l'ai retiré par mutation et les tests sont restés verts.
- Défaut antérieur à la mission, non consigné : `cashless_app` peut toujours modifier `device.next_seq_floor`, `last_seen_at` et l'affectation du terminal. Je propose une entrée OP pour la mission 7. Orchestrateur : pgTAP 1972/1972 et Jest API 1264/1264 (SKIP_LATENCY) sur la base partagée. --force autorisé par le porteur : garde kitty-specs limité aux artefacts du runtime, vérifié après réalignement.
