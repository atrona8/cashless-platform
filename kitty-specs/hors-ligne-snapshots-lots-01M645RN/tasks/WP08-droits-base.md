---
work_package_id: WP08
title: Droits de la base et dettes héritées (migration 0049, post-roles.sql)
dependencies: [WP02, WP03, WP04, WP05, WP06, WP07]
requirement_refs:
- FR-038
- FR-039
- FR-040
- FR-041
- NFR-009
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
subtasks: [T033, T034, T035, T036, T037]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/post-roles.sql
create_intent:
- packages/ledger-sql/migrations/0049_rights_hardening.sql
- packages/ledger-sql/tests/_grants_for_tests.sql
- packages/ledger-sql/tests/tests_offline_rights.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/post-roles.sql
- packages/ledger-sql/migrations/0049_rights_hardening.sql
- packages/ledger-sql/tests/_grants_for_tests.sql
- packages/ledger-sql/tests/tests_offline_rights.sql
- packages/ledger-sql/tests/tests_api_idempotency.sql
- packages/ledger-sql/tests/tests_approvals.sql
- packages/ledger-sql/tests/tests_audit_log.sql
- packages/ledger-sql/tests/tests_cash_psp_rights.sql
- packages/ledger-sql/tests/tests_cash_sessions.sql
- packages/ledger-sql/tests/tests_catalog.sql
- packages/ledger-sql/tests/tests_config_served_guard.sql
- packages/ledger-sql/tests/tests_configuration.sql
- packages/ledger-sql/tests/tests_consume_tap_claim.sql
- packages/ledger-sql/tests/tests_definer_search_path.sql
- packages/ledger-sql/tests/tests_definer_trigger_writers.sql
- packages/ledger-sql/tests/tests_device_enrollment.sql
- packages/ledger-sql/tests/tests_device_purge_window.sql
- packages/ledger-sql/tests/tests_device_rights.sql
- packages/ledger-sql/tests/tests_device_tokens.sql
- packages/ledger-sql/tests/tests_enrollment_event_state.sql
- packages/ledger-sql/tests/tests_enrollment_limits.sql
- packages/ledger-sql/tests/tests_enrollment_refusal.sql
- packages/ledger-sql/tests/tests_event_ledger.sql
- packages/ledger-sql/tests/tests_event_wallet.sql
- packages/ledger-sql/tests/tests_execute_grants.sql
- packages/ledger-sql/tests/tests_identity.sql
- packages/ledger-sql/tests/tests_media_api.sql
- packages/ledger-sql/tests/tests_media_claim_tap.sql
- packages/ledger-sql/tests/tests_media_claims.sql
- packages/ledger-sql/tests/tests_media_reinstate.sql
- packages/ledger-sql/tests/tests_media_roles.sql
- packages/ledger-sql/tests/tests_payment_requests.sql
- packages/ledger-sql/tests/tests_payment_rights.sql
- packages/ledger-sql/tests/tests_payments.sql
- packages/ledger-sql/tests/tests_personalization_definer.sql
- packages/ledger-sql/tests/tests_personalizer_role.sql
- packages/ledger-sql/tests/tests_platform_admin.sql
- packages/ledger-sql/tests/tests_platform_scope.sql
- packages/ledger-sql/tests/tests_psp_configurations.sql
- packages/ledger-sql/tests/tests_psp_topups.sql
- packages/ledger-sql/tests/tests_tag_key_job_approval.sql
- packages/ledger-sql/tests/tests_tag_key_job_scope.sql
- packages/ledger-sql/tests/tests_tag_key_jobs.sql
- packages/ledger-sql/tests/tests_tag_key_retire_guard.sql
- packages/ledger-sql/tests/tests_vendors.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 – Droits de la base et dettes héritées (0049, post-roles.sql)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement :

