---
work_package_id: WP02
title: 'Base : sessions de caisse et gardes (migration 0036)'
dependencies: []
requirement_refs: [FR-001, FR-002, FR-003, FR-004, FR-006, NFR-007, NFR-008, C-002, C-004]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-recharges-caisses-psp-01M5YEBA
base_commit: f08f0633253e27c8d25e349d7968b00884526825
created_at: '2026-10-27T12:28:20.056070+00:00'
subtasks: [T005, T006, T007, T008, T009, T010]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/
create_intent: [packages/ledger-sql/migrations/0036_cash_sessions.sql, packages/ledger-sql/tests/tests_cash_sessions.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0036_cash_sessions.sql, packages/ledger-sql/tests/tests_cash_sessions.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 – Base : sessions de caisse et gardes (migration 0036)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement : `spec.md` (FR-001 à FR-004, FR-006, NFR-007, NFR-008,
C-002, C-004), `data-model.md` (sections `cash_session`, `cash_desk`, `cash_session_count`,
`cash_session_tx`), `research.md` R-01 à R-03, R-05 et **R-20 (fait foi, bloc « Caisses »)**,
`research-adversarial.md` (A1, A6, A7, A8, A21, A26, A27), `contracts/cash.md` (règles 1 à 6,
écritures), `contracts/database-rights.md` (garde de caisse, fonctions). Code de référence :
`packages/ledger-sql/migrations/0031_vendors.sql` (style : en-tête, `search_path`, RLS forcée,
`REVOKE ALL … FROM PUBLIC`), `0023_device_tokens_nonces.sql` (`assert_device_active`),
`0021_definer_search_path.sql` (règle du `search_path`), `0008_event_ledger.sql` (plan de comptes),
`schema_grand_livre_cashless.sql` (`post_transaction` : verrou des soldes non chauds AVANT
l'insertion des lignes ; `take_deposit`, `refund_deposit`, `refund_cash_due`, `anomaly`, `account`,
`assert_tenant`). En cas de contradiction entre sources, applique la priorité de SPECIFICATION §0.3
(tests exécutables > schéma SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et
**signale-la** ; ne choisis pas en silence. Ne modifie jamais un `.sql` généré de
`packages/ledger-sql/` (le schéma de référence, `scenario_reference_test.sql`,
`tests_grand_livre_cashless.sql` ne bougent pas).

## Objective

Créer en base ce qui rend impossible tout mouvement d'espèces hors session : le registre des
caisses, les sessions, les comptages à l'aveugle, le rattachement des transactions, la fermeture en
deux temps avec verrou du solde, la garde sur `posting`, la garde de création des comptes
`CASH_DESK`/`PSP`, les variantes `…_for_session` et la fonction d'anomalie des espèces dues. L'API
(WP08, WP09) n'ajoute que l'authentification et l'audit (C-004).

## Context

- IC-01 du plan. Constats : A1 (garde limitée aux caisses inscrites), A6 (création de compte), A7
  (aucune variable de session ne rouvre la garde), A8 (terminal de l'écriture), A21 (lecture sans
  verrou + verrou du solde), A26 (au plus 10 comptages, fermeur sans comptage), A27 (aucun solde de
  caisse lisible par un `CASHIER`).
- Ordre global des verrous de la 5b : terminal → vendeur → session de vendeur → demande QR →
  bracelet → portefeuille. Cette migration y ajoute : **session de caisse → solde du compte de
  caisse** (un solde est pris après la session, jamais avant) ; les variantes `…_for_session` lisent
  la session sans la verrouiller.
- Pourquoi la lecture sans verrou de la garde est sûre : `post_transaction` verrouille les soldes
  non chauds (`ORDER BY account_id FOR UPDATE`) AVANT d'insérer les lignes ; en `READ COMMITTED`
  chaque instruction du déclencheur voit l'état validé après l'attente. Si `begin_cash_close` tient
  le solde, une écriture concurrente attend, puis la garde voit `CLOSING`/`CLOSED` et refuse. Le
  test (T010) le prouve en séquence ; la concurrence à deux connexions est prouvée par WP14 (T071).
- Ce qui dépend de ce lot : WP05 (droits : liste des fonctions ci-dessous), WP06
  (`open_cash_due_anomaly`), WP08 (routes de session), WP09 (`attach_cash_tx`, variantes
  `…_for_session`, `open_cash_session`).
- **Hypothèse sur le propriétaire** (comme 0022) : aucune fonction ne s'appuie sur la RLS ; chaque
  lecture et chaque écriture nomment le prestataire de la session (`app.operator_id`, absent :
  `P0002`).
- Droits : la migration fait `REVOKE ALL ON FUNCTION … FROM PUBLIC` sur chaque fonction et rien
  d'autre ; les accords à `cashless_app` et les retraits d'écriture sur les tables sont faits par
  WP05 (`post-roles.sql`).

**Règle de sécurité du projet (`CLAUDE.md`, règle 1)** : si un point de ce lot ne peut être tenu
qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
faux gardé), **arrête- toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et
les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu.
Aucun faux en production. Aucune nouvelle dépendance npm (R-18). Cette migration et `post-roles.sql`
sont à faire relire par une personne.

## Arbitrages de l'orchestrateur (27/10/2026)

Ces points de R-20 priment sur tout texte antérieur (data-model, contrats, R-01 à R-03).

- **Fonctions de fermeture** : `begin_cash_close` puis `finish_cash_close` (pas de
  `close_cash_session`, nom de R-03 abandonné par R-20). Les deux sont appelées par l'API dans UNE
  transaction ; entre elles l'API écrit `CASH_CLOSE` par le moteur. Un état `CLOSING` n'est donc
  jamais visible d'une autre transaction.
- **Garde de caisse** : ne vaut que pour les comptes inscrits dans `cash_desk` (A1) ; vaut pour
  toutes les sources (A17 : la mission 7 définira la session hors ligne). Elle ne lit aucune
  variable de session (A7).
- **Refus sans session** : `CL029` (`409 CONFLICT_STATE`, message d'ADR-89). Aucun code
  `CASH_SESSION_REQUIRED`.
- **Codes d'erreur** (liste de l'en-tête de la migration, à reprendre mot pour mot) : `CL001`
  paramètre invalide ; `CL029` conflit d'état, garde de caisse, session absente ou non ouverte,
  doublon d'ouverture, 11e comptage, fermeture sans comptage ; **`CL041` nouveau** : fermeur auteur
  d'un comptage de la session (API : `403 FORBIDDEN`) ; `CL030` et `42501` (via
  `assert_device_active`) ; `CL027` mode du terminal ; `P0002` introuvable, autre prestataire ou
  personne hors périmètre. Le mappage TypeScript (`sqlstate-map.ts`) appartient à WP07 : ne le
  touche pas, dis-le dans le compte rendu.
