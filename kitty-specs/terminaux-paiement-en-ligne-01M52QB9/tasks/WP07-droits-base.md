---
work_package_id: WP07
title: "Droits de la base"
dependencies: [WP02, WP03, WP04, WP05, WP06]
requirement_refs: [FR-015, FR-021, FR-022, FR-023, FR-024, NFR-002, NFR-007, NFR-008, C-001, C-008, C-009, C-010]
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks: [T028, T029, T030, T031]
phase: "Phase 1 - Contrat et base de données"
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: implementer-ivan
role: implementer
agent: claude
authoritative_surface: packages/ledger-sql/
create_intent: [packages/ledger-sql/tests/tests_payment_rights.sql]
execution_mode: code_change
owned_files: [packages/ledger-sql/post-roles.sql, packages/ledger-sql/gen_tests.py, packages/ledger-sql/tests_grand_livre_cashless.sql, packages/ledger-sql/tests/tests_execute_grants.sql, packages/ledger-sql/tests/tests_device_rights.sql, packages/ledger-sql/tests/tests_payment_rights.sql]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 – Droits de la base

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis, dans
`kitty-specs/terminaux-paiement-en-ligne-01M52QB9/` : `contracts/database-rights.md` (en entier, fait foi pour les
retraits), `contracts/vendors.md` (« Limite consignée »), `contracts/qr-payments.md` (premier paragraphe),
`data-model.md` (tables nouvelles), `research.md` R-06, R-07, R-09 et R-11 (A12, A15, A20), `plan.md` IC-07, IC-09.
Dans `docs/` : `POINTS_OUVERTS.md` (OP-N76, OP-N75, OP-N69) et `DECISIONS_ADR.md` (ADR-121, ADR-101). Code réel :
`roles.sql` (kit, **intouchable**), `post-roles.sql` (sections 0, 1, 4a, 4b), `tests/tests_execute_grants.sql`,
`tests/tests_device_rights.sql`, et les migrations **fusionnées** 0031 à 0035 (signatures exactes, noms réels des
tables et des vues). Lis aussi les comptes rendus de WP02 à WP06 (points tranchés, fonctions ajoutées).