- `contracts/database-rights.md` (en entier : c'est la matière du lot) ;
- `contracts/interfaces.md` § 1 (numérotation), § 2 à § 6 (**rôle** de chaque fonction, en
  commentaire de signature) et § 7 ;
- `research.md` **R-30.2**, **R-30.6**, **R-30.8**, **R-30.12** ;
- `data-model.md` section « Rôles » ; `spec.md` FR-038 à FR-041.

Code existant : `packages/ledger-sql/post-roles.sql` (sections 0, 1, 2, 4, 4b, 5, 7) et les quatre
suites de droits citées en T036. Priorité (SPECIFICATION §0.3) : tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD ; contradiction : **signale-la**. Ne
modifie jamais un `.sql` généré de `packages/ledger-sql/` (`schema_grand_livre_cashless.sql`,
`tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`, `roles.sql` du kit).

## Objective

Lever les cinq dettes de droits (OP-N57, OP-N58, OP-N68, OP-N69, OP-N75), créer les rôles
`cashless_snapcontent`, `cashless_snapsign`, `cashless_maint`, poser les `GRANT` nominatifs des
fonctions de WP02 à WP07, fermer les tables nouvelles, et borner chaque dette par un test qui
échoue si le droit s'élargit.

## Périmètre et arbitrages

- Dans le lot : `post-roles.sql`, `0049_rights_hardening.sql`, `tests/_grants_for_tests.sql`,
  `tests/tests_offline_rights.sql` et l'adaptation des 41 suites existantes `tests/tests_*.sql`
  listées dans `owned_files` (décompte `ls` du 30/10/2026 : **41**, sans les `.sql` générés).
- Hors lot : le code des processus (WP09 à WP13), les routes (WP14 à WP16), les suites
  `tests_offline_*.sql` de WP02 à WP07 (si l'une casse après ton défaut global : rapport).
- Les lots WP02 à WP07 n'ont posé **aucun** `GRANT` : l'état de départ est « rien d'accordé ».
  Liste les fonctions réelles de `0043` à `0048` (`grep -n "CREATE.*FUNCTION"`), compare-les à
  `database-rights.md` et `interfaces.md` : fonction sans rôle ni appelant nommé, ou liste qui
  diffère, **signalée au rapport** ; ne devine pas un accord.
  `mark_seq_gap_alerted` et `event_sync_deadline` ne sont pas accordées à `cashless_app` (R-30.12).
- `database-rights.md` précède R-30 : en cas de divergence, R-30 puis `interfaces.md` font foi.
- Défaut global (OP-N68) : `ALTER DEFAULT PRIVILEGES FOR ROLE <propriétaire> REVOKE EXECUTE ON
  FUNCTIONS FROM PUBLIC`, propriétaire = le rôle qui exécute `migrate.ts` (`DATABASE_URL_OWNER`, le
  même en CI et en production). Sans `IN SCHEMA` (la forme `IN SCHEMA public` est sans effet, voir
  le commentaire de `post-roles.sql` l.14-24, **à réécrire** car il dit le contraire).
- Place de ce défaut : `post-roles.sql` (rejoué à chaque série, idempotent) ; `0049` porte ce qui ne
  peut pas y aller. Si rien ne reste pour `0049`, garde le fichier (numérotation figée, § 1), avec
  un en-tête qui le dit, et signale-le. Les migrations déjà passées ne sont pas modifiées.

## Subtasks

### T033 – Rôles nouveaux et accords de la mission

**But** : créer les rôles et poser les `GRANT EXECUTE` nominatifs.

**Étapes**
- Rôles `cashless_snapcontent`, `cashless_snapsign`, `cashless_maint` :
  `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`, créés s'ils manquent, dans un
  bloc `DO` **séparé de la boucle des rôles de clés** (post-roles.sql l.256-275) : délais propres
  (`statement_timeout` 30 s, `idle_in_transaction_session_timeout` 10 s, `lock_timeout` 5 s,
  `transaction_timeout` 60 s si PG ≥ 17, R-30.6), tout remis à zéro (`REVOKE ALL` tables, séquences,
  routines), `GRANT USAGE ON SCHEMA public`, `REVOKE TEMPORARY` (section 5, l.559-580). Mot de passe
  : jamais dans le fichier.
- `cashless_snapcontent` : `EXECUTE` des fonctions marquées « content » dans `interfaces.md` ; plus
  `SELECT (id, operator_id, key_index, version, status, wrapping_kms_key_ref, encrypted_dek) ON
  tag_data_key` (R-30.12, liste de colonnes **figée**, jamais « toutes sauf »). Aucun droit sur
  `offline_snapshot`.
- `cashless_snapsign` : `EXECUTE` des fonctions « signer », dont `discard_offline_snapshot_draft` et
  `mark_offline_retry_alerted` (ADR-140, décision du porteur). Aucun droit d'audit (l'audit
  `SNAPSHOT_PUBLISHED` est écrit par `publish_offline_snapshot`). Aucun droit sur `tag_data_key`, `media`,
  ni sur les enveloppes (`offline_snapshot_key`). Liste exacte : `database-rights.md`.
- `cashless_snapcontent` reçoit aussi `append_…_entries`, `seal_…` et `discard_offline_snapshot_draft`
  (`database-rights.md`) ; `cashless_app` reçoit `device_journal_imports_processing` (ADR-140).
- `cashless_maint` : `EXECUTE` de `purge_device_request_nonces(integer)` et
  `purge_device_enrollment_attempts()`, rien d'autre. `cashless_keyadmin` : ajout de
  `EXECUTE rotate_snapshot_signing_key`.
- `cashless_app` : `EXECUTE` de la liste de `database-rights.md` § « accordés », corrigée par
  R-30.12 et complétée par les fonctions d'`interfaces.md` § 2 à § 6 de rôle `cashless_app`.
  Signature complète dans chaque `GRANT` (jamais `ON ALL FUNCTIONS`), par famille comme la section
  7c.
- Mots de passe des trois rôles : `src/migrate.ts` (liste `passwords`) et `ledger-tests.yml` n'ont
  pas de propriétaire. Retouche minimale hors carte (`CASHLESS_SNAPCONTENT_PASSWORD`,
  `CASHLESS_SNAPSIGN_PASSWORD`, `CASHLESS_MAINT_PASSWORD`), **une ligne au rapport**.

### T034 – Retraits à `cashless_app`

**But** : lever OP-N57, OP-N58, OP-N69, OP-N75 et fermer les tables nouvelles (R-30.2).

**Étapes** (références : `database-rights.md` § « Retraits »)
- OP-N57 : `REVOKE INSERT, UPDATE ON offline_snapshot`. OP-N58 : `REVOKE INSERT, UPDATE ON
  offline_policy_history` et `INSERT, UPDATE, DELETE ON offline_policy` (écriture par
  `set_offline_policy` et `clear_offline_policy`, trace par `log_offline_policy` DEFINER).
- OP-N69 : `UPDATE ON device` retiré **entièrement** (post-roles.sql l.533-535 : supprimer le
  `GRANT UPDATE (station_name, last_snapshot_version, last_seen_at, next_seq_floor)`). Vérifie par
  `grep -rn "UPDATE device" apps/api/src` qu'aucun appelant ne reste (le 30/10/2026 : aucun) ; les
  écritures légitimes sont `record_device_heartbeat`, `ack_offline_snapshot`,
  `set_device_station_name` et les fonctions d'enrôlement. `next_seq_floor` : vérifié le 30/10/2026,
  aucun `UPDATE` côté API (seulement des lectures, `device-config.service.ts:147`) ; seules les fonctions
  d'enrôlement (0022, 0035) le posent. Le retrait n'enlève donc aucun écrivain ; s'il en apparaît un,
  signale-le (un écrivain DEFINER qui ne fait jamais descendre le plancher est alors à ajouter, FR-039).
- OP-N75 : retrait de `EXECUTE` des deux purges à `cashless_app` (accordées à `cashless_maint`).
- Renforcement : `REVOKE INSERT, UPDATE ON snapshot_signing_key`, `REVOKE INSERT ON anomaly` (les
  `UPDATE` d'`anomaly` restent tant qu'un appelant les utilise : vérifie, ne devine pas).
- Tables nouvelles (0043 à 0048) : `INSERT, UPDATE, DELETE, TRUNCATE` retirés à `cashless_app` sur
  toutes ; `SELECT` retiré aussi sur `offline_snapshot_entry`, `offline_snapshot_key`,
  `offline_snapshot_state`, `offline_snapshot_draft`, `device_journal_import`. Les retraits viennent
  **après** `roles.sql` (qui rend tout) : respecte l'ordre du fichier.

### T035 – Défaut global (OP-N68), `_grants_for_tests.sql`, 41 suites

**But** : lever OP-N68 sans casser les suites qui créent des fonctions sous un autre rôle.

**Étapes**
- Pose le défaut dans `post-roles.sql` (voir périmètre). Rejeu idempotent, `current_user` ou
  `DATABASE_URL_OWNER` : le rôle qui exécute `migrate.ts`, pas un nom en dur.
- Conséquence : les fonctions que les suites créent ensuite (`pg_temp.*`, `CREATE EXTENSION pgtap`
  dans la transaction) ne sont plus exécutables par `cashless_app` ni les autres rôles. D'où
  `tests/_grants_for_tests.sql` : un fichier commun, inclus par `\ir _grants_for_tests.sql`
  **avant** `CREATE EXTENSION pgtap` et avant la création des fonctions de la suite. Piste : y
  rétablir `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS TO PUBLIC`, **dans la transaction
  de la suite** (annulée par le `ROLLBACK`). Vérifie l'ordre par essai ; dis ce qui a marché.
- Il n'est **jamais** inclus par `tests_execute_grants.sql` §4 ni par `migrate.ts` (preuve que le
  défaut de production reste fermé).