- **Renforcements consignés** (à lister dans le compte rendu) : la garde refuse aussi une
  transaction `CASH_CLOSE` sur une session `OPEN` (la fermeture passe seulement par `CLOSING`) ;
  `account_purpose_guard` couvre aussi `UPDATE OF purpose` ; les variantes `…_for_session`
  rattachent elles-mêmes leur transaction.
- **`account_purpose_guard` est `SECURITY INVOKER`** (avec `search_path` fixé) : sous `SECURITY
  DEFINER`, `current_user` serait le propriétaire et la garde ne se déclencherait jamais. Cela
  contredit la phrase « fonction du déclencheur SECURITY DEFINER » de `contracts/database-rights.md`
  ; la contradiction est à signaler (§0.3). `posting_cash_desk_guard` reste `SECURITY DEFINER`.
  C'est un **renforcement** par rapport à `database-rights.md` (la garde reste effective) : à
  consigner comme tel dans le compte rendu et dans l'ADR du lot, pas comme un écart.
- **Grand livre acceptant l'ouverture** : événement `LIVE` ou `CLOSING` ET grand livre non `LOCKED`
  (`ledger.status` vaut `OPEN`/`CLOSING`/`LOCKED` ; le « `LIVE` » du data-model désigne le statut de
  l'événement).
- **Ce lot ne contient aucun `GRANT` ni `REVOKE` de table**, et ne touche pas `post-roles.sql`.

## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendances : aucune. Worktree attribué
par lane (`lanes.json`). Commande : `spec-kitty agent action implement WP02 --agent claude --mission
recharges-caisses-psp-01M5YEBA`.

## Subtasks

### T005 — Tables `cash_desk`, `cash_session`, `cash_session_count`, `cash_session_tx`

But : le modèle de `data-model.md`, avec toutes les contraintes portées par la base.

1. En-tête de la migration (modèle 0031) : contenu numéroté, tableau des fonctions avec leur rôle et
   si elles sont INTERNES (jamais accordées), tableau des codes d'erreur, ordre des verrous,
   hypothèse sur le propriétaire.
2. `cash_desk(account_id uuid PRIMARY KEY REFERENCES account(id), operator_id uuid NOT NULL
   REFERENCES party(id), device_id uuid NOT NULL UNIQUE REFERENCES device(id), ledger_id uuid NOT
   NULL REFERENCES ledger(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp())`. Clé
   étrangère composite `(ledger_id, account_id) → account(ledger_id, id)`.
3. `cash_session` : colonnes exactes de `data-model.md` (`cash_session_id` PK, `operator_id`,
   `ledger_id`, `event_id`, `device_id`, `cash_account_id`, `opened_by`, `opened_at`, `status`,
   `closed_by`, `closed_at`, `counted_amount`, `expected_amount`, `close_tx_id`,
   `cash_diff_anomaly_id`). Contraintes nommées : `status IN ('OPEN','CLOSING','CLOSED')` ; clé
   composite `(ledger_id, cash_account_id)` vers `account` ; `CHECK (status = 'OPEN' OR
   (counted_amount IS NOT NULL AND expected_amount IS NOT NULL AND closed_by IS NOT NULL))` ; `CHECK
   (status <> 'CLOSED' OR closed_at IS NOT NULL)` ; `CHECK (counted_amount >= 0)` ; `CHECK ((status
   <> 'CLOSED') OR ((counted_amount <> expected_amount) = (cash_diff_anomaly_id IS NOT NULL)))` ;
   `CHECK ((status <> 'CLOSED') OR (close_tx_id IS NOT NULL) OR (counted_amount = 0 AND
   expected_amount = 0))`. `closed_by` est posé par `begin_cash_close` (le fermeur) ; `closed_at`
   par `finish_cash_close`.
4. Index uniques partiels : `cash_session_open_per_account ON (cash_account_id) WHERE status IN
   ('OPEN','CLOSING')` et `cash_session_open_per_device ON (device_id) WHERE status IN
   ('OPEN','CLOSING')`. Index `(operator_id, event_id, opened_at)` pour la liste.
5. `cash_session_count(cash_session_id uuid REFERENCES cash_session, count_no int, counted_amount
   bigint NOT NULL CHECK (counted_amount >= 0), counted_by uuid NOT NULL, counted_at timestamptz NOT
   NULL DEFAULT clock_timestamp(), note text CHECK (note IS NULL OR length(note) <= 200),
   operator_id uuid NOT NULL, PRIMARY KEY (cash_session_id, count_no), CHECK (count_no BETWEEN 1 AND
   10))`.
6. `cash_session_tx(cash_session_id uuid REFERENCES cash_session, tx_id uuid NOT NULL UNIQUE
   REFERENCES journal_transaction(id), operator_id uuid NOT NULL, attached_at timestamptz NOT NULL
   DEFAULT clock_timestamp(), PRIMARY KEY (cash_session_id, tx_id))`.
7. RLS activée et forcée sur les quatre tables, politique `tenant_isolation` (boucle `DO` de 0031).
8. Cas limites : `cash_session` n'a AUCUNE colonne portant le solde avant la fermeture (A27) ;
   `expected_amount` n'est rempli qu'à `begin_cash_close`. Ne crée ni vue ni colonne calculée du
   solde de caisse.

Validation :
- [ ] Les quatre tables existent, RLS forcée ; deux sessions `OPEN` sur une même caisse ou un même
      terminal refusées par l'index (`23505`) ; 11e comptage refusé par le `CHECK` ; une session
      `CLOSED` incohérente (écart sans anomalie, `close_tx_id` nul avec théorique non nul) refusée
      par les `CHECK`.
- [ ] `SELECT ... FROM information_schema.columns` : aucune colonne de solde courant dans
      `cash_session`.

### T006 — `open_cash_session`, `count_cash_session`

Toutes `SECURITY DEFINER SET search_path = public, pg_temp`, prestataire = `app.operator_id`, heure
= `clock_timestamp()`.

1. Helper INTERNE `cash_actor_allowed(p_operator uuid, p_event uuid, p_actor uuid, p_roles text[])
   RETURNS boolean` (STABLE) : personne `ACTIVE` du prestataire, attribution non révoquée, rôle dans
   `p_roles` avec `scope_type = 'EVENT'` et `scope_id = p_event`, ou `scope_type = 'ORGANIZER'` et
   `scope_id = organisateur de l'événement`. Modèle : `vendor_admin_allowed` (0031). Jamais
   accordée.
2. `open_cash_session(p_device uuid, p_actor uuid) RETURNS TABLE (cash_session_id uuid,
   cash_account_id uuid, account_code text, ledger_id uuid, event_id uuid)` :
   a. `PERFORM assert_device_active(p_device)` (prend le terminal `FOR SHARE` ; révoqué `42501`,
      suspendu `CL030`) ;
   b. terminal du prestataire, `app_mode = 'TOPUP_DESK'` sinon `CL027`, `event_id` non nul sinon
      `CL027` ;
   c. événement `LIVE` ou `CLOSING` sinon `CL029` ; grand livre de l'événement (`scope_type =
      'EVENT'`, `scope_id`, devise de l'événement) non `LOCKED` ; personne autorisée (`CASHIER` ou
      `SUPERVISOR`) sinon `P0002` ;
   d. compte `A-CAISSE-<device.serial>` : lecture par `(ledger_id, code)` ; absent → `INSERT INTO
      account` (famille `ASSET`, but `CASH_DESK`, titulaire = `ledger.funds_holder_id`, côté `D`,
      `allow_negative = false`, `hot = false`) ; existant : doit être `ASSET`/`CASH_DESK`, sinon
      `CL029` ; ligne `account_balance` créée si absente (`ON CONFLICT DO NOTHING`) ;
   e. inscription dans `cash_desk` si le compte n'y est pas (`device_id` identique) ; inscrit pour
      un AUTRE terminal : `CL029`. Un compte posé à la main avant la première session (cas des tests
      de la mission 4) devient ainsi soumis à la garde dès cette ouverture : comportement voulu, à
      consigner ;
   f. aucune session `OPEN`/`CLOSING` pour ce compte ni ce terminal (pré-contrôle puis, en filet,
      capture de `unique_violation` → `CL029`) ; insertion `OPEN` avec `opened_by = p_actor` ;
   g. rend la ligne. **Aucune écriture au grand livre.**
3. `count_cash_session(p_session uuid, p_amount bigint, p_actor uuid, p_device uuid DEFAULT NULL,
   p_note text DEFAULT NULL) RETURNS int` : session du prestataire `FOR UPDATE` (absente `P0002`) ;
   statut `OPEN` sinon `CL029` ; `p_device` non nul doit être le terminal de la session sinon
   `P0002` ; personne `CASHIER`/`SUPERVISOR` de l'événement sinon `P0002` ; `p_amount >= 0` sinon
   `CL001` ; `p_note` rangée sans blancs de bord (≤ 200) ; numéro = max + 1, au plus 10 sinon
   `CL029` (A26). Rend UNIQUEMENT le numéro du comptage : jamais le théorique, jamais l'écart
   (comptage à l'aveugle, FR-002).
4. Cas limites : terminal `SUSPENDED` à l'ouverture refusé (`CL030`) ; comptage depuis un autre
   terminal que celui de la session refusé ; deux ouvertures simultanées du même terminal : une
   seule passe (index unique).

Validation :
- [ ] Ouverture : compte `A-CAISSE-<série>` créé, `cash_desk` rempli, session `OPEN`, zéro
      `journal_transaction`.
- [ ] Refus : terminal d'un autre mode, d'un autre prestataire, suspendu, révoqué ; événement
      `DRAFT` ou `CLOSED` ; grand livre `LOCKED` ; personne sans rôle ou d'un autre événement ;
      seconde ouverture.
- [ ] `count_cash_session` : numéros 1 à 10, 11e refusé, montant négatif refusé, retour = entier
      seul.

### T007 — `begin_cash_close`, `finish_cash_close` (verrou du solde, état `CLOSING`)

1. `begin_cash_close(p_session uuid, p_closer uuid) RETURNS TABLE (cash_session_id uuid,
   cash_account_id uuid, account_code text, ledger_id uuid, event_id uuid, device_id uuid,
   counted_amount bigint, expected_amount bigint)` (la signature à reprendre dans les accords de
   WP05 est `(uuid, uuid)`) :
   a. session `FOR UPDATE` (prestataire de la session, sinon `P0002`) ; statut `OPEN` sinon `CL029`
      ;
   b. fermeur `SUPERVISOR` de l'événement (helper T006) sinon `P0002` ;
   c. au moins un comptage sinon `CL029` ; le fermeur ne figure parmi AUCUN `counted_by` de la
      session sinon **`CL041`** (A26) ; le comptage retenu est le dernier `count_no` ;
   d. `INSERT INTO account_balance … ON CONFLICT DO NOTHING` puis `SELECT balance … FOR UPDATE` sur
      le compte de caisse : le théorique est ce solde lu SOUS verrou ; un solde négatif ne se
      produit pas (compte non négatif) ;
   e. `UPDATE cash_session SET status = 'CLOSING', closed_by = p_closer, counted_amount = …,
      expected_amount = …` puis rend la ligne. Le verrou du solde reste tenu jusqu'à la fin de la
      transaction de l'API.
2. `finish_cash_close(p_session uuid, p_closer uuid, p_close_tx uuid DEFAULT NULL) RETURNS uuid`
   (rend l'identifiant de l'anomalie `CASH_DIFF`, nul s'il n'y a pas d'écart) :
   a. session `FOR UPDATE`, statut `CLOSING` sinon `CL029`, `p_closer = closed_by` sinon `CL029` ;
   b. théorique et compté nuls : `p_close_tx` doit être NULL (sinon `CL001`) ; la session passe
      `CLOSED`, sans écriture ;
   c. sinon `p_close_tx` obligatoire : transaction du même grand livre, `type = 'CASH_CLOSE'`, clé
      exactement `cash-close:<session>`, somme de ses lignes sur le compte de caisse =
      `-expected_amount`, somme de ses lignes sur les comptes `CASH_TRANSIT` = `+counted_amount`,
      solde du compte de caisse = 0 après l'écriture ; sinon `CL001` (rien n'est modifié) ;
   d. écart (`counted <> expected`) : `INSERT INTO anomaly` (`kind = 'CASH_DIFF'`, `amount =
      abs(counted - expected)`, `ledger_id`, `device_id` du terminal, `transaction_id = p_close_tx`,
      `status = 'OPEN'`) ; le signe est déduit de `counted_amount - expected_amount` de la session
      (la table `anomaly` n'a pas de colonne de note) ;
   e. rattache `p_close_tx` dans `cash_session_tx` ; session `CLOSED`, `closed_at`, `close_tx_id`,
      `cash_diff_anomaly_id` ; rend l'anomalie.
3. Cas limites (R-03) : théorique nul et compté positif → surplus seul ; compté nul et théorique
   positif → tout en manque ; les deux nuls → aucune écriture. Une seconde fermeture d'une session
   `CLOSED` : `CL029` (le rejeu à même clé d'idempotence est traité par l'API, pas par la base).
   `finish_cash_close` appelée sans `begin` : `CL029`.
4. Un échec de `finish_cash_close` laisse l'API annuler toute la transaction (NFR-008) : la base n'a
   pas à défaire.

Validation :
- [ ] Manque, surplus, égalité, théorique nul/compté positif, compté nul/théorique positif, nul/nul
      : chacun produit exactement l'écriture et l'anomalie attendues (montants vérifiés).
- [ ] Fermeur auteur d'un comptage : `CL041` ; sans comptage : `CL029` ; transaction de fermeture
      fausse (autre clé, autre type, montant faux) : `CL001`.
- [ ] Après `begin_cash_close`, une recharge sur la caisse est refusée par la garde (T008) ; après
      la fermeture, la caisse est à zéro et la session `CLOSED`.

### T008 — Gardes : `posting_cash_desk_guard`, `account_purpose_guard`

1. `posting_cash_desk_guard() RETURNS trigger` (`SECURITY DEFINER`, `search_path = public, pg_temp`)
   et `CREATE TRIGGER … BEFORE INSERT ON posting FOR EACH ROW` : si `NEW.account_id` n'est pas dans
   `cash_desk` → `RETURN NEW` aussitôt (une seule recherche par clé primaire : le chemin chaud reste
   léger). Sinon, avec des lectures SANS verrou (A21) de `cash_session` et de `journal_transaction`
   (type, clé, `device_id`) :
   - session `OPEN` du compte : si la transaction porte un terminal, il doit être celui de la
     session (A8) ; transaction `CASH_CLOSE` refusée ;
   - session `CLOSING` : seule la transaction `type = 'CASH_CLOSE'` de clé `cash-close:<session_id>`
     passe ;
   - aucune session `OPEN`/`CLOSING` : refus ;
   - tout refus : `RAISE EXCEPTION … USING ERRCODE = 'CL029'`, message d'ADR-89 (cherche-le dans
     `apps/api/src/media/lifecycle/deposit.service.ts`, lignes d'en-tête) sans identifiant sensible.
     La garde ne lit AUCUN `current_setting` (A7). Le test pose un `set_config('app.cash_closing',
     'true', true)` forgé et prouve qu'il n'ouvre rien.
2. `account_purpose_guard() RETURNS trigger` (**`SECURITY INVOKER`**, `SET search_path = public,
   pg_temp`) et `CREATE TRIGGER … BEFORE INSERT OR UPDATE OF purpose ON account FOR EACH ROW` : si
   `current_user = 'cashless_app'` et `NEW.purpose IN ('CASH_DESK','PSP')` → `RAISE EXCEPTION …
   USING ERRCODE = 'insufficient_privilege'` (`42501`). Les autres buts (`TRANSIT`, `WALLET_PAID`,
   `ORG_*`…) passent : la garde ne casse aucune ouverture de grand livre. Les fonctions `SECURITY
   DEFINER` (propriétaire) passent : c'est le seul chemin de création.
3. `REVOKE ALL ON FUNCTION … FROM PUBLIC` sur les deux fonctions de déclencheur (le déclenchement
   n'exige pas `EXECUTE`). Elles ne sont jamais accordées à `cashless_app`.
4. Cas limites : suites de référence générées (`A-CAISSE-C1` posé sans session, non inscrit)
   inchangées et vertes ; écriture par une fonction du propriétaire (ex. `post_transaction`) sur une
   caisse inscrite : la garde s'applique aussi (elle ne dépend pas du rôle) ; compte inscrit dans
   `cash_desk` puis `is_active = false` : sans effet sur la garde.

Validation :
- [ ] Écriture sur caisse inscrite : sans session refusée ; session `OPEN` du même terminal acceptée
      ; autre terminal refusée ; session d'une AUTRE caisse refusée ; `CLOSING` : seule `CASH_CLOSE`
      de la bonne clé passe.
- [ ] Sous `SET LOCAL ROLE cashless_app` : `INSERT INTO account` avec but `CASH_DESK` puis `PSP`
      refusé `42501`, avec `TRANSIT` accepté ; `UPDATE account SET purpose = 'PSP'` refusé ;
      `open_cash_session` réussit.

### T009 — `attach_cash_tx`, `open_cash_due_anomaly`, variantes `…_for_session`

1. `attach_cash_tx(p_session uuid, p_tx uuid) RETURNS void` : session du prestataire `OPEN` (sinon
   `CL029`) ; transaction du même grand livre avec au moins une ligne sur le compte de caisse de la
   session sinon `CL001` ; `INSERT INTO cash_session_tx … ON CONFLICT (cash_session_id, tx_id) DO
   NOTHING` ; une transaction déjà rattachée à une AUTRE session : `CL029` (capture de
   `unique_violation`).
2. `open_cash_due_anomaly(p_ledger uuid, p_media uuid, p_amount bigint, p_tx uuid) RETURNS uuid`
   (signature fixe : WP06 l'appelle ainsi) : prestataire par
   `assert_tenant(tenant_of_ledger(p_ledger))` ; `p_amount > 0` sinon `CL001` ; transaction de ce
   grand livre de type `TOPUP_CASH` sinon `CL001` ; bracelet du prestataire dont le portefeuille
   ouvert (`media_assignment`, `released_at IS NULL`) est de CE grand livre sinon `CL001` (test WP06
   : bracelet d'un autre portefeuille, tout est annulé) ; verrou
   `pg_advisory_xact_lock(hashtextextended( 'cash-due-anomaly:' || p_tx, 0))` puis : anomalie
   `CASH_TOPUP_OVER_LIMIT` déjà liée à `p_tx` → la rend (même bracelet et montant, sinon `CL001`) ;
   sinon `INSERT INTO anomaly` (`kind`, `media_id`, `amount`, `ledger_id`, `transaction_id`,
   `device_id` de la transaction). Respecte le `CHECK` de l'anomalie (bracelet et montant > 0).
3. Helper INTERNE `cash_session_usable(p_session uuid, p_ledger uuid) RETURNS cash_session` :
   session du prestataire, `OPEN` (lecture sans verrou), grand livre égal à `p_ledger` ; sinon
   `CL029`.
4. `take_deposit_for_session(p_media uuid, p_session uuid) RETURNS text`,
   `refund_deposit_for_session(p_media uuid, p_session uuid) RETURNS void`,
   `refund_cash_due_for_session(p_media uuid, p_session uuid, p_key text, p_actor uuid, p_approver
   uuid DEFAULT NULL, p_device uuid DEFAULT NULL) RETURNS uuid` : contrôlent la session (helper),
   puis appellent `take_deposit(p_media, <compte de la session>)`, `refund_deposit(...)` et
   `refund_cash_due(p_media, <compte>, p_key, p_actor, p_approver, p_device)` (corps du schéma de
   référence, non modifiés). `p_device` non nul de `refund_cash_due_for_session` doit être le
   terminal de la session. **Chaque variante rattache elle-même la transaction produite** :
   `refund_cash_due` rend l'identifiant ; pour les cautions, retrouve la transaction par `(ledger,
   clé)` selon la formule du schéma (`deposit:<media>:<n>` et `deposit-refund:<media>:<n>`, `n` =
   nombre de lignes de `media_assignment` du bracelet) et rattache-la SI elle a une ligne sur la
   caisse (mode `FROM_BALANCE` : aucune ligne, aucun rattachement). Rattachement idempotent. L'API
   (WP09) n'appelle donc `attach_cash_tx` que pour la recharge espèces.
5. Contrôle de non-régression : un test pgTAP liste les transactions ayant une ligne sur un compte
   inscrit dans `cash_desk` et n'ayant pas de ligne dans `cash_session_tx` : zéro ligne (R-02), sur
   un scénario qui enchaîne recharge, caution, rendu de caution, rendu d'espèces dues et fermeture.

Validation :
- [ ] Les trois variantes écrivent sur la caisse de la session, jamais sur un compte passé par
      l'appelant (aucun paramètre ne désigne un compte) ; session d'un autre grand livre ou
      `CLOSING` : `CL029`.
- [ ] `open_cash_due_anomaly` : un appel écrit une anomalie, un second appel même transaction la
      rend sans doublon.

### T010 — Suite `tests_cash_sessions.sql`

Fichier pgTAP écrit à la main, modèle `tests/tests_vendors.sql` (en-tête, `BEGIN … ROLLBACK`,
`pg_temp.id()`). Pour les parties sous `cashless_app`, rejoue `\ir ../roles.sql` comme
`tests/tests_payment_rights.sql` (les droits fins de WP05 ne sont pas encore là : tu ne testes ici
que la garde de compte). Deux prestataires A et B.

1. Structure : tables, RLS forcée, index uniques, `CHECK`, aucune colonne de solde.
2. Ouverture et comptage : cas nominaux et chaque refus de T006 (terminal, mode, événement, grand
   livre, personne, prestataire B, doublon, 11e comptage, retour sans théorique).
3. Fermeture : sept scénarios de T007, `CL041`, sans comptage, transaction fausse, `finish` sans
   `begin`.
4. Garde : cinq cas de T008, `set_config` forgé, suites de référence (caisse non inscrite),
   `CASH_CLOSE` sur `OPEN`.
5. Séquence « fermeture pendant une recharge » : recharge validée avant `begin_cash_close` (comptée
   dans le théorique) ; recharge tentée après `begin_cash_close` : refusée ; recharge tentée après
   la fermeture : refusée.
6. Rattachement : le contrôle « zéro écriture de caisse sans rattachement » de T009 ;
   `attach_cash_tx` refus.
7. `account_purpose_guard` sous `cashless_app` ; `open_event_ledger` d'un événement de la base ne
   crée aucun compte `CASH_DESK` (la caisse n'existe qu'après la première session).
8. Cloisonnement : chaque fonction appelée avec un objet du prestataire B sous la session de A :
   `P0002`.
9. Prestataire absent (`app.operator_id` non posé) : `P0002` partout.

Validation :
- [ ] `pg_prove` sur la base propre du lot vert ; la suite échoue si la garde est retirée ou élargie
      (vérifie en neutralisant temporairement le déclencheur dans un essai, puis restaure).

## Test Strategy

Base propre au lot : `PGDATABASE=cashless_wp02 npm run reset-db -w @cashless/ledger-sql` puis
`pg_prove -d cashless_wp02 packages/ledger-sql/tests/tests_cash_sessions.sql`. Vérifie aussi, sur
cette base : `pg_prove -d cashless_wp02 packages/ledger-sql/tests_grand_livre_cashless.sql
packages/ledger-sql/scenario_reference_test.sql` (464 assertions, inchangées) et les suites
existantes de `tests/` (en particulier `tests_definer_search_path.sql`,
`tests_definer_trigger_writers.sql` : toute fonction `SECURITY DEFINER` de la migration doit fixer
`search_path = public, pg_temp`). `cashless_test` est réservée à l'orchestrateur : n'y touche pas.
Aucune comparaison avec l'horloge de Node ; les durées se posent par `clock_timestamp()` de la base
; pas de `sleep`. Les tests Jest de la mission 4 qui posent un compte de caisse à la main seront
adaptés par WP09 : ne les touche pas, mais note dans le compte rendu lesquels échouent.

## Definition of Done

- [ ] Migration `0036_cash_sessions.sql` appliquée sur une base propre ; en-tête complet (contenu,
      fonctions, INTERNES, codes, verrous, hypothèse sur le propriétaire) ; aucun `GRANT`/`REVOKE`
      de table.
- [ ] Toutes les fonctions `SECURITY DEFINER` fixent `search_path = public, pg_temp` et font `REVOKE
      ALL … FROM PUBLIC`.
- [ ] `tests_cash_sessions.sql` vert ; suites de référence et suites existantes vertes sur la base
      du lot.
- [ ] Compte rendu du lot : signatures réelles de toutes les fonctions (WP05, WP06, WP08, WP09 les
      lisent) ; liste des fonctions INTERNES ; écarts au plan avec leur sens (renforcements de
      l'arbitrage) ; contradictions signalées (`account_purpose_guard` invoker ; « `LIVE` » du grand
      livre) ; retouches hors carte justifiées ; points soumis au porteur ; fichiers à faire relire
      par une personne (cette migration : garde, comptes) ; critères couverts avec commande et
      résultat pour la matrice d'acceptation (FR-001 à FR-004, FR-006, NFR-007, NFR-008) ; tests de
      la mission 4 qui échouent désormais.

## Risks

- Garde trop large : casser les suites de référence ou une ouverture de grand livre (lis les deux
  avant de coder).
- Garde trop étroite : une écriture de caisse passe sans session si un chemin lit une variable ou
  saute `cash_desk`.
- Interblocage : respecte « session → solde » ; ne prends aucun verrou de session dans les
  variantes.
- `current_user` : une fonction `SECURITY DEFINER` mal placée neutralise `account_purpose_guard`.
- Compte posé à la main inscrit à la première session : comportement à documenter, pas à étendre.

## Reviewer Guidance

Essaie de casser : (1) une écriture sur `A-CAISSE-<série>` sans session, avec la session d'un autre
terminal, avec une session `CLOSING`, avec un `set_config` forgé, ou via
`take_deposit`/`refund_cash_due` directs sur une caisse inscrite ; (2) la création d'un compte
`CASH_DESK`/`PSP` sous `cashless_app` par INSERT, UPDATE ou en passant par une fonction non définie
par ce lot ; (3) la fermeture par l'auteur d'un comptage, sans comptage, avec une transaction
`CASH_CLOSE` fabriquée (autre montant, autre clé) ; (4) un comptage qui laisse échapper le théorique
; (5) un test qui ne prouve pas ce qu'il dit (une garde testée seulement par le propriétaire, une
séquence « avant / après » sans vérifier le solde). Vérifie que chaque fonction nomme le
prestataire, ne dépend pas de la RLS et ne crée aucune session ni écriture sur un objet d'un autre
prestataire.