Règle §0.3 : en cas de contradiction entre sources, applique la priorité (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **signale-la**. Ne modifie jamais à la main un `.sql`
généré : `tests_grand_livre_cashless.sql` ne change que par `gen_tests.py` (puis `npm run check:generated -w
@cashless/ledger-sql`).

## Objective

Poser dans `post-roles.sql`, pour toute la mission, les retraits de droits de `cashless_app` et les fonctions qui lui
sont accordées nommément, et prouver chaque retrait et chaque accord par des listes exactes et des refus réels.

## Context

- `roles.sql` (kit) rend à chaque rejeu `SELECT, INSERT, UPDATE` sur **toutes** les tables et vues et `EXECUTE` sur
  toutes les fonctions ; `post-roles.sql` section 0 retire tout `EXECUTE` (`PUBLIC` et `cashless_app`), puis accorde
  nommément (4a). Une table nouvelle est donc ouverte en écriture tant que ce lot ne l'a pas fermée.
- A20 : un `REVOKE SELECT (colonne)` ne retire rien sur une table accordée en entier : `REVOKE SELECT ON TABLE` puis
  `GRANT SELECT (colonnes)`, liste calculée « toutes sauf » comme pour `media` et `device_enrollment_code`.
- A12 (renforcement, part d'OP-N69) : `cashless_app` perd `UPDATE (app_mode, nfc_enabled, event_id, pos_id,
  personal_phone)` sur `device` (aucun usage dans l'API ; contournement d'OP-N74 et de FR-015). Restent
  `station_name`, `last_seen_at`, `last_snapshot_version`, `next_seq_floor`.
- FR-021 à FR-023 (identification au guichet) : **reportées à la mission 10** (décision du porteur au plan). Ce lot
  n'en livre que la préparation (retrait des écritures directes ci-dessous) ; elles restent « Deferred » dans la
  matrice d'acceptation, jamais « pass ». Le rattachement à ce lot sert seulement au contrôle de couverture.
- R-07 / C-008 (renforcement) : `INSERT`, `UPDATE` retirés sur `kyc_verification`. R-06 (renforcement) :
  `payment_request` sans `INSERT`, `UPDATE`, ni lecture de `nonce_hash`.
- OP-N76 / ADR-121 (limite acceptée, dette nommée) : seul `cashless_app` exécute `begin_vendor_pin_check` et
  `open_vendor_session` ; le test échoue si un autre rôle (ou `PUBLIC`) les reçoit.
- Les suites pgTAP de WP02 à WP06 testent leurs fonctions en propriétaire ; ce lot prouve les droits et les chemins
  légitimes sous `SET ROLE cashless_app`. Dépendent de ce lot : WP09 à WP13 (sans accord, l'API reçoit `42501`).

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en
affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus
longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ;
continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot. Accorder une fonction ou
une colonne que le contrat ne nomme pas est un élargissement : à soumettre.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- Accorder aussi `payment_request_for_token` et `check_sale_lines` à `cashless_app` (liste figée mise à jour).
- Retirer `INSERT`/`UPDATE` sur `vendor_public` et toute vue créée par la mission ; test par liste exacte.
- `purge_device_enrollment_attempts()` garde sa signature (remplacée par WP02) : aucun accord nouveau.

## Branch Strategy

Planification et fusion sur `feat/terminaux-paiement-en-ligne`. Dépendances : WP02, WP03, WP04, WP05, WP06 (toutes
les migrations de la mission). Worktree attribué par lane (`lanes.json`). Commande :
`spec-kitty agent action implement WP07 --agent claude --mission terminaux-paiement-en-ligne-01M52QB9`.

## Subtasks

### T028 — Retraits de droits à `cashless_app`

Nouvelle section de `post-roles.sql` (« 6. Encaissement en ligne, mission 5b »), après la section 4b et **avant** la
section 5 si un ordre l'impose ; commentaires sur le modèle du fichier (raison, constat, sens). Idempotent.
- `vendor` : `REVOKE SELECT, INSERT, UPDATE` puis `GRANT SELECT` des colonnes calculées, toutes sauf `pin_hash`,
  `failed_attempts`, `locked_at`.
- Vue `vendor_public` : `REVOKE INSERT, UPDATE ON vendor_public` (une vue simple est modifiable et s'exécute avec les
  droits de son propriétaire : avec l'`INSERT`/`UPDATE` que `roles.sql` lui donne, `cashless_app` réécrirait
  `vendor`) ; `SELECT` gardé (seule lecture du statut « bloqué »). Même retrait pour toute autre vue créée par la
  mission (relève-les dans `pg_views` après 0035).
- `vendor_session`, `vendor_pin_check` : `REVOKE INSERT, UPDATE`.
- Catalogue (noms réels de 0032 : `catalog_category`, `catalog_item`, `catalog_version`, `catalog_version_item`,
  `point_of_sale_catalog_policy`, `device_catalog_served`) et `sale_line`, `sale_attribution`,
  `payment_request_detail` : `REVOKE INSERT, UPDATE`.
- `payment_request` : `REVOKE SELECT, INSERT, UPDATE`, puis `GRANT SELECT` calculé (toutes sauf `nonce_hash`).
- `kyc_verification` : `REVOKE INSERT, UPDATE`.
- `device` (section 4b) : réduire le `GRANT UPDATE` à `(station_name, last_snapshot_version, last_seen_at,
  next_seq_floor)`, avec le commentaire A12. Avant, prouve par `grep` dans `apps/api/src` (hors `*.spec.ts`)
  qu'aucune requête n'écrit les colonnes retirées, ni `kyc_verification`, ni `payment_request` ; note le résultat
  dans le compte rendu.
- `approval_token_use` : `INSERT` gardé (l'API y consomme les jetons, colonnes d'appelant terminal de WP04
  comprises) ; `UPDATE, DELETE, TRUNCATE` déjà retirés.
`DELETE` et `TRUNCATE` sont déjà retirés partout par `roles.sql` : ne pas les redire sauf besoin d'ordre.

### T029 — Fonctions accordées, `record_device_seq`, liste figée

- Ajouter à la liste nommée de la section 4a, avec un commentaire par famille, les **signatures exactes** relevées
  dans les migrations fusionnées (`\df` ou `pg_proc::regprocedure`) :
  - vendeurs : `create_vendor`, `set_vendor_pin`, `set_vendor_status`, `begin_vendor_pin_check`,
    `open_vendor_session`, `close_vendor_session`, `assert_vendor_session` ;
  - catalogue : les fonctions d'écriture de 0032, `record_device_catalog_served`, la lecture d'une version si c'est
    une fonction, `record_sale_lines` ;
  - paiement : `record_device_seq(uuid, bigint, bytea, text, text, uuid, text, uuid)` (schéma de référence, accordée
    pour la première fois), `assert_tap_payable`, `assert_wallet_payable`, `record_sale_attribution`,
    `assert_reversible` ; `consume_tap(bigint, uuid)` reste accordée (vérifie que sa signature n'a pas changé) ;
  - QR : `create_merchant_payment_request`, `lock_payment_request_for_pay`, `lock_customer_qr_token`,
    `confirm_payment_request`, `cancel_payment_request`, `create_customer_qr_token`, et la fonction de consultation
    par jeton **si** WP05 l'a créée sur décision de l'orchestrateur ;
  - terminaux : `set_device_status`, `create_device_enrollment_code`, `enroll_device` (remplacées par 0031 et 0035) :
    si une signature a changé, remplacer l'ancienne, jamais garder les deux.
- Ne pas accorder les fonctions internes (appelées seulement par des fonctions SECURITY DEFINER) : les nommer dans la
  liste « non exécutable » de `tests_execute_grants.sql`. Une fonction SECURITY INVOKER accordée exige aussi
  l'`EXECUTE` des fonctions qu'elle appelle (règle de l'en-tête 4a) : les recenser.
- Purge des essais de PIN (`vendor_pin_check`, `data-model.md`) : si WP02 a ajouté une fonction de purge, l'accorder
  comme les purges existantes (travailleur `device-purge`, même classe qu'OP-N75) **seulement** si elle ne supprime
  que des lignes expirées à l'heure de la base ; sinon, la soumettre.
- `tests/tests_execute_grants.sql` §2 : liste exacte de `cashless_app` mise à jour (ordre de tri `COLLATE "C"`
  conservé) ; listes des autres rôles **inchangées** ; ajouter aux refus les fonctions internes nouvelles.

### T030 — Tests de droits : listes exactes, refus, chemins légitimes

Nouvelle suite `tests/tests_payment_rights.sql` (en-tête sur le modèle de `tests_device_rights.sql` : `\ir
../roles.sql`, `\ir ../post-roles.sql`, `BEGIN … ROLLBACK`, prestataires A et B) :
- catalogue des droits : pour `vendor`, `vendor_public`, `vendor_session`, `vendor_pin_check`, chaque table du
  catalogue, `sale_line`, `sale_attribution`, `payment_request`, `payment_request_detail`, `kyc_verification`, liste
  **exacte** des colonnes lisibles, insérables et modifiables par `cashless_app` (vides pour l'écriture) ; aucun
  autre rôle `cashless_*` n'écrit dans ces tables ; aucun rôle `cashless_*` ne lit `vendor.pin_hash` ni
  `payment_request.nonce_hash` ;
- refus sous `SET LOCAL ROLE cashless_app` (`throws_ok … '42501'`) : `INSERT` et `UPDATE` directs sur chaque table,
  `UPDATE vendor_public`, `INSERT INTO vendor_public`, `SELECT pin_hash FROM vendor`, `SELECT * FROM vendor`,
  `SELECT nonce_hash FROM payment_request`, `SELECT * FROM payment_request`, `SELECT id FROM payment_request WHERE
  nonce_hash = …`, `INSERT INTO kyc_verification`, `UPDATE kyc_verification` ;
- chemins légitimes (`lives_ok`, même rôle) : lecture des colonnes permises de `vendor` et de `payment_request`,
  lecture de `vendor_public`, et un appel réel par famille de fonctions accordées (créer un vendeur, ouvrir une
  session par les deux transactions, écrire une version de catalogue, créer et annuler une demande QR, appeler
  `record_device_seq`) ;
- isolation : sous `cashless_app` et le prestataire A, `vendor_public` et chaque table nouvelle ne montrent aucune
  ligne de B (une vue s'exécute avec les droits de son propriétaire : la RLS forcée doit tenir).

### T031 — Bornes d'OP-N76 et `tests_device_rights.sql`

- Borne OP-N76 (dans `tests_payment_rights.sql`, nom de cas citant OP-N76 et ADR-121) : l'ensemble des rôles
  (`pg_roles`, plus `PUBLIC`) qui exécutent `begin_vendor_pin_check` et `open_vendor_session` est exactement
  `{cashless_app}`. Message d'échec qui renvoie à `docs/POINTS_OUVERTS.md` OP-N76.
- `tests_device_rights.sql` §1 : liste exacte des colonnes de `device` modifiables = `last_seen_at`,
  `last_snapshot_version`, `next_seq_floor`, `station_name` ; §2 : la liste `NOT IN` suit, de sorte que `app_mode`,
  `nfc_enabled`, `event_id`, `pos_id`, `personal_phone` reçoivent chacune leur refus `42501` ; témoin
  `station_name` inchangé. Commentaire : A12, part d'OP-N69 levée (mission 7 garde le reste).
- `gen_tests.py` et `tests_grand_livre_cashless.sql` : **aucun changement attendu** (la suite de référence tourne en
  propriétaire et avec ses propres rôles). Si un cas casse à cause des droits de ce lot, corrige le générateur, régénère
  (`python3 gen_tests.py`), vérifie `npm run check:generated -w @cashless/ledger-sql`, et consigne la raison ; jamais
  de retouche à la main du `.sql`.

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`,
`npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w
@cashless/api -- --runInBand` (prouve qu'aucun usage existant de l'API ne perd un droit utile ; les tests Jest qui
écrivent `device` le font en propriétaire). Jamais pgTAP sur une base où Jest vient de tourner (rejouer `reset-db`).
La base partagée appartient à l'orchestrateur : valide sur un cluster PostgreSQL 17 jetable dans le scratchpad, ou
demande à l'orchestrateur ; tests en série seulement. Dans un worktree de lane, crée d'abord les liens
`node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de la base Docker qui peut reculer : aucun
test ne compare l'heure de Node à `now()` sans marge. Rejouer deux fois `post-roles.sql` (idempotence : §4 de
`tests_execute_grants.sql`).

## Definition of Done

- `reset-db` puis toutes les suites pgTAP vertes, dont `tests_payment_rights.sql`, `tests_execute_grants.sql`,
  `tests_device_rights.sql`, `tests_definer_trigger_writers.sql` ; `check:generated` vert ; Jest vert.
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status Txxx --status done --mission
  terminaux-paiement-en-ligne-01M52QB9`.
- Compte rendu ajouté en fin de ce fichier : écarts au plan (sens ; les retraits de `device`, `kyc_verification`,
  `payment_request` et de la vue sont des renforcements), retouches hors carte (une ligne chacune), points soumis au
  porteur, résultat du `grep` des usages, **fichier à faire relire par une personne : `post-roles.sql`** (droits de la
  base), **critères couverts avec leur preuve** (fichier et nom du cas) : NFR-002 (empreinte illisible), NFR-007
  (isolation des tables nouvelles), NFR-008 (`nonce_hash` illisible), C-008, FR-024/FR-015 (réaffectation directe
  retirée), C-010 (borne OP-N76).

## Risks

- `REVOKE SELECT (colonne)` sans effet (A20) ; vue modifiable laissée en écriture ; liste calculée qui expose une
  colonne secrète ajoutée plus tard (la liste exacte des tests doit échouer).
- Fonction accordée oubliée : la route de l'API échoue en `42501`, traduit en `403 DEVICE_REVOKED` (trompeur) ;
  l'appel réel par famille l'attrape.
- Signature remplacée (0031, 0035) qui laisse l'ancienne accordée, ou fonction interne accordée par erreur.
- Retrait de `device` qui casse un usage réel : le `grep` et Jest le prouvent avant la fusion.

## Reviewer Guidance

Le relecteur distinct vérifie, refus par refus : chaque ligne du tableau de `contracts/database-rights.md` a son
retrait et son test ; `REVOKE` de table avant `GRANT` par colonne ; `vendor_public` sans `INSERT`/`UPDATE` ; aucune
fonction accordée hors de la liste du contrat (toute extra est justifiée et soumise) ; signatures égales à celles de
`pg_proc` ; listes des autres rôles inchangées ; borne OP-N76 exacte ; `device` réduit aux quatre colonnes ;
`roles.sql` et les `.sql` générés intacts ; le rejeu de `post-roles.sql` est idempotent.