- `scripts/test-pgtap.sh` lance `tests/*.sql` : `_grants_for_tests.sql` serait exécuté comme une
  suite (pas de plan : échec). Retouche minimale hors carte (ignorer les fichiers `_*.sql`), **une
  ligne dans le rapport** ; l'orchestrateur la valide.
- Les 41 suites : ajoute l'inclusion là où l'exécution échoue (31 incluent `post-roles.sql`, 10 non
  : `ls` le 30/10/2026). Ne touche pas une suite qui passe sans changement ; liste au rapport celles
  modifiées et pourquoi. Aucune assertion n'est affaiblie pour faire passer une suite.

**Critère** : les 41 suites sont vertes sur `cashless_wp08` avec le défaut posé.

### T036 – Tests de droits existants, adaptés

**But** : inverser ou mettre à jour les assertions qui figeaient les dettes.

- `tests_execute_grants.sql` : §2 (l.59-205) listes figées de `cashless_app` (nouvelles fonctions,
  purges en moins) et nouvelles listes de `cashless_snapcontent`, `cashless_snapsign`,
  `cashless_maint` et `cashless_keyadmin` ; §1 : `PUBLIC` toujours `{}` ; §4 (l.227-262) **inversé**
  : la fonction créée à la main n'est plus exécutable (`LIMITE RESTANTE` supprimée, OP-N68 levée).
