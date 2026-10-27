---
work_package_id: WP04
title: "Paiement, annulation, approbation sur place (migration 0033)"
dependencies: [WP02, WP03]
requirement_refs: [FR-006, FR-009, FR-010, FR-014, FR-016, FR-017, NFR-005, NFR-006, C-001, C-002, C-009]
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks: [T016, T017, T018, T019, T020]
phase: "Phase 1 - Contrat et base de données"
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: implementer-ivan
role: implementer
agent: claude
authoritative_surface: packages/ledger-sql/
create_intent: [packages/ledger-sql/migrations/0033_payments.sql, packages/ledger-sql/tests/tests_payments.sql]
execution_mode: code_change
owned_files: [packages/ledger-sql/migrations/0033_payments.sql, packages/ledger-sql/tests/tests_payments.sql]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 – Paiement, annulation, approbation sur place (migration 0033)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis, dans
`kitty-specs/terminaux-paiement-en-ligne-01M52QB9/` : `contracts/payments.md` (en entier), `contracts/vendors.md`
(« Garde de session », « Ordre global des verrous »), `data-model.md` (`sale_attribution`, `journal_transaction`,
`approval_token_use`, codes d'erreur), `research.md` R-05, R-06 et R-11 (constats A1, A5, A9, A11, A17, A18, A19),
`plan.md` IC-04, IC-05, IC-14. Code réel à lire : `migrations/0024_consume_tap_claim.sql`,
`migrations/0026_consume_tap_claim_definer.sql` (corps actuel de `consume_tap`), `migrations/0005_approvals.sql`
(`approval_token_use`), `migrations/0011_personalizer_role.sql` (dernière liste de `approval_request_action_check`),
`migrations/0023_device_tokens_nonces.sql` (`assert_device_active`, convention), `migrations/0021_definer_search_path.sql`
(règle du `search_path`), et dans `schema_grand_livre_cashless.sql` : `consume_tap`, `register_tap`, `post_transaction`,
`journal_transaction`, `wallet`, `media_tap`. Tables de WP02 (`vendor`, `vendor_session`) et WP03 (`sale_line`) : lis
`0031_vendors.sql` et `0032_catalog.sql` tels que fusionnés.

Règle §0.3 : en cas de contradiction entre sources, applique la priorité (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **signale-la** dans le compte rendu. Ne modifie jamais un
`.sql` généré de `packages/ledger-sql/` (`tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`).

## Objective

Donner à la base les contrôles du paiement et de l'annulation : attribution d'une vente par la session de vendeur,
lecture (`tap_id`) et portefeuille payables, `consume_tap` qui contrôle aussi le terminal, annulation unique et
contrôlée sur tous les chemins, appelant terminal pour le jeton d'approbation sur place, action `SALE_REVERSAL`.

## Context

- Exigences : FR-006 (attribution par le serveur), FR-009/FR-010 (un et deux temps), FR-014 (refus sans écriture),
  FR-016/FR-017 (annulation, `SUPERVISOR`), NFR-005 (une lecture, une annulation), NFR-006 (tout ou rien), C-001.
- Constats : A1 (bracelet bloqué payé par `tap_id`), A5 (fenêtre sur `recorded_at`, heure de la base), A9
  (`assert_reversible` partout, `SALE_REVERSAL`), A11 (vendeur retrouvé par la session), A17 (portefeuille relu
  `FOR SHARE`), A18 (terminal de la lecture contrôlé par la base), A19 (seconde annulation traduite par le nom de la
  contrainte). Décision `DM-01M5HRNBX5CTP7CAKN4JRCY3F9` (jeton sur place adapté au terminal ; back-office à deux).
- Dépendent de ce lot : WP05 (`record_sale_attribution` appelée par `confirm_payment_request`), WP07 (accords),
  WP11 (paiement), WP12 (annulation, `approval_token_use`). WP12 attend trois modes distincts d'`assert_reversible`.
- Ordre global des verrous : **terminal → vendeur → session de vendeur → demande QR → bracelet → portefeuille**. Le
  terminal est pris `FOR UPDATE` par `record_device_seq` (API) avant tout appel de ce lot.
- Convention : chaque fonction `SECURITY DEFINER` porte `SET search_path = public, pg_temp` (0021 ; un `CREATE OR
  REPLACE` efface le réglage) et est suivie de `REVOKE ALL ON FUNCTION <signature> FROM PUBLIC;` (comme 0022, 0023,
  0026). **Aucun `GRANT`** ici : les accords à `cashless_app` sont faits par WP07 dans `post-roles.sql`. Chaque
  lecture nomme le prestataire de la session (`assert_tenant` ou `operator_id = current_setting('app.operator_id')`).
- Nouvelle fonction de déclencheur : **pas de `SECURITY DEFINER`** (la liste exacte de
  `tests/tests_definer_trigger_writers.sql` §2 échouerait).

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en
affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus
longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ;
continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- SQLSTATE `CL038` → `MEDIA_BLOCKED`, `CL039` → `WALLET_BLOCKED` (traduits par WP08).
- Renforcement retenu : `assert_reversible` mode `SUPERVISOR_DEVICE` exige une ligne `approval_token_use` consommée dans la transaction, liée à la vente ; mode `BACKOFFICE` exige une demande `SALE_REVERSAL` approuvée pour cette vente. Aucun mode ne repose sur la seule parole de l'API.
- Renforcement retenu : annulation possible seulement en `LIVE` ou `CLOSING` (SPECIFICATION §12.1).
- Clé étrangère composite vers `vendor_session` et contrainte `UNIQUE (id, device_id, operator_id)` ajoutée par 0033 : retenu ; aucun déclencheur `SECURITY DEFINER`.
- `REVOKE ALL … FROM PUBLIC` reposé sur `consume_tap` remplacée.

## Branch Strategy

Planification et fusion sur `feat/terminaux-paiement-en-ligne`. Dépendances : WP02, WP03 (tables `vendor_session`,
`sale_line`). Worktree attribué par lane (`lanes.json`). Commande :
`spec-kitty agent action implement WP04 --agent claude --mission terminaux-paiement-en-ligne-01M52QB9`.

## Subtasks

### T016 — `sale_attribution` et `record_sale_attribution`

- Table `sale_attribution` : `transaction_id uuid PRIMARY KEY` (→ `journal_transaction`), `operator_id uuid NOT NULL`,
  `vendor_id uuid` (→ `vendor`), `vendor_session_id uuid` (→ `vendor_session`), `device_id uuid` (→ `device`),
  `channel text CHECK (channel IN ('NFC','MERCHANT_QR','CUSTOMER_QR'))`, `actor_user_id uuid` (`SUPERVISOR` ou auteur
  au back-office), `created_at timestamptz DEFAULT clock_timestamp()`. Contrainte : vendeur, session et terminal
  tous présents ou tous absents ; au moins une session ou un `actor_user_id`. RLS activée et forcée
  (`tenant_isolation`), déclencheur `forbid_mutation` (ajout seul).
- `record_sale_attribution(p_tx uuid, p_vendor_session uuid, p_channel text, p_actor_user uuid DEFAULT NULL)
  RETURNS void`, SECURITY DEFINER. Contrôles (refus `CL001` sauf mention) :
  - `p_tx` du prestataire de la session, de type `PURCHASE` ou `REVERSAL` ; sinon `no_data_found` (même erreur
    qu'inexistant) ;
  - avec `p_vendor_session` : session du même prestataire, `closed_at IS NULL`, `expires_at > clock_timestamp()`,
    `session.device_id = tx.device_id` ; sinon `CL032` ; vendeur et terminal **lus dans la session**, jamais reçus ;
  - sans session : `p_actor_user` obligatoire, `tx.source = 'BACKOFFICE'` et `tx.created_by = p_actor_user` ;
  - `PURCHASE` : `p_channel` obligatoire ; `REVERSAL` : canal recopié de l'attribution de la vente annulée
    (`p_channel` nul ou égal, sinon `CL001`) ;
  - seconde attribution de la même transaction : refus (clé primaire, laisser `23505`).

### T017 — `assert_tap_payable`, `consume_tap` remplacée, `assert_wallet_payable`

- `assert_tap_payable(p_tap bigint, p_device uuid) RETURNS TABLE(media_id uuid, wallet_id uuid)`, SECURITY DEFINER :
  prend d'abord le verrou consultatif de `consume_tap` (`pg_advisory_xact_lock(hashtextextended('media-tap-use:' ||
  p_tap::text, 0))`), puis lit la lecture du prestataire de la session. Lecture inconnue, d'un autre terminal
  (`media_tap.device_id <> p_device`), déjà consommée (`transaction_id` non nul ou `media_claim.confirmed_tap_id`),
  ou hors `tap_replay_window_seconds` de l'événement du terminal (`received_at` comparé à `clock_timestamp()`, même
  calcul que `consume_tap`) → `CL022` (`409 TAP_UNUSABLE`). Bracelet relu `FOR SHARE` : statut ≠ `ACTIVE` →
  refus `MEDIA_BLOCKED` (voir point à trancher ci-dessous). Rend le bracelet et son portefeuille.
- `assert_wallet_payable(p_wallet uuid) RETURNS void`, SECURITY DEFINER : portefeuille du prestataire relu `FOR SHARE` ;
  inconnu → `no_data_found` ; statut ≠ `ACTIVE` → refus `WALLET_BLOCKED`.
- **Point à trancher (avant de coder, à l'orchestrateur)** : `MEDIA_BLOCKED` et `WALLET_BLOCKED` n'ont **aucun
  SQLSTATE** dans `apps/api/src/errors/sqlstate-map.ts` (ils viennent aujourd'hui des résultats texte de
  `register_tap`). `data-model.md` ne leur en donne pas. Proposition : `CL038` → `422 MEDIA_BLOCKED`, `CL039` →
  `422 WALLET_BLOCKED` (traduction par WP08). Ne pas réutiliser `CL001` ni `CL020` (mauvais code renvoyé).
- `consume_tap(p_tap bigint, p_tx uuid)` remplacée (`CREATE OR REPLACE`, **même signature** : la suite de référence
  compte `consume_tap` dans `pg_proc` et la liste figée de `tests_execute_grants.sql` la nomme) : corps de 0026 **à
  l'identique** (verrou consultatif, `FOR UPDATE`, `assert_tenant`, prestataire, bracelet, rejeu de la même écriture,
  `CL022` si déjà utilisée, garde OP-N50 avec prestataire, fenêtre `ONLINE`), plus (A18) : si `tx.device_id` est non
  nul et différent de `media_tap.device_id` → `CL022`. Un `tx.device_id` nul garde le comportement actuel (écritures
  sans terminal de la suite de référence, `gen_tests.py` vers la ligne 905 ; vérifie aussi les appelants
  `deposit.controller.ts` et `cash-due.controller.ts`). `SET search_path = public, pg_temp` ; ajoute le
  `REVOKE ALL … FROM PUBLIC` que 0024/0026 n'avaient pas posé.

### T018 — Index `journal_transaction_reverses_once`, `assert_reversible`

- `CREATE UNIQUE INDEX journal_transaction_reverses_once ON journal_transaction (reverses_id) WHERE reverses_id IS
  NOT NULL;` Avant de l'écrire, vérifie qu'aucun scénario du kit n'annule deux fois une vente : `gen_tests.py`,
  `gen_golden.py`, `scenario_reference.json`, suites `tests/` (le `reset-db` suivi de toutes les suites le prouve).
  Si l'index casse un test du kit : **arrête-toi** et signale-le (fichiers générés intouchables).
- `assert_reversible(p_tx uuid, p_mode text, p_device uuid DEFAULT NULL, p_vendor_session uuid DEFAULT NULL)
  RETURNS TABLE(ledger_id uuid, event_id uuid, wallet_id uuid, media_id uuid)`, SECURITY DEFINER, `STABLE` interdit
  (elle verrouille). `p_mode IN ('VENDOR','SUPERVISOR_DEVICE','BACKOFFICE')`, sinon `CL001`. Contrôles communs (tous
  les modes, A9) : vente du prestataire de la session (sinon `no_data_found`, pas de fuite d'existence), type
  `PURCHASE` (sinon `CL036`), pas déjà annulée (`EXISTS … reverses_id = p_tx` → `CL035`), événement de la vente en
  `LIVE` ou `CLOSING` (matrice SPECIFICATION §12.1 : `REVERSAL` hors synchronisation refusée à partir de
  `RECONCILING` → `CL001` ; renforcement à consigner, le moteur le contrôle aussi). Heure : `clock_timestamp()`,
  jamais reçue.
  - `VENDOR` : `p_device` et `p_vendor_session` requis ; terminal de la vente = `p_device` ; session ouverte de ce
    terminal (relue `FOR SHARE`, ordre vendeur puis session) ; vendeur de la session = `sale_attribution.vendor_id`
    de la vente ; `clock_timestamp() <= tx.recorded_at + make_interval(mins => e.reversal_window_minutes)` (valeur
    lue au moment de l'annulation). Tout échec → `CL036`.
  - `SUPERVISOR_DEVICE` : `p_device` et `p_vendor_session` requis ; session ouverte de ce terminal ; terminal du
    **même événement** que la vente (`device.event_id = tx.event_id`). Vendeur et fenêtre non contrôlés.
  - `BACKOFFICE` : `p_device` et `p_vendor_session` nuls (sinon `CL001`).
  - Rend ce que le moteur doit relire pour écrire le `REVERSAL` (grand livre, événement, portefeuille, bracelet).
- **Point à trancher (renforcement proposé, à l'orchestrateur avant de coder)** : les modes `SUPERVISOR_DEVICE` et
  `BACKOFFICE` lèvent des contrôles sur la seule foi de l'API. Option : exiger en `SUPERVISOR_DEVICE` un `p_jti` dont
  la ligne `approval_token_use` porte ce terminal et cette session et `used_at >= now()` (consommée dans cette
  transaction), et en `BACKOFFICE` un `p_approval_request` `SALE_REVERSAL`, `APPROVED`, `target_id = p_tx`, du même
  prestataire (modèle : `media_reinstatement_approved`, 0017). Sans décision, coder la version du contrat.

### T019 — `approval_token_use` (appelant terminal), action `SALE_REVERSAL`

- `ALTER TABLE approval_token_use` : `caller_id DROP NOT NULL` ; colonnes `caller_device_id uuid`,
  `caller_vendor_session_id uuid` ; contrainte nommée `approval_token_use_one_caller` : soit `caller_id` seul, soit
  `caller_device_id` et `caller_vendor_session_id` ensemble (exactement un appelant). La contrainte
  `approval_token_use_distinct_people` reste telle quelle (elle vaut pour l'appelant personne ; un vendeur n'est pas
  une personne). Cohérence : session du terminal appelant et du même prestataire, par clé étrangère composite
  `(caller_vendor_session_id, caller_device_id, operator_id) → vendor_session (id, device_id, operator_id)` (ajoute
  la contrainte `UNIQUE (id, device_id, operator_id)` à `vendor_session` dans cette migration) ; pas de déclencheur
  `SECURITY DEFINER`. Ajout seul et RLS inchangés. L'insertion reste faite par l'API (`ON CONFLICT (jti) DO NOTHING`).
- `approval_request_action_check` : `DROP` puis `ADD` avec la liste de 0011 **recopiée à l'identique** plus
  `'SALE_REVERSAL'`. `approval_request_platform_scope` inchangée (l'action a toujours un prestataire).

### T020 — Suite `tests_payments.sql`

pgTAP écrit à la main, en propriétaire avec `app.operator_id` posé (pas de `SET ROLE cashless_app` : les accords
viennent de WP07), deux prestataires A et B, fixture sur le modèle de `tests/tests_consume_tap_claim.sql`. Un cas par
refus, chacun avec son témoin qui passe :
- attribution : vente attribuée au vendeur de la session (jamais à un vendeur reçu) ; session close, expirée, d'un
  autre terminal → `CL032` ; transaction d'un autre prestataire → `no_data_found` ; back-office sans auteur ou
  auteur ≠ `created_by` ; seconde attribution refusée ; ajout seul ; annulation : canal recopié ;
- `assert_tap_payable` : lecture d'un autre terminal, consommée, liée à une demande de rattachement, hors fenêtre →
  `CL022` ; bracelet `SUSPENDED`, `BLACKLISTED` → refus `MEDIA_BLOCKED` ; témoin ;
- `assert_wallet_payable` : `BLOCKED`, `CLOSED` → refus ; autre prestataire → `no_data_found` ;
- `consume_tap` : non-régression des cas de 0024/0026 ; écriture d'un autre terminal → `CL022` ; écriture sans terminal
  → comportement inchangé ;
- annulation : seconde annulation → violation de `journal_transaction_reverses_once` (vérifie le nom par
  `throws_ok` sur `23505` **et** le nom de l'index dans `pg_indexes`) ; `assert_reversible` mode par mode : autre
  vendeur, autre terminal, hors fenêtre (poser `recorded_at` en propriétaire) → `CL036` ; déjà annulée → `CL035` ;
  non `PURCHASE` → `CL036` ; événement `RECONCILING` → `CL001` ; `SUPERVISOR_DEVICE` : autre vendeur et hors fenêtre
  passent, terminal d'un autre événement refusé ; `BACKOFFICE` avec terminal → `CL001` ;
- `approval_token_use` : appelant terminal sans session, avec les deux appelants, session d'un autre terminal → refus ;
  appelant personne inchangé (`approver_id <> caller_id`) ; `SALE_REVERSAL` accepté, action inconnue refusée ;
- `search_path` et `PUBLIC` : chaque fonction nouvelle ou remplacée a `search_path=public, pg_temp` et aucun droit
  `PUBLIC` (après la seule migration, avant `post-roles.sql`).
Concurrence (NFR-005, deux connexions) : impossible en pgTAP seul ; laissée aux tests Jest de WP11, WP12 et WP14 —
le dire dans le compte rendu.

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`,
`npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w
@cashless/api -- --runInBand`. Jamais pgTAP sur une base où Jest vient de tourner (rejouer `reset-db`). La base
partagée appartient à l'orchestrateur : valide ton SQL sur un cluster PostgreSQL 17 jetable dans le scratchpad
(`initdb`, port libre, migrations puis `roles.sql` et `post-roles.sql`), ou demande à l'orchestrateur ; tests en série
seulement. Dans un worktree de lane, crée d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,
tag-format}`. Horloge de la base Docker qui peut reculer : aucun test ne compare l'heure de Node à `now()` sans marge.
Suites à garder vertes en plus de la tienne : `tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`,
`tests_consume_tap_claim.sql`, `tests_media_claim_tap.sql`, `tests_approvals.sql`, `tests_execute_grants.sql`,
`tests_definer_search_path.sql`, `tests_definer_trigger_writers.sql`.

## Definition of Done

- Migration `0033_payments.sql` rejouable par `reset-db` ; toutes les suites pgTAP vertes ; Jest vert (non-régression
  des dépôts, cautions dues, approbation sur place).
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status Txxx --status done --mission
  terminaux-paiement-en-ligne-01M52QB9`.
