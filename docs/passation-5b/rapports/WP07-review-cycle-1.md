# WP07 « Droits de la base » : relecture, cycle 1

Relecteur distinct (claude). Commit relu : `2d665284` (lane-g). Base : `cashless_wp07r` (supprimée à la fin).

## Verdict : APPROUVÉ

Aucun constat bloquant. Aucun écart non consigné qui affaiblisse la sécurité. Tous les écarts au contrat vont dans le
sens d'un renforcement, ou viennent d'arbitrages déjà pris : `check_sale_lines` (22/10) et
`payment_request_for_token(uuid, bytea)` (relecture WP05).

## Vérifications, refus par refus
| Point | Résultat | Preuve |
|---|---|---|
| Tableau du contrat : `vendor` (I/U, SELECT sans `pin_hash`, `failed_attempts`, `locked_at`) | OK | post-roles §6a ; tests_payment_rights §1a, 1b, §2 |
| `vendor_session`, `vendor_pin_check` | OK | §6a ; §1b, §2 |
| `catalog_*` (4), `point_of_sale_catalog_policy`, `device_catalog_served` | OK | §6b ; §1b, §2 |
| `sale_line`, `sale_attribution` (sans INSERT ni UPDATE, constat 1 de WP04) | OK | §6c ; §1b, §2 (INSERT … SELECT refusé) |
| `payment_request` (SELECT sans `nonce_hash`), `payment_request_detail` | OK | §6d ; §1a, §2 (`WHERE nonce_hash = …` refusé) |
| `kyc_verification` | OK | §6e ; §1b, §2 |
| `device` réduit à 4 colonnes | OK | post-roles §4b ; tests_device_rights §1, §2 ; tests_tag_key_job_approval |
| A20 : REVOKE de table avant chaque GRANT par colonne | OK | `vendor`, `payment_request`, `device` |
| Vues non modifiables | OK | `vendor_public` est la seule vue de la mission (`information_schema.views`). Les autres vues du schéma ne sont pas modifiables (`is_updatable = NO`). Le test recense les vues. |
| Fonctions accordées | OK | 29 fonctions de 0031 à 0034. Hors du texte du contrat : `check_sale_lines` et `payment_request_for_token`, toutes deux arbitrées. `update_catalog_*` et `set_catalog_policy` relèvent des « fonctions d'écriture du catalogue ». Les 5 fonctions internes ne sont pas accordées et sont listées dans les refus. |
| Signatures égales à celles de `pg_proc` et sans ancienne signature | OK | Aucune surcharge dans `public` (hors pgcrypto). Les fonctions remplacées par 0031 et 0035 gardent une signature unique. Toutes en SECURITY DEFINER avec `search_path = public, pg_temp`. |
| Borne OP-N76 | OK | Elle porte sur les ACL déclarées (PUBLIC compris) et sur `has_function_privilege` de tous les rôles non superutilisateurs (héritage compris). Message renvoyant à OP-N76. |
| Tests de tests_payments.sql demandés par WP04 (constats 2 et 3) | OK | Session expirée → CL036 (avec un témoin) ; ORGANIZER_ADMIN et CASHIER en SUPERVISOR_DEVICE → CL036 |
| `roles.sql`, `gen_tests.py`, `.sql` générés | intacts | `git show --stat` |
| Rejeu idempotent | OK | Test §6. Contrôle supplémentaire, base dans un état « ancien » (avec `UPDATE (pos_id, event_id)` sur `device`, `SELECT (pin_hash)`, `SELECT (nonce_hash)`, `UPDATE (status)` sur `payment_request`, `INSERT (vendor_id)` sur `sale_attribution`) : après `roles.sql` puis deux fois `post-roles.sql`, tous ces droits ont disparu. |
| Usages de l'API | OK | Le grep de `apps/api/src` ne trouve aucune écriture directe ni lecture de `vendor`, `payment_request`, `kyc_verification` ou `sale_attribution`. |
| Tests | verts | Sur ma base : les 6 suites concernées passent (454 tests). L'orchestrateur avait déjà joué la batterie complète et Jest. |

## Mutants de post-roles.sql (fichier restauré, rien commité)
Les 7 mutants sont tués :
1. `vendor_admin_allowed` accordée → tests_execute_grants (2 échecs).
2. `open_vendor_session` accordée à `cashless_perso` → borne OP-N76 (2) et tests_execute_grants (1).
3. `vendor.locked_at` lisible → liste exacte des colonnes de `vendor` (2).
4. `UPDATE` remis sur `vendor_public` → 6 échecs.
5. `device_catalog_served` laissée en écriture → 4 échecs.
6. `device.nfc_enabled` de nouveau modifiable → tests_device_rights (3).
7. A20 violé (`REVOKE SELECT (nonce_hash)` seul) → 7 échecs.

Détail : `scratchpad/WP07-review-mutants.txt`.

## Constats
1. **À reporter (orchestrateur)** : `contracts/database-rights.md` n'est pas aligné. Il manque à la liste « Fonctions
   accordées » `check_sale_lines(uuid, jsonb, bigint)` et `payment_request_for_token(uuid, bytea)`. La relecture WP05
   demandait cet alignement, que l'implémenteur ne pouvait pas faire (`kitty-specs/` est interdit dans la lane).
   Ajouter aussi les signatures arrêtées.
2. **À reporter (porteur ou orchestrateur)** : défense en profondeur proposée par WP04, ajouter `vendor_id` à la clé
   composite de `vendor_session`. Elle n'est pas faite, et c'est justifié : il faudrait retoucher 0033. Le chemin
   d'attaque est déjà fermé par le retrait de `INSERT` sur `sale_attribution`, que le mutant prouve. Si la retouche
   n'est pas faite, la consigner comme décision.
3. **À reporter (dette à nommer)** : `vendor_pin_check` n'a aucune fonction de purge (lacune de WP02, rien n'est
   accordé). Aucune entrée dans `docs/POINTS_OUVERTS.md`. Ce n'est pas un affaiblissement : la table grossit, rien
   n'est exposé. Ajouter un point ouvert, ou une purge dans un lot ultérieur.
4. **Mineur** : le cas ajouté à tests_device_rights.sql §2 (« A12 : … dans la liste refusée ») est redondant avec la
   liste exacte du §1. Il est inoffensif.
5. **Mineur** : dans `tests_payment_rights.sql` §3, une seule fonction par famille est appelée sous `cashless_app`.
   `record_sale_lines`, `record_sale_attribution`, `assert_reversible` et les verrous QR ne le sont que par la liste
   exacte d'EXECUTE. C'est conforme au prompt (« un appel réel par famille »). Les appels réels viendront avec les
   routes de WP09 à WP13.
6. **Hors lot, signalé à part** : l'implémenteur a lancé Jest une fois sur `cashless_test` (son compte rendu, point 1).
   L'orchestrateur doit faire `reset-db` de `cashless_test` avant tout pgTAP, si ce n'est pas déjà fait.

## À faire relire par une personne
`packages/ledger-sql/post-roles.sql` : §4a (liste des fonctions), §4b (`device`) et §6 (droits de la base).