- `tests_device_rights.sql` §1 (l.56-62) : colonnes de `device` modifiables par `cashless_app` =
  liste **vide**. Les §2 et §3 (écriture directe refusée) restent et doivent passer.
- `tests_definer_trigger_writers.sql` §3 (l.162-188) **inversé** : aucun rôle `cashless_*` n'écrit
  `offline_snapshot` ni `offline_policy_history` ; `log_offline_policy` est DEFINER (l.187 passe de
  `NOT prosecdef` à `prosecdef`) ; relis la liste des déclencheurs (l.184-186) : WP02 et WP03 en ont
  peut-être ajouté, adapte-la à l'état réel et dis-le.
- `tests_device_purge_window.sql` : les appels aux purges passent sous `SET ROLE cashless_maint` ;
  `cashless_app` n'exécute plus ni l'une ni l'autre (l.52-58 inversées).

Chaque assertion modifiée est listée au rapport (ancienne et nouvelle valeur).

### T037 – `tests_offline_rights.sql` : test générique et bornes

**Gabarit** : en-tête de `tests/tests_device_rights.sql` ; ici les `SET ROLE` sont **de rigueur**.
- Générique : liste figée des tables créées par 0043 à 0048 (déduite des migrations) ; aucune n'est
  écrivable par `cashless_app` (`has_any_column_privilege` pour `INSERT`, `UPDATE`, `DELETE`,
  `TRUNCATE`), toutes ont `operator_id` et RLS forcée (`relrowsecurity`, `relforcerowsecurity`) ;
  les cinq tables à lecture fermée ne sont pas lisibles. Une table de `public` ni dans cette liste
  ni dans la liste figée d'avant 0043 fait échouer le test.
- OP-N57 : `INSERT` direct sur `offline_snapshot` refusé à `cashless_app` ;
  `publish_offline_snapshot` sous `cashless_snapsign` : version = max + 1, version plantée en avance
  refusée (`CL048`). La concurrence à deux connexions n'est pas faisable en pgTAP : dis-le, WP21 la
  prouve.
- OP-N58 : `INSERT`/`UPDATE`/`DELETE` directs sur `offline_policy` et son historique refusés ;
  `set_offline_policy` sous `cashless_app` écrit la ligne et la trace.
- OP-N69 : `UPDATE device` refusé en entier ; `record_device_heartbeat`, `set_device_station_name`,
  `ack_offline_snapshot` fonctionnent sous `cashless_app`. OP-N75 : `cashless_app` refusé sur les
  purges, `cashless_maint` accepté. OP-N68 : fonction créée à la main non exécutable.