- Compte rendu ajouté en fin de ce fichier : écarts au plan (sens : renforcement ou non ; au moins l'état de
  l'événement dans `assert_reversible`, le verrou consultatif pris tôt, le `REVOKE` de `consume_tap`) ; retouches hors
  carte (une ligne chacune) ; points soumis au porteur ; décisions prises sur les deux points à trancher ; fichiers à
  faire relire par une personne (`0033_payments.sql`) ; **critères couverts avec leur preuve** (fichier et nom du
  cas) : FR-006, FR-010 (base), FR-016, FR-017 (base), NFR-005 (unicité par la base), NFR-006 (refus sans écriture).

## Risks

- `consume_tap` remplacée qui perd un contrôle de 0026 (verrou, OP-N50, prestataire, fenêtre) : comparer les deux
  corps ligne à ligne.
- Interblocage : `assert_tap_payable` et `assert_wallet_payable` après `record_device_seq` et `assert_vendor_session` ;
  jamais un `FOR UPDATE` sur le terminal après un `FOR SHARE` (voir l'en-tête d'`assert_device_active`, 0023).
- Fenêtre ancrée sur l'heure du terminal (A5) ; `now()` (début de transaction) contre `clock_timestamp()` : choisir
  `clock_timestamp()` comme `consume_tap`.
- Liste des actions de 0011 mal recopiée : une action existante disparaîtrait.

## Reviewer Guidance

Le relecteur distinct vérifie, refus par refus : vendeur jamais reçu de l'API ; `tx.device_id = session.device_id` ;
`assert_tap_payable` refuse bracelet bloqué, autre terminal, lecture consommée ou ancienne ; `consume_tap` garde tout
0026 et ajoute le terminal ; `assert_reversible` contrôle prestataire, `PURCHASE`, non annulée, état de l'événement
sur **tous** les modes, et `recorded_at` + fenêtre à l'heure de la base en mode `VENDOR` ; l'index porte le nom
`journal_transaction_reverses_once` ; `approval_token_use` : exactement un appelant, session du terminal appelant,
règle « deux personnes » intacte pour l'appelant personne ; liste des actions = 0011 + `SALE_REVERSAL` ;
`search_path` et `REVOKE … FROM PUBLIC` sur chaque fonction ; aucun `GRANT` ; aucun fichier généré modifié.

## Reports de l'orchestrateur (23/10/2026)

- ADR-123 (décision du porteur, 23/10) : `assert_reversible` contrôle d'abord terminal, vendeur, type `PURCHASE`,
  non annulée (`CL036` / `CL035`), et **seulement ensuite** la fenêtre : dépassée → nouveau `CL040` (au lieu de
  `CL036`). Tests : autre vendeur hors fenêtre → `CL036` (jamais `CL040`) ; bon vendeur hors fenêtre → `CL040` ;
  mode `SUPERVISOR` : fenêtre levée, donc jamais `CL040`.
- Reçu de WP03 (approuvé) : la clé de `device_catalog_served` est `(device_id, pos_id, version)` ; signatures de
  `check_sale_lines` / `record_sale_lines` inchangées.
