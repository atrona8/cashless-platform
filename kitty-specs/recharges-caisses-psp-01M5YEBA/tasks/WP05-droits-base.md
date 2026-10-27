---
work_package_id: WP05
title: Droits de la base
dependencies: [WP02, WP03, WP04]
requirement_refs: [C-004, NFR-005]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
subtasks: [T023, T024, T025, T026]
phase: Phase 1 - Contrat et base de données
agent: claude
model: sonnet
agent_profile: implementer-ivan
role: implementer
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
authoritative_surface: packages/ledger-sql/
execution_mode: code_change
owned_files: [packages/ledger-sql/post-roles.sql, packages/ledger-sql/tests/tests_execute_grants.sql, packages/ledger-sql/tests/tests_cash_psp_rights.sql]
create_intent: [packages/ledger-sql/tests/tests_cash_psp_rights.sql]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 – Droits de la base

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :
`spec.md` (C-004, NFR-005, NFR-003), `contracts/database-rights.md` (en entier), `data-model.md`
(toutes les tables et la section « Extensions »), `research.md` R-02 et **R-20** (A1, A6, A7, A8,
A9, A10, A24, A27), `research-adversarial.md` (A6, A9, A10, A24), `plan.md` IC-09. Code de référence
: `packages/ledger-sql/post-roles.sql` (sections 0, 4, 4b et surtout 6, modèle exact de ce lot),
`packages/ledger-sql/tests/tests_payment_rights.sql` (modèle de la suite de droits) et
`tests_execute_grants.sql` (listes figées). Puis les trois migrations de la mission, **déjà
fusionnées dans ta base** : `migrations/0036_cash_sessions.sql`, `0037_psp_configurations.sql`,
`0038_psp_topups.sql` : elles font foi sur les noms et signatures réels. En cas de contradiction
entre sources, applique la priorité de SPECIFICATION §0.3 (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **signale-la**. Ne modifie jamais un
`.sql` généré de `packages/ledger-sql/` (`schema_grand_livre_cashless.sql`, `tests_grand_livre_*`,
`scenario_reference_test.sql`) ; les migrations 0036 à 0038 sont à d'autres lots : ne les modifie
pas non plus.

## Objective

Fermer en écriture toutes les tables nouvelles de la mission pour `cashless_app`, retirer les
colonnes secrètes (`psp_configuration.secret_ref`, `psp_event.body`) à sa lecture, accorder
nommément les fonctions que l'API appelle, et figer le tout par des listes exactes qui échouent si
un droit s'élargit. Prouver par pgTAP l'isolation entre prestataires de chaque table nouvelle. Ce
lot ne crée aucune table ni fonction.

## Context

- IC-09 (plan), part « droits ». C-004 : `cashless_app` lit ce qu'il sert et n'écrit que par
  fonctions `SECURITY DEFINER` à `search_path` fixé. NFR-005 : aucune fuite entre prestataires.
- Pourquoi un lot à part : `roles.sql` (fichier du kit) rend `SELECT, INSERT, UPDATE` sur toutes les
  tables et `EXECUTE` sur toutes les fonctions à chaque rejeu ; `post-roles.sql` reprend ces droits
  ensuite. Une table de 0036 à 0038 reste ouverte en écriture tant que ce lot ne la ferme pas (cf.
  section 6 des lots de la 5b).
- Ce que ces lots t'ont laissé (à vérifier dans les migrations, pas dans ce texte) : WP02 ne fait
  que `REVOKE ALL ON FUNCTION … FROM PUBLIC` ; les accords à `cashless_app` et les retraits de table
  sont à toi.
- Constats : **A6** (`account_purpose_guard` : `current_user = 'cashless_app'`, donc il faut que
  `cashless_app` garde son `INSERT` sur `account` — ne le retire pas, la garde du déclencheur est la
  barrière), **A9** (fonctions de lecture neutre `psp_webhook_context`, `psp_poll_candidates`),
  **A10** (`secret_ref` non lisible), **A24** (`body` non lisible, `read_psp_event_body` audité),
  **A27** (aucune lecture du solde d'une caisse par un `CASHIER`, vérifiée côté API par WP08 ; ici
  la table `cash_session` n'a pas de colonne de solde lisible par un autre chemin que
  `expected_amount`, qui ne se remplit qu'à la fermeture).
- Ce qui dépend de ce lot : WP08 (sessions), WP10 (configurations), WP11 à WP13 : leurs tests
  d'intégration tournent sous `cashless_app` et échouent en `42501` si une fonction n'est pas
  accordée.

**Règle de sécurité du projet (`CLAUDE.md`)** : si un point de ce lot ne peut être tenu qu'en
affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux
gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le
risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte
rendu. Ce fichier (`post-roles.sql`) est à faire relire par une personne : l'agent qui l'écrit ne
vaut pas relecture indépendante.

## Arbitrages de l'orchestrateur (27/10/2026)

Ces points de R-20 priment sur tout texte antérieur et sur les « points à trancher » ci-dessous.

- **Écritures** : `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` retirés à `cashless_app` sur `cash_desk`,
  `cash_session`, `cash_session_count`, `cash_session_tx`, `psp_configuration`,
  `event_psp_selection`, `psp_topup`, `psp_event`, `psp_chargeback`, `psp_webhook_rejection`. Aucune
  colonne insérable ni modifiable (test par colonne).
- **Lectures par colonne** : `psp_configuration` lisible sans `secret_ref` ; `psp_event` lisible
  sans `body`. Technique de la 5b : `REVOKE SELECT` sur la table, puis `GRANT SELECT (liste calculée
  « toutes sauf »)` ; un `REVOKE SELECT (colonne)` ne retire rien sur une table accordée en entier.
  Tout le reste : `SELECT` sous RLS.
- **Liste des fonctions accordées** : celle de `contracts/database-rights.md`, **vérifiée contre les
  migrations**. Une fonction créée par 0036 à 0038 et absente de cette liste n'est accordée que si
  elle est appelée par l'API (WP08 à WP13) ; sinon elle reste interne et entre dans la liste « non
  exécutable ». Une fonction de la liste qui n'existe pas (nom différent) : ne devine pas,
  signale-le à l'orchestrateur. Les fonctions de déclencheur (`posting_cash_desk_guard`,
  `account_purpose_guard`, déclencheur du titulaire de `event_psp_selection`) ne sont **jamais**
  accordées à `cashless_app` (elles se déclenchent sans `EXECUTE`).
- **Anciennes signatures de caisse** : `take_deposit(uuid, uuid)`, `refund_deposit(uuid, uuid)` et
  `refund_cash_due(uuid, uuid, text, uuid, uuid, uuid)` restent accordées dans ce lot (WP09 fait
  encore appel à elles tant qu'il n'a pas basculé sur les variantes `…_for_session`). Ne les retire
  pas ici : ce retrait casserait les tests de la mission 4 avant que WP09 ne passe. Fige-les dans
  `tests_cash_psp_rights.sql` sous un test nommé `[A8-DETTE]` qui dit : « accordées jusqu'à WP09 ;
  WP09 retire ces trois signatures de `post-roles.sql` (retouche d'une ligne) et retourne ce test ».
  Signale-le dans le compte rendu : c'est un point de passation pour WP09.
- **Fonctions complémentaires de WP04 à accorder** : `mark_psp_event`, `psp_events_to_retry`,
  `purge_psp_event_bodies`, `attach_chargeback_tx` (appelées par WP12 et WP13) ; elles rejoignent la
  famille « recharges » / « contestations » du bloc de T025 et le test de la liste exacte. Les noms
  réels viennent de `0038` (si un nom diffère, ne devine pas : signale-le). Teste aussi la
  politique de lecture de `psp_webhook_rejection` (`operator_id IS NULL OR` prestataire courant) :
  une ligne sans prestataire est lisible, une ligne d'un autre prestataire ne l'est pas.
- **Décision du porteur du 27/10/2026 (`open_event_ledger`, option b)** : `open_event_ledger`
  reste inchangée ; `open_psp_accounts(uuid)` (WP03, `SECURITY DEFINER`, ne crée que les comptes
  `A-PSP-*`) n'est appelée que par d'autres fonctions de la base : elle n'est **pas** accordée à
  `cashless_app` (liste « non exécutable » de `tests_execute_grants.sql`, test nommé) sauf si une
  route d'API l'appelle directement, auquel cas accorde-la avec sa signature complète, dans la liste
  figée de `tests_execute_grants.sql`, et signale-le. `post-roles.sql` et
  `tests_cash_psp_rights.sql`
  restent à faire relire par une personne ; ajoute `0037` (`open_psp_accounts`) à cette demande.
- **Pas de `suspend_…`** : la suspension passe par `activate_psp_configuration(p_config, p_request)`
  (WP03) ; n'accorde aucune fonction de ce nom.
- **Aucun rôle autre que `cashless_app`** n'a de droit sur les tables nouvelles (ni
  `cashless_platform`, ni les rôles des clés, ni `PUBLIC`) : lecture comprise. Test par `pg_roles`
  (un rôle `cashless_*` futur est couvert).
- **Pas de fonction accordée à `PUBLIC`** : `tests_execute_grants.sql` §1 reste vert sans
  modification de sa logique.
- Le test d'isolation (T026) est écrit dans `tests_cash_psp_rights.sql` (c'est le seul fichier neuf
  du lot).

## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendances : WP02, WP03, WP04 (fusionnés
dans la base de ta lane). Worktree attribué par lane (`lanes.json`). Commande : `spec-kitty agent
action implement WP05 --agent claude --mission recharges-caisses-psp-01M5YEBA`. Base de validation :
`cashless_wp05` (`PGDATABASE=cashless_wp05 bash packages/ledger-sql/scripts/reset-db.sh`).
`cashless_test` est réservée à l'orchestrateur.

## Subtasks

### T023 — `post-roles.sql` : section 7 « Recharges, caisses et PSP » (droits de tables et de fonctions)

But : ajouter à la fin de `post-roles.sql` une section 7, rejouable (idempotente), sur le modèle de
la section 6.

1. Lis les trois migrations et dresse (dans ton brouillon, pas dans le dépôt) deux listes : tables
   créées, fonctions créées avec leur signature exacte (`\df+` sur ta base, ou `pg_proc` filtré sur
   les fonctions dont le propriétaire est le propriétaire des migrations et créées après `0035` :
   compare à `\df` d'une base à 0035).
2. Fonctions : ajoute à `post-roles.sql` un bloc `GRANT EXECUTE ON FUNCTION … TO cashless_app;`
   **séparé** de la section 4 (ne mélange pas les mêmes lignes avec celles de la 5b), commenté par
   famille : sessions de caisse (`open_cash_session`, `count_cash_session`, `begin_cash_close`,
   `finish_cash_close`, `attach_cash_tx`, `open_cash_due_anomaly`, `take_deposit_for_session`,
   `refund_deposit_for_session`, `refund_cash_due_for_session`) ; configurations
   (`create_psp_configuration`, `activate_psp_configuration`, `set_event_psp_selection`,
   `resolve_psp_configuration`, `psp_configuration_secret_ref`, `psp_webhook_context`) ; recharges
   (`create_psp_topup`, `mark_psp_topup_initiated`, `cancel_psp_topup`, `expire_psp_topups`,
   `psp_poll_candidates`, `record_psp_event`, `complete_psp_topup`, `fail_psp_topup`,
   `complete_card_topup`, `record_webhook_rejection`, `read_psp_event_body`, `card_topups_today`,
   `wallet_card_count`) ; contestations (`record_chargeback`, `block_wallet_after_chargeback`,
   `unblock_wallet`). Écris chaque signature complète (types des paramètres) comme dans la section
   4, par exemple `begin_cash_close(uuid, uuid)` selon la migration.
3. Fonctions internes jamais accordées (liste dans un commentaire) : celles que la migration marque
   comme helpers (par exemple un contrôle de rôle comme `device_admin_allowed` de la 5a) et les
   fonctions de déclencheur. **Précision du 27/10 (relecture de WP02)** : `roles.sql` accorde
   `EXECUTE` sur toutes les fonctions à `cashless_app` ; « jamais accordées » veut donc dire un
   `REVOKE EXECUTE … FROM cashless_app` explicite, au moins sur `cash_actor_allowed`,
   `cash_session_usable`, `cash_session_attach_own` et les fonctions de
   déclencheur de 0036 à 0038, avec un test pgTAP qui échoue si l'une redevient exécutable.
4. Tables : `REVOKE INSERT, UPDATE ON <les dix tables> FROM cashless_app;` (DELETE et TRUNCATE sont
   déjà retirés par `roles.sql`, redis-le dans un commentaire et ajoute-les au `REVOKE` pour ne pas
   dépendre de l'ordre).
5. Colonnes secrètes : blocs `DO $$ … $$` calculés comme `payment_request` (section 6d) : `REVOKE
   SELECT ON psp_configuration FROM cashless_app;` puis `GRANT SELECT (<toutes sauf secret_ref>)` ;
   idem `psp_event` sans `body`. Commente le risque conjuré : `secret_ref` désigne l'entrée du
   coffre du titulaire ; `body` est un corps authentifié contenant des données du payeur (A24).
6. Autres rôles : `cashless_platform` est remis à zéro et re-accordé nommément plus haut (section «
   rôle de base de la plateforme »). Vérifie qu'aucun de ses `GRANT` n'inclut une table nouvelle (il
   ne doit pas en lire) ; ne touche pas à ses accords. Les rôles des clés reçoivent des listes
   nommées : rien à ajouter.
7. Séquences : si une migration crée une séquence ou une colonne `bigint generated`, `roles.sql`
   accorde `USAGE, SELECT` sur toutes les séquences ; une table fermée en écriture n'a pas besoin
   d'`USAGE` côté `cashless_app` : retire-le seulement si une séquence est créée par 0036 à 0038
   (sinon, rien).
8. Tables existantes touchées par les migrations (`anomaly`, `account`, `fee_rule`,
   `approval_request`) : **ne change aucun de leurs droits**. Relève seulement, pour le compte
   rendu, si `cashless_app` y garde un `INSERT` direct (c'est le cas d'`anomaly` : `INSERT` hérité
   de `roles.sql`) et si le code de l'API (`grep -rn "INSERT INTO anomaly" apps/api/src`) s'en sert.
   Ne le retire pas dans ce lot ; consigne-le (constat pour la revue post-fusion).

Fichiers : `packages/ledger-sql/post-roles.sql`. Cas limites : une migration qui a mis `GRANT` à
`PUBLIC` sur une fonction (le reset de la section 0 le reprend, mais vérifie) ; un nom de colonne
ajouté après coup à `psp_event` (la liste calculée « toutes sauf `body` » l'accorde : la liste
exacte du test T025 le détecte).

Validation :
- [ ] `PGDATABASE=cashless_wp05 bash packages/ledger-sql/scripts/reset-db.sh` rejoue sans erreur
      (deux fois de suite).
- [ ] `SET ROLE cashless_app; SELECT secret_ref FROM psp_configuration;` et `SELECT body FROM
      psp_event;` : `42501`.
- [ ] Chaque fonction accordée a une signature exacte ; aucun `GRANT … ON ALL FUNCTIONS`.

### T024 — `tests_execute_grants.sql` : liste figée

But : la liste exacte des fonctions exécutables par `cashless_app` contient les nouvelles, et rien
d'autre.

1. Dans le `is(pg_temp.fns('cashless_app'), pg_temp.sigs(ARRAY[…]))` du §2, ajoute un bloc commenté
   « Mission 6, lot WP05 » avec les signatures courtes (types normalisés par `regprocedure`, comme
   `'begin_vendor_pin_check( uuid,uuid)'`), triées par famille. Reprends exactement les signatures
   de T023. Garde les lignes de 100 caractères (concaténation `||` comme dans le fichier).
2. Dans le bloc `NOT has_function_privilege('cashless_app', f, 'EXECUTE')` du §2, ajoute les
   fonctions internes de la mission : helpers de contrôle de rôle, fonctions de déclencheur
   (`posting_cash_desk_guard()`, `account_purpose_guard()`, déclencheur de `event_psp_selection`)
   avec leurs vraies signatures.
3. Les listes des autres rôles (`cashless_platform`, `cashless_tagkeys`, …) restent **inchangées** :
   le test les compare à l'identique, ce qui prouve qu'aucune fonction nouvelle ne leur a été
   accordée.
4. §4 (fonction créée à la main puis rejeu) : ne change rien ; il doit rester vert.
5. N'ajoute pas de test d'isolation ici ; ce fichier ne compte que des listes.

Cas limites : une fonction accordée en trop (par une migration) fait échouer la liste avec la
différence : corrige `post-roles.sql`, pas la liste, sauf si la fonction est réellement appelée par
l'API.

Validation :
- [ ] `pg_prove -d cashless_wp05 packages/ledger-sql/tests/tests_execute_grants.sql` vert.
- [ ] En retirant une signature de la liste (essai local), la suite échoue (prouve que la liste est
      contraignante).

### T025 — `tests_cash_psp_rights.sql` : aucune écriture directe, aucune création de caisse ni de compte PSP

But : suite pgTAP écrite à la main, sur le modèle de `tests_payment_rights.sql` (même en-tête :
transaction, rejeu de `roles.sql` et `post-roles.sql`, `no_plan()`, identifiants
`pg_temp.id('53…')`, prestataires A et B).

1. Données (propriétaire) : deux prestataires, organisateur, événement `LIVE` et grand livre par
   prestataire, terminal `TOPUP_DESK`, personne `CASHIER`/`SUPERVISOR`, configuration PSP, session
   de caisse, recharge PSP, notification, contestation, une ligne de **B** dans chaque table
   nouvelle. Crée-les par les **fonctions** de la mission sous `app.operator_id` (propriétaire), pas
   par `INSERT` direct, sauf ce que les fonctions ne couvrent pas (annote chaque `INSERT` direct «
   amorçage »). Témoin : chaque table nouvelle a au moins une ligne de B.
2. `pg_temp.tables()` = les dix tables nouvelles. Colonnes lisibles : liste exacte par table (comme
   1a de la 5b) : `psp_configuration` sans `secret_ref`, `psp_event` sans `body`, les autres
   complètes. Une colonne ajoutée plus tard fait échouer la liste.
3. Écriture : aucune colonne insérable ni modifiable (`has_column_privilege`), aucun droit de table
   `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`. Aucun autre rôle `cashless_*` ni `PUBLIC` ne lit ni
   n'écrit ces tables (comme 1c).
4. Refus réels sous `SET LOCAL ROLE cashless_app` : `INSERT INTO <t> DEFAULT VALUES` et `UPDATE <t>
   SET operator_id = operator_id` : `throws_ok(…, '42501')` pour chaque table ; en plus : `UPDATE
   cash_session SET status = 'CLOSED'`, `UPDATE psp_topup SET status = 'SUCCEEDED'`, `UPDATE
   psp_configuration SET status = 'ACTIVE'`, `INSERT INTO event_psp_selection …`, `SELECT secret_ref
   FROM psp_configuration`, `SELECT * FROM psp_event`, `SELECT body FROM psp_event`.
5. **A6** : sous `cashless_app`, `INSERT INTO account` d'un compte `purpose = 'CASH_DESK'` puis
   `'PSP'` (grand livre du prestataire, code `A-CAISSE-X`, `A-PSP-X`) : refusés par
   `account_purpose_guard` (SQLSTATE de la migration ; lis-le dans 0036) ; un compte `purpose =
   'TRANSIT'` ou tout autre but du schéma : accepté (la garde n'est pas trop large : sinon les
   ouvertures de grand livre cassent). La création par `open_cash_session` (fonction `SECURITY
   DEFINER`, propriétaire) réussit : la garde ne bloque pas le chemin légitime.
6. **A7** : un `set_config('app.cash_closing', …)` ou toute variable de session forgée sous
   `cashless_app` n'ouvre pas la garde de caisse : insère (via `post_transaction`) une écriture sur
   une caisse inscrite sans session `OPEN` avec la variable posée : refusée. Le nom de la variable
   que la migration ne lit pas : une valeur quelconque suffit.
7. Chemins légitimes sous `cashless_app` : un appel réel par famille (`open_cash_session`,
   `count_cash_session`, `create_psp_configuration`, `resolve_psp_configuration`,
   `create_psp_topup`, `record_psp_event`, `psp_poll_candidates`, `record_webhook_rejection`) avec
   `app.operator_id` posé ; chacun réussit et ne touche que le prestataire courant.
8. `[A8-DETTE]` : les trois anciennes signatures sont encore exécutables (voir « Arbitrages »), test
   nommé.

Cas limites : `record_webhook_rejection` est le seul écrivain d'une table lisible sans RLS de
prestataire (la configuration peut être `NULL`) : prouve qu'un compteur n'est borné que par minute
(appelle-le deux fois : une ligne, `count = 2`) et qu'une `psp_configuration_id` d'un autre
prestataire est refusée ou ignorée comme la migration le dit.

Validation :
- [ ] `pg_prove -d cashless_wp05 packages/ledger-sql/tests/tests_cash_psp_rights.sql` vert, sans
      `no_plan` oublié.
- [ ] Les lignes font au plus 100 caractères ; aucun identifiant ne recoupe ceux d'une autre suite
      (préfixe `53`).

### T026 — Isolation RLS des nouvelles tables entre prestataires (pgTAP)

But : prouver, dans `tests_cash_psp_rights.sql`, qu'un prestataire ne lit aucune ligne de l'autre et
n'agit sur aucune.

1. Pour chacune des dix tables, sous `SET LOCAL ROLE cashless_app` avec `app.operator_id = A` :
   `SELECT count(*) FROM <t> WHERE operator_id = <B>` vaut 0 ; avec `app.operator_id = B` la même
   requête vaut ≥ 1 (le témoin n'est pas vide). Pour les tables sans colonne `operator_id` propre,
   lis `data-model.md` : toutes en portent une.
2. RLS forcée : `relrowsecurity` et `relforcerowsecurity` vrais pour les dix tables (catalogue),
   politique `tenant_isolation` présente (nom exact : lis-le dans les migrations, la 5b disait
   `tenant_isolation`).
3. Fonctions : avec `app.operator_id = A`, appelle chaque fonction qui prend un identifiant d'un
   objet de B (session, configuration, recharge, notification, contestation, portefeuille) et
   vérifie qu'elle échoue en `P0002`/`42501` (comme la migration le prévoit via `assert_tenant`)
   sans rien changer : compare les comptes de lignes de B avant et après. Au moins :
   `count_cash_session`, `begin_cash_close`, `create_psp_topup` (portefeuille de B),
   `activate_psp_configuration`, `set_event_psp_selection` (événement de B),
   `mark_psp_topup_initiated`, `cancel_psp_topup`, `record_chargeback`, `unblock_wallet`,
   `psp_configuration_secret_ref`, `read_psp_event_body`, `mark_psp_event`, `attach_chargeback_tx`.
4. Sans `app.operator_id` posé (`RESET`) : `SELECT count(*)` renvoie 0 pour chaque table, et les
   fonctions échouent (jamais de lecture « de tous »).
5. **Cloisonnement de l'organisateur** (même prestataire, autre organisateur) : la base ne le
   garantit que là où la migration le dit (choix par événement, configuration par organisateur).
   Teste ces deux-là ; le reste du cloisonnement par organisateur est du ressort de l'API (WP10 à
   WP13) et ne se teste pas ici.

Validation :
- [ ] Aucune table nouvelle sans ligne de B dans le témoin ; aucune fuite constatée.
- [ ] Batterie complète : `npm run reset-db -w @cashless/ledger-sql` puis `npm run test:pgtap` (avec
      `PGDATABASE=cashless_wp05`) vert, y compris les suites de référence générées, les suites de
      0031 à 0035 et les trois suites de WP02 à WP04.

## Test Strategy

- pgTAP seulement, sur ta base `cashless_wp05` (jamais `cashless_test`, réservée à l'orchestrateur ;
  tests en série par l'orchestrateur). Commandes : `PGDATABASE=cashless_wp05 bash
  packages/ledger-sql/scripts/reset-db.sh`, puis `pg_prove -d cashless_wp05
  packages/ledger-sql/tests/tests_cash_psp_rights.sql
  packages/ledger-sql/tests/tests_execute_grants.sql`, puis la batterie `test:pgtap`.
- pgTAP échoue sur une base où Jest vient de tourner : refais `reset-db` avant.
- Jest : un seul contrôle, `npx jest transverse/migrate-rights` dans `apps/api` (rejeu des droits
  par `migrate.ts` dans une transaction) : il doit rester vert avec les migrations 0036 à 0038.
- Horloge Docker : aucune comparaison d'heure Node/base dans les tests de ce lot.

## Definition of Done

- [ ] Les dix tables fermées en écriture ; `secret_ref` et `body` illisibles ; fonctions accordées
      par signature.
- [ ] `tests_execute_grants.sql` (liste figée) et `tests_cash_psp_rights.sql` verts ; batterie pgTAP
      complète verte.
- [ ] `transverse/migrate-rights.spec.ts` vert.
- [ ] Aucun `.sql` généré modifié ; aucune migration modifiée ; lignes de 100 caractères au plus.
- [ ] Matrice d'acceptation : C-004 et NFR-005 passés à `pass` avec commande et résultat dans le
      compte rendu.
- [ ] Compte rendu du lot : écarts au plan avec leur sens ; retouches hors carte justifiées ; points
      soumis au porteur ; **fichiers à faire relire par une personne** (`post-roles.sql`,
      `tests_cash_psp_rights.sql`) ; critères couverts avec preuve ; constat sur l'`INSERT` direct
      d'`anomaly` ; point de passation `[A8-DETTE]` pour WP09 ; toute fonction de la liste du
      contrat introuvable ou ajoutée.

## Risks

- Un `GRANT` sur une signature erronée échoue au rejeu (erreur franche) mais un `GRANT` sur une
  fonction surchargée peut en accorder deux : vérifie par la liste exacte, pas par le nom.
- Liste « toutes sauf » : une colonne secrète ajoutée plus tard serait accordée d'office. La liste
  exacte de T025 est la seule barrière : écris-la complète.
- `account_purpose_guard` repose sur `current_user` : une fonction `SECURITY DEFINER` s'exécute sous
  le propriétaire, `cashless_app` direct est refusé. Ne mets pas `SECURITY DEFINER` sur une fonction
  de test.
- Ordre de `post-roles.sql` : le reset de la section 0 retire tout avant les accords ; ta section 7
  doit venir après la section 6 et rester rejouable.

## Reviewer Guidance

Tente de casser : (1) un `INSERT`/`UPDATE` direct sur chaque table sous `cashless_app` ; (2) la
lecture de `secret_ref` et `body` par colonne, par `SELECT *`, par ligne composite (`SELECT t FROM
psp_configuration t`) et par fonction de lecture ; (3) l'exécution d'une fonction interne ou de
déclencheur ; (4) un rôle `cashless_*` ou `PUBLIC` qui lit une table nouvelle ; (5) l'isolation avec
`app.operator_id` absent ou celui de l'autre prestataire ; (6) un test qui passe parce que la donnée
de B est absente (témoin vide) ; (7) une liste figée qu'on peut élargir sans faire échouer la suite
; (8) la persistance de l'accord sur les anciennes signatures de caisse sans test nommé. Vérifie que
le compte rendu signale `post-roles.sql` comme fichier à relire par une personne.