- Rôles de processus : sous `cashless_snapcontent`, `SELECT` de `encrypted_dek` accepté mais d'une
  autre colonne de `tag_data_key` refusé, `publish_offline_snapshot` refusé ; sous
  `cashless_snapsign`, `tag_data_key`, `offline_snapshot_key` et `wrap_offline_snapshot_key`
  refusés. Listes d'`EXECUTE` de chaque rôle figées (échec si une fonction s'ajoute).
  `snapshot_signing_key` et `anomaly` : retraits.

## Sécurité

- Le défaut global ne doit jamais être posé sous une forme sans effet (`IN SCHEMA`) ni pour un
  autre rôle que le propriétaire réel : borne en T037 et `migrate-rights.spec.ts` (hors carte,
  `apps/api/test/integration/transverse/`, relancé par l'orchestrateur ; signale s'il casse).
- `GRANT ALL`, `ON ALL FUNCTIONS` ou `GRANT … TO PUBLIC` dans ce lot = constat bloquant. Un
  `EXECUTE` sans appelant nommé est signalé, pas accordé.
- Tout écart qui affaiblit la sécurité (droit plus large que `database-rights.md`, retrait reporté,
  assertion assouplie, `SELECT` sur colonne non listée) est soumis au porteur AVANT d'être codé
  (règle 1 de `CLAUDE.md`) ; un écart qui renforce se fait puis se consigne.
- **À faire relire par une personne** : `post-roles.sql` en entier, `0049_rights_hardening.sql`,
  `_grants_for_tests.sql` et la liste des colonnes de `tag_data_key` de `cashless_snapcontent`.
  L'agent qui écrit ne vaut pas relecture indépendante.

## Tests

- Base du lot `cashless_wp08` (pas `cashless_test`) : `reset-db`, puis `pg_prove -d cashless_wp08`
  sur `tests_offline_rights.sql`, les 41 suites adaptées, `tests_grand_livre_cashless.sql` et
  `scenario_reference_test.sql` (sans les modifier).
- Rejoue `post-roles.sql` deux fois (idempotence) ; les suites WP02 à WP07 passent avec le défaut.
- L'orchestrateur relance la suite complète en série.

## Ce que le relecteur doit casser

1. Sous `cashless_app` : `INSERT` direct dans chaque table 0043+, `UPDATE device SET status = …`,
   `DELETE FROM offline_policy`, `EXECUTE` de `purge_device_request_nonces`.
2. Une fonction créée par le propriétaire après `post-roles.sql` : exécutable par `PUBLIC` ou
   `cashless_app` ? Même chose après un rejeu complet de `migrate.ts`.
3. `cashless_snapsign` : lire les mots de passe de bracelet, `tag_data_key`, une enveloppe.
4. `cashless_snapcontent` : `INSERT` dans `offline_snapshot`, `SELECT *` sur `tag_data_key`,
   `publish_offline_snapshot`.
5. Une fonction de `0043` à `0048` sans `GRANT` : le test doit échouer.
6. `_grants_for_tests.sql` rejoué hors transaction, ou inclus par `tests_execute_grants.sql` §4.
7. Les 41 suites : assertion supprimée ou assouplie (`git diff`) ; défaut global posé pour un
   autre rôle que celui de `migrate.ts`.

## Definition of Done

- [ ] `post-roles.sql` : trois rôles, accords nominatifs, retraits OP-N57/58/69/75, tables nouvelles
      fermées, défaut global OP-N68, commentaire de l'en-tête réécrit ; idempotent.
- [ ] `0049_rights_hardening.sql` présent (contenu, ou en-tête qui explique pourquoi il est vide).
- [ ] 41 suites vertes ; `tests_execute_grants`, `tests_device_rights`,
      `tests_definer_trigger_writers`, `tests_device_purge_window` adaptés ;
      `tests_offline_rights.sql` vert ; suites WP02 à WP07 vertes.
- [ ] Rapport : fonctions sans appelant ou sans rôle, retouches hors carte (`migrate.ts`,
      `test-pgtap.sh`, `ledger-tests.yml`), assertions modifiées (avant/après), points à faire
      relire, commandes et résultats pour la matrice d'acceptation (FR-038 à FR-041).

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP08 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
