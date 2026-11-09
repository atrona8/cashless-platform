---
work_package_id: WP09
title: Droits de la base et non-régression du kit
dependencies: [WP03, WP04, WP05, WP06, WP07, WP08]
requirement_refs:
- FR-031
- NFR-011
- C-010
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T038, T039, T040, T041]
phase: Phase 2 - Base du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/post-roles.sql
create_intent: [packages/ledger-sql/tests/tests_edge_rights.sql, apps/api/test/integration/edge/edge-sync-guard.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/roles.sql, packages/ledger-sql/post-roles.sql, packages/ledger-sql/tests/tests_execute_grants.sql, packages/ledger-sql/tests/tests_offline_rights.sql, packages/ledger-sql/tests/tests_edge_rights.sql, apps/api/test/integration/edge/edge-sync-guard.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 : Droits de la base et non-régression du kit

> **Corrections après analyse** : `contracts/interfaces.md` § 13.5 : liste exacte des droits de `cashless_edgeadmin`, du rôle de maintenance et de `cashless_tagkeys` ; elle remplace les quatre fonctions citées plus bas.


> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour les droits ajoutés (§ 12.3 à 12.5).


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis ensuite la fiche de contexte fournie par l'orchestrateur, ce prompt, puis seulement :

- `docs/passation-8/contexte-m8.md` : décisions 5 et 6 ; règles de la mission (aucun `GRANT` hors de ce lot) ;
- `contracts/interfaces.md` § 1 (dernier paragraphe : ce lot est le SEUL à accorder), § 2 (toutes les signatures, par lot), § 3 (rôles,
  variables, processus) ;
- `data-model.md` A.1 EN ENTIER (table des rôles, tests de droits, non-régression A04) ; `research.md` R-03 (rôle `cashless_edge`),
  R-05 (`cashless_edgeadmin`), R-06 (points 1 à 4), R-07 (colonne « Accordée à ») ;
- constats `A04`, `A16`, `A22` de `docs/passation-8/rapports/plan-adversarial.md` ; ADR-155 et suivants de `docs/DECISIONS_ADR.md` pour les
  écarts de droits ; `docs/POINTS_OUVERTS.md` OP-N68 (fonctions futures fermées par défaut) ;
- code : `packages/ledger-sql/roles.sql` (en entier, 60 lignes), `post-roles.sql` § 0 (remise à zéro), § 2 (rôles des clés, boucle de
  création et de délais, l. 250-300), § 5 (`TEMPORARY`, l. 575-585), § 8 (rôles snapshot et maintenance, l. 770-910),
  `tests/tests_execute_grants.sql` (en entier), `tests/tests_offline_rights.sql`, `tests/_grants_for_tests.sql`,
  `tests/tests_default_acl.sql`, `packages/ledger-sql/src/migrate.ts` l. 130-160 (mots de passe des rôles),
  `apps/api/test/support/db.ts` (connexions de test : `APP_URL`, modèle `roleUrl`), `migrations/0058` à `0063` (WP03 à WP08).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. En cas de désaccord entre `tasks.md`,
`interfaces.md` et `data-model.md`, `interfaces.md` fait foi.

## Objective

Donner à chaque rôle exactement ses droits, ni plus ni moins, et prouver que le kit passe sans modification. `roles.sql` rend
INSERT, UPDATE et EXECUTE sur tout à chaque rejeu ; `post-roles.sql` doit donc retirer, puis accorder fonction par fonction. Les
fonctions et tables de WP03 à WP08 sont fermées par défaut (OP-N68) : sans ce lot, rien ne s'exécute, et chaque table nouvelle reste
écrivable par `cashless_app`. Les listes sont figées par des tests. C'est le lot que la règle 4 de `CLAUDE.md` désigne pour relecture humaine.

## Branch Strategy

- Branche de planification et de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP09 --agent claude --mission passerelle-locale-01M6NM1S`
  (avec `LC_ALL=C LANG=C`).

## Périmètre et arbitrages

- Seul lot qui écrit des `GRANT` pour la mission. Aucun `.sql` généré du kit n'est modifié ; `roles.sql` appartient au kit mais figure dans ta
  carte : tu n'y ajoutes que le strict nécessaire (le retrait sur `edge_gateway` va plutôt dans `post-roles.sql`, qui reprend ce que `roles.sql`
  accorde). Idempotence : le rejeu des deux fichiers donne le même état.
- **Retrait de l'écriture directe sur `edge_gateway` (R-06.1)** : `data-model.md` et `research.md` le placent en 0058 ; `tasks.md` (T038) le
  place ici, et WP03 ne le fait pas. Retenu : ici. `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON edge_gateway FROM cashless_app` (et le même
  retrait pour `cashless_platform` si elle l'a), SELECT conservé sous RLS. Signale la fenêtre entre la fusion de WP03 et celle de ce lot.
- **Noms** : `data-model.md` A.1 parle de `grant_edge_authority` (enveloppe humaine) ; `interfaces.md` l'appelle `edge_grant_authority`. Retenu :
  `interfaces.md`. La fonction S12 brute `grant_edge_authority` reste FERMÉE à tous les rôles (elle ne consigne pas le filigrane de
  référence et ne refuse pas une caisse `CLOSING` : l'ouvrir contournerait A03). Idem `set_debit_authority`, `force_central_authority`,
  `ack_edge_handover`, `complete_edge_release`, `record_edge_seq`.
- **Fonctions absentes d'une liste** : `edge_sync_batch_finish` (dans `interfaces.md` § 2, absente de la liste de `cashless_edge` de
  A.1) et `deposit_edge_pwd_pack_key` (absente de la liste de `cashless_tagkeys`) : accorde-les (elles sont nécessaires) et signale l'écart.
  `request_edge_release` et `fail_edge_grant` (S12 du kit, enveloppes humaines selon A.1) : vérifie ce que `cashless_app` exécute aujourd'hui
  et accorde ce qui manque, nommément.
- **Rôles et mots de passe** : WP03 crée `cashless_edge` et `cashless_edgeadmin` (sans mot de passe). Ici : délais de session identiques à
  `cashless_app`, `REVOKE ALL` sur tables, séquences, routines, `GRANT USAGE ON SCHEMA public`, `REVOKE TEMPORARY` (comme les rôles des clés).
  `migrate.ts` doit poser `CASHLESS_EDGE_PASSWORD` et `CASHLESS_EDGEADMIN_PASSWORD` (modèle l. 137-150) et `.github/workflows/ledger-tests.yml`
  les fournir : ces deux fichiers n'appartiennent à aucun lot de ta carte. **Ne les modifie pas ; signale-les** à l'orchestrateur (§ 11).
- Hors lot : toute logique SQL ou TypeScript ; le test de connexion réelle du processus `edge` (WP10).

## Subtasks

### T038 : `roles.sql` et `post-roles.sql`

- **`cashless_edge`** : `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`. EXECUTE NOMMÉ (jamais `ALL FUNCTIONS`) sur :
  `identify_edge_gateway`, `touch_edge_gateway`, `get_current_edge_handover`, `get_debit_authority`, `begin_edge_release`,
  `edge_ack_handover`, `edge_complete_release`, `edge_record_seq`, `edge_sync_batch_begin`, `edge_sync_batch_result`,
  `edge_sync_batch_finish`, `edge_record_staff_token_audit`, `edge_post_transaction`, `edge_activate_media`, `edge_take_deposit`,
  `edge_topup_cash`, `edge_replication_page`. Écris les signatures exactes d'après les migrations. AUCUN `post_transaction`, aucun
  `set_debit_authority`, aucune fonction S12 brute, aucun droit de table.
- **`cashless_edgeadmin`** : même forme ; EXECUTE seulement sur `register_edge_gateway`, `revoke_edge_gateway`, `rotate_edge_gateway_cert`,
  `swap_edge_gateway_roles`. `set_edge_gateway_role` n'est accordée À PERSONNE.
- **`cashless_app`** : retrait de l'écriture sur `edge_gateway` ; EXECUTE ajouté sur `edge_grant_authority`, `get_debit_authority`,
  `fail_edge_release`, `force_central_authority_approved` et, selon ce que tu constates, `request_edge_release` et `fail_edge_grant`.
  `post_transaction` reste exécutable (la garde SQL de WP05 refuse `EDGE_SYNC` à cette connexion).
- **Tables nouvelles** : pour CHAQUE table créée par 0058 à 0063 (`edge_sync_batch`, `edge_sync_batch_result`, `edge_pwd_pack_key`,
  `edge_pwd_pack`, `edge_reference_change`, `edge_staff_token_audit`, la table de réglage de plateforme, toute table d'horizon) :
  `REVOKE INSERT, UPDATE, DELETE, TRUNCATE FROM cashless_app` (roles.sql les lui rend à chaque rejeu). Lecture : `cashless_app` perd tout
  sur `edge_pwd_pack` et `edge_pwd_pack_key` (chiffrés, mais inutiles à l'API publique) et sur `edge_reference_change` ; SELECT (RLS)
  conservé sur `edge_sync_batch`, `edge_sync_batch_result`, `edge_staff_token_audit`. Si un lot de l'API en exige davantage, il le
  demandera : n'élargis pas par précaution.
- **`cashless_tagkeys`** : + `deposit_edge_pwd_pack`, `deposit_edge_pwd_pack_key`. **Processus de maintenance (`cashless_maint`)** : +
  `mark_edge_gateways_silent`. Le travailleur de maintenance de WP12 peut avoir besoin d'une lecture des handovers bloqués (alerte « rendu
  bloqué ») : aucune fonction ne la fournit dans `interfaces.md` ; signale-le à l'orchestrateur sans inventer de droit de table.
- Ajoute les deux rôles à la boucle des délais (`statement_timeout` 30 s, `idle_in_transaction_session_timeout` 10 s, `lock_timeout` 5 s,
  `transaction_timeout` 60 s) et à la liste du `REVOKE TEMPORARY` (§ 5).

### T039 : Listes figées

- `tests_execute_grants.sql` : liste exacte de `cashless_app` mise à jour (ajouts ci-dessus, aucune fonction S12 brute), nouvelles listes
  figées de `cashless_edge`, `cashless_edgeadmin`, `cashless_tagkeys` et `cashless_maint` mises à jour. `PUBLIC` : toujours aucune fonction
  exécutable, y compris les fonctions de 0058 à 0063 (le défaut OP-N68 doit couvrir celles créées après `post-roles.sql`).
- `tests_offline_rights.sql` : liste des tables et des droits de colonne mise à jour pour les tables nouvelles et pour `edge_gateway`.
- `tests_edge_rights.sql` (nouveau, pgTAP, `SET ROLE`, gabarit `tests_offline_rights.sql`) : sous `cashless_edge` : aucun `SELECT` sur
  `ledger`, `posting`, `media`, `edge_gateway`, `edge_pwd_pack`..., aucun `post_transaction`, aucun `set_debit_authority` ; sous
  `cashless_edgeadmin` : seules les quatre fonctions ; sous `cashless_app` : `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` sur `edge_gateway` et sur
  chaque table nouvelle refusés, `grant_edge_authority` brute refusée ; `cashless_tagkeys` : dépôt autorisé, lecture d'une autre table refusée.
- Chaque assertion doit échouer si on rétablit le droit : vérifie-le en pensée (ou par un `GRANT` de contrôle commenté dans la
  suite de preuve), et écris-le en commentaire du test.

### T040 : Test à connexion réelle sous `cashless_app` : `EDGE_SYNC` refusée

`apps/api/test/integration/edge/edge-sync-guard.spec.ts` (Jest, connexion RÉELLE ; un `SET ROLE` ne change pas `session_user`, la garde de WP05
ne se prouve que par une connexion réelle). Il utilise `APP_URL` de `apps/api/test/support/db.ts` ; pour les URL des rôles `edge`/`edgeadmin`,
ce fichier n'est pas dans ta carte : lis `DATABASE_URL_EDGE` / `DATABASE_URL_EDGEADMIN` dans l'environnement avec le même défaut local
(`postgres://cashless_edge:cashless_edge_local@127.0.0.1:5433/cashless_test`) DANS le test, et signale qu'un helper commun est à ajouter par WP10.
- Cas : (a) connexion `cashless_app` appelle `post_transaction` en source `EDGE_SYNC` sur un grand livre sous `EDGE` : refus ; (b) la même
  écriture en `EDGE_SYNC` sur un grand livre `CENTRAL` : refus aussi (la garde ne dépend pas de l'autorité) ; (c) CONTRÔLE POSITIF : écriture
  `ONLINE` valide sous `cashless_app` passe ; écriture `EDGE_SYNC` sous le propriétaire passe (la garde ne sur-bloque pas) ; (d) sous
  `cashless_edge` : `post_transaction` refusé (`42501`) ; (e) `cashless_app` : `UPDATE edge_gateway SET status = 'ACTIVE'` sur une passerelle
  `REVOKED` refusé ; `UPDATE edge_gateway SET contiguous_edge_seq = 0` refusé ; (f) `cashless_app` appelle `edge_record_seq` : refus.
- Données par le propriétaire (fixtures de `test/support`), prestataire propre à la suite, nettoyage à la fin. Le test ne lance pas `resetDatabase`.

### T041 : Non-régression des suites générées

Tu ne modifies AUCUN fichier du kit. Fais l'inventaire (dans le rapport) de chaque suite générée ou ancienne qui interroge des droits ou
appelle des fonctions sous un rôle (`tests_grand_livre_cashless.sql`, `tests_definer_search_path.sql`, `tests_offline_snapshots.sql`,
`tests_cash_psp_rights.sql`, `tests_device_rights.sql`, `tests_payment_rights.sql`, `tests_default_acl.sql`) et indique laquelle peut être
touchée par les nouveaux `REVOKE` ; l'orchestrateur les relance en série SANS modification. Une suite qui échoue à cause de ces droits est
un défaut de ce lot, pas du kit.

## Tests attendus

- `tests_execute_grants.sql`, `tests_offline_rights.sql` mis à jour, `tests_edge_rights.sql` nouveau : listes exactes, positives ET négatives.
- `edge-sync-guard.spec.ts` : cas (a) à (f), avec contrôles positifs.
- Tu ne lances ni Jest, ni pgTAP, ni `reset-db`. L'orchestrateur relance : suites ci-dessus, `tests_grand_livre_cashless.sql`,
  `tests_definer_search_path.sql`, `tests_offline_snapshots.sql`, puis l'intégration `edge/`.

## Décisions du porteur du 09/11/2026 (font foi sur ce prompt)

Source : `docs/passation-8/contexte-m8.md`, décisions 19 à 31, et les notes adressées à ce lot dans
`docs/passation-8/suivi-lots.md` (à lire en entier pour ce lot).

- **Migration correctrice `0064_edge_fixes.sql`** (fichier ajouté à ce lot, avec `tests/tests_edge_fixes.sql`) :
  - décision 25 : fenêtre du plafond horaire par terminal de `0061` en microsecondes, bornes fermées ; test de bordure
    (deux ventes à 3 599,9 s se comptent ensemble) qui échoue sur la fenêtre de `0061` ;
  - décision 21 : plafond par recharge en espèces au rejeu (`0062`), réglage `edge_setting_value` (500 000 XOF par
    défaut, posé par `set_edge_setting`) ; au-delà, jamais `REJECTED` : écriture comme une recharge hors marge et
    anomalie résolue à deux (même mécanisme que la décision 14, OP-N108) ; test.
  - décision 23 : fonction `edge_expose_device_token_families(p_event_id)` (SECURITY DEFINER, `assert_tenant`) qui
    pose `device_refresh_token.edge_exposed = true` sur les familles actives des terminaux de l'événement ; jamais
    d'autre colonne ; `EXECUTE` à `cashless_app` seul ; tests (autre prestataire refusé, familles révoquées ignorées).
  Partir des définitions de `0061`/`0062` (pas du schéma) ; `REVOKE ALL … FROM PUBLIC`, droits dans ce même lot.
- Notes de droits des relectures (WP03 à WP08) : sections « WP09 » de `suivi-lots.md`, toutes obligatoires.

## Sécurité

- **À faire relire par une personne** : `post-roles.sql` (toutes les sections ajoutées) et `roles.sql`. C'est la frontière de privilèges de
  la passerelle côté central : un `GRANT` de trop rend toute la défense vaine.
- Principe : liste nommée, jamais `ALL`, jamais `PUBLIC`. Une fonction oubliée échoue fermée (le processus la réclamera) ; une fonction en
  trop est un défaut bloquant.
- Aucun rôle applicatif n'exécute `set_debit_authority`, `force_central_authority`, `record_edge_seq` brute, `ack_edge_handover`,
  `complete_edge_release`, `grant_edge_authority` brute. `cashless_edge` ne lit AUCUNE table.
- Règle 1 : tout droit plus large que prévu (table lisible, fonction S12 ouverte, `cashless_app` écrivant `edge_gateway`) est soumis au
  porteur AVANT d'être codé. Fichiers à faire relire : `post-roles.sql`, `roles.sql`, `tests_edge_rights.sql`.

## Definition of Done

- [ ] `post-roles.sql` (et `roles.sql` si nécessaire) : rôles `cashless_edge` et `cashless_edgeadmin` complets ; listes nommées ; retraits.
- [ ] Rejeu idempotent de `roles.sql` puis `post-roles.sql` (même état au second passage).
- [ ] `tests_execute_grants.sql`, `tests_offline_rights.sql` mis à jour ; `tests_edge_rights.sql` créé.
- [ ] `edge-sync-guard.spec.ts` créé, contrôles positifs compris.
- [ ] Rapport : listes finales par rôle, écarts (noms, fonctions absentes de A.1, `migrate.ts` et CI à compléter, helper `db.ts`, lecture des
      handovers pour la maintenance), inventaire de T041, fichiers à relire, ce qui n'a pas été lancé.
- [ ] Aucun `.sql` généré modifié ; aucun commit ; le port 80 n'est pas touché.

## Ce que le relecteur doit casser

1. Sous `cashless_app`, appeler `set_debit_authority`, `force_central_authority`, `record_edge_seq`, `grant_edge_authority` : refus.
2. Sous `cashless_app`, `INSERT`/`UPDATE` sur `edge_gateway`, `edge_sync_registry`, chaque table de 0060 à 0063 : refus.
3. Sous `cashless_edge`, `SELECT` sur n'importe quelle table, ou `post_transaction` : refus.
4. Sous `cashless_edgeadmin`, `set_edge_gateway_role` : refus.
5. Connexion réelle `cashless_app` : `post_transaction` en `EDGE_SYNC` refusé ; contrôle positif sous le propriétaire passe.
6. Fonctions exécutables par `PUBLIC` créées par 0058 à 0063 : aucune.
7. Rejouer `roles.sql` puis `post-roles.sql` deux fois : les listes ne changent pas.
8. Retirer un `REVOKE` : un test de la suite figée doit échouer.
