---
work_package_id: WP05
title: Demandes de paiement QR (migration 0034)
dependencies: [WP04]
requirement_refs: [FR-018, FR-019, FR-020, NFR-005, NFR-007, NFR-008, C-001, C-009]
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-terminaux-paiement-en-ligne-01M52QB9
base_commit: 20040dbab88fe72bdb68f5b3a31440c50db27b44
created_at: '2026-10-23T11:18:58.923925+00:00'
subtasks: [T021, T022, T023, T024]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/
create_intent: [packages/ledger-sql/migrations/0034_payment_requests.sql, packages/ledger-sql/tests/tests_payment_requests.sql]
execution_mode: code_change
owned_files: [packages/ledger-sql/migrations/0034_payment_requests.sql, packages/ledger-sql/tests/tests_payment_requests.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 – Demandes de paiement QR (migration 0034)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis, dans
`kitty-specs/terminaux-paiement-en-ligne-01M52QB9/` : `contracts/qr-payments.md` (en entier),
`contracts/vendors.md` (« Garde de session », « Ordre global des verrous »), `contracts/catalog.md` (« Contrôle des
lignes »), `data-model.md` (`payment_request` et `payment_request_detail`, codes d'erreur), `research.md` R-06, R-08
et R-11 (A3, A10, A17, A24, A25), `plan.md` IC-06. Code réel : `schema_grand_livre_cashless.sql` (`payment_request`,
`wallet`, `ledger`, `account`, `posting`, `journal_transaction`, politique `tenant_isolation`), migrations 0031
(`vendor_session`, `assert_vendor_session`), 0032 (`record_sale_lines`), 0033 (`record_sale_attribution`,
`assert_wallet_payable`) telles que fusionnées, et 0023 pour la convention.

Règle §0.3 : en cas de contradiction entre sources, applique la priorité (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **signale-la**. Ne modifie jamais un `.sql` généré de
`packages/ledger-sql/`. `payment_request` (schéma de référence) reste **inchangée** : aucun `ALTER TABLE`.

## Objective

Faire tenir par la base la vie d'une demande de paiement QR : création (commerçant par un terminal, client par
l'app), verrouillage et contrôle avant l'écriture de la vente, confirmation liée à la vente exacte, annulation ; un
jeton sert une fois, n'est gardé que haché, et tout échec donne la même réponse.

## Context

- Exigences : FR-018 (QR commerçant), FR-019 (QR client), FR-020 (empreinte seule, usage unique, refus indistinct),
  NFR-005 (20 paiements simultanés d'un jeton : une vente), NFR-007 (isolation), NFR-008 (aucun jeton en clair).
- R-06 : écritures de `payment_request` par fonctions de la base seulement (renforcement ; WP07 retire `INSERT`,
  `UPDATE` et la lecture de `nonce_hash` à `cashless_app`). A10 : SQL n'appelle pas le moteur ; l'API fait
  « verrouiller → moteur (`PURCHASE`) → `confirm_payment_request` » dans **une** transaction. A25 : l'événement d'un QR
  client est celui du grand livre du portefeuille. A24 : le festivalier consulte avec le jeton.
- Le jeton n'arrive jamais en base : l'API passe `nonce_hash = sha256(jeton)` (32 octets). Durées : commerçant
  15 à 300 s (60 par défaut, choisi par l'API), client 60 s fixes. Heure : `clock_timestamp()` de la base ; une
  demande expirée n'est pas réécrite `EXPIRED` (relue à l'heure de la base, sans tâche).
- Ordre global des verrous : **terminal → vendeur → session de vendeur → demande QR → bracelet → portefeuille**.
  Côté terminal, l'API a déjà pris le terminal `FOR UPDATE` (`record_device_seq`) et appelé `assert_device_active`,
  `assert_vendor_session`. Côté festivalier, aucun verrou préalable.
- Erreur unique `CL037` → `409 PAYMENT_REQUEST_NOT_PENDING` pour : inconnue, autre prestataire, payée, annulée,
  expirée, mauvais jeton, mauvais portefeuille. Ne rien révéler de plus (pas de `no_data_found` distinct).
- Convention : SECURITY DEFINER, `SET search_path = public, pg_temp`, `REVOKE ALL ON FUNCTION … FROM PUBLIC` après
  chaque fonction ; aucun `GRANT` (WP07). Prestataire de la session nommé dans chaque lecture.
- Dépendent de ce lot : WP07 (accords, retraits), WP11 (QR client au terminal), WP13 (routes QR).

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en
affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus
longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ;
continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- `payment_request_for_token(p_nonce_hash)` : **créée** (lecture d'une demande par l'empreinte, sans rendre `nonce_hash`) ; WP07 l'accorde.
- Lignes d'une demande commerçant contrôlées à la création par `check_sale_lines` (WP03), sans écriture.
- Confirmation : exige **aussi** `p_nonce_hash` et revérifie la demande (pas de marque locale à la transaction).
- QR client sur un grand livre de portée `ORGANIZER` : refusé. Montant et terminal écrits dans la demande à la confirmation : retenu.

## Branch Strategy

Planification et fusion sur `feat/terminaux-paiement-en-ligne`. Dépendance : WP04 (et, par elle, WP02, WP03).
Worktree attribué par lane (`lanes.json`). Commande :
`spec-kitty agent action implement WP05 --agent claude --mission terminaux-paiement-en-ligne-01M52QB9`.

## Subtasks

### T021 — `payment_request_detail`

Table `payment_request_detail` : `payment_request_id uuid PRIMARY KEY` (→ `payment_request`), `operator_id uuid NOT
NULL`, `vendor_session_id uuid NOT NULL` (→ `vendor_session`), `idempotency_key text NOT NULL` (clé de la vente à
écrire au paiement, choisie par l'API, unique par prestataire), `lines jsonb` (nul en `KEYPAD_TPE`),
`catalog_version int`, `created_at timestamptz DEFAULT clock_timestamp()`. RLS activée et forcée
(`tenant_isolation`), `forbid_mutation` (ajout seul). Complète seulement les demandes `MERCHANT_QR`.

### T022 — `create_merchant_payment_request`, `create_customer_qr_token`

- `create_merchant_payment_request(p_device uuid, p_vendor_session uuid, p_amount bigint, p_currency char(3),
  p_ttl_seconds int, p_nonce_hash bytea, p_idempotency_key text, p_lines jsonb, p_catalog_version int)
  RETURNS TABLE(payment_request_id uuid, expires_at timestamptz)` :
  - terminal du prestataire, `ACTIVE` (relu `FOR SHARE` après le `FOR UPDATE` de l'API), affecté à un événement
    `LIVE`, mode `CATALOG_POS` ou `KEYPAD_TPE` ; session : appeler `assert_vendor_session(p_device, p_vendor_session)`
    (WP02, `CL032`) ;
  - `p_amount > 0`, `p_currency` = devise de l'événement, `p_ttl_seconds BETWEEN 15 AND 300`,
    `octet_length(p_nonce_hash) = 32`, `CATALOG_POS` ⇒ lignes présentes, `KEYPAD_TPE` ⇒ lignes absentes (`CL001`) ;
  - lignes « contrôlées comme une vente, sans écriture » : **point à trancher** — `record_sale_lines` (WP03) écrit ;
    s'il n'existe pas de variante de contrôle seul, demande à l'orchestrateur avant de coder (options : WP03 expose
    une fonction de contrôle partagée ; ou le contrôle se fait au paiement, dans la transaction de la vente, par
    `record_sale_lines`, ce qui reste sûr mais refuse plus tard). Ne réécris pas les règles de prix ici ;
  - insère `payment_request` (`MERCHANT_QR`, `device_id`, `event_id` du terminal, `amount`, `currency`, `nonce_hash`,
    `expires_at = clock_timestamp() + ttl`, `PENDING`) et `payment_request_detail`. Doublon de `nonce_hash` → laisser
    `23505` (l'API régénère ; ne jamais le traduire en succès).
- `create_customer_qr_token(p_customer uuid, p_wallet uuid, p_nonce_hash bytea) RETURNS TABLE(payment_request_id
  uuid, expires_at timestamptz)` : portefeuille du prestataire, `customer_id = p_customer`, `ACTIVE` (relu
  `FOR SHARE`) ; événement = `ledger.scope_id` quand `ledger.scope_type = 'EVENT'` (A25) — **point à trancher** si le
  grand livre est de portée `ORGANIZER` (plusieurs événements) : proposition, refuser (`CL001`) ; devise du grand
  livre ; `CUSTOMER_QR`, `amount` et `device_id` nuls, 60 s. Tout refus → `CL037`, sauf paramètres mal formés
  (`CL001`). Une demande client `PENDING` du même portefeuille n'est pas annulée (rien au contrat ; à signaler).

### T023 — Verrouillage, confirmation, annulation des demandes

- `lock_payment_request_for_pay(p_id uuid, p_nonce_hash bytea, p_wallet uuid, p_customer uuid) RETURNS
  TABLE(device_id uuid, vendor_session_id uuid, vendor_id uuid, event_id uuid, ledger_id uuid, amount bigint, currency
  char(3), idempotency_key text, lines jsonb, catalog_version int)` (côté festivalier, `MERCHANT_QR`) : lit **sans
  verrou** le terminal et la session de la demande, puis verrouille dans l'ordre global : terminal `FOR SHARE`,
  vendeur puis session `FOR SHARE`, demande `FOR UPDATE`, portefeuille `FOR SHARE`. Contrôles : demande `PENDING`,
  `MERCHANT_QR`, non expirée, `nonce_hash` égal ; portefeuille du festivalier, `ACTIVE`, même devise et même
  événement (grand livre de l'événement de la demande) ; terminal `ACTIVE` ; session ouverte, non expirée, vendeur
  `ACTIVE` et non bloqué. Tout échec → `CL037` (même pour un terminal suspendu : rien n'est révélé au festivalier).
- `lock_customer_qr_token(p_nonce_hash bytea, p_device uuid) RETURNS TABLE(payment_request_id uuid, wallet_id uuid)`
  (côté terminal, dans la transaction de `createPayment`) : demande `FOR UPDATE`, `CUSTOMER_QR`, `PENDING`, non
  expirée, du prestataire, même événement que le terminal ; portefeuille `FOR SHARE`, `ACTIVE`. Sinon `CL037`.
- `confirm_payment_request(p_id uuid, p_tx uuid) RETURNS void` : reprend la demande `FOR UPDATE NOWAIT` (déjà tenue
  par cette transaction : immédiat ; tenue par une autre : `55P03` → `CL037`) ; `PENDING` et non expirée ; `p_tx` du
  prestataire, `PURCHASE`, `source = 'ONLINE'`, montant débité au portefeuille (Σ des débits sur les comptes
  `WALLET_PAID`/`WALLET_PROMO` du portefeuille, même définition que `record_sale_lines`) ; `MERCHANT_QR` : montant =
  `amount`, portefeuille = celui verrouillé, `tx.device_id = device_id` de la demande, `tx.idempotency_key =
  detail.idempotency_key` ; `CUSTOMER_QR` : portefeuille = `wallet_id` de la demande, `tx.device_id` non nul.
  Écrit `status = 'CONFIRMED'`, `transaction_id = p_tx` (et, pour `CUSTOMER_QR`, `amount` et `device_id` de la vente :
  proposition à signaler). `MERCHANT_QR` : appelle `record_sale_attribution(p_tx, detail.vendor_session_id,
  'MERCHANT_QR')` (WP04) ; `CUSTOMER_QR` : l'attribution est faite par le paiement du terminal (WP11), pas ici.
- **Point à trancher (à l'orchestrateur)** : « la demande est celle verrouillée par cette transaction ».
  `FOR UPDATE NOWAIT` ne prouve pas que la fonction de verrouillage (qui contrôle le jeton) a été appelée. Options :
  marque locale à la transaction posée par la fonction de verrouillage (`set_config('cashless.payment_request_lock',
  id || ':' || txid_current(), true)`, relue par la confirmation ; falsifiable par une connexion de l'API compromise,
  même classe qu'OP-N56) ; ou exiger aussi `p_nonce_hash` à la confirmation. Sans décision : marque locale + revérif.
- `cancel_payment_request(p_id uuid, p_device uuid, p_nonce_hash bytea) RETURNS void` : exactement un des deux
  (`CL001` sinon) ; terminal : demande `MERCHANT_QR` de ce terminal (ordre : terminal déjà tenu par l'API, puis demande
  `FOR UPDATE`) ; festivalier : `nonce_hash` égal. `PENDING` non expirée → `CANCELLED` ; sinon `CL037`.
- **Point à trancher (à l'orchestrateur, bloquant pour WP13)** : WP07 retire à `cashless_app` la lecture de
  `nonce_hash` ; l'API ne pourra plus écrire `WHERE nonce_hash = $1`. La consultation par le festivalier avec le
  jeton (`getPaymentRequest`, A24) demande une fonction, absente de `contracts/database-rights.md`. Proposition :
  `payment_request_for_token(p_id uuid, p_nonce_hash bytea) RETURNS TABLE(status text, amount bigint, currency
  char(3), expires_at timestamptz, merchant_name text)`, mêmes refus `CL037`, à accorder par WP07.

### T024 — Suite `tests_payment_requests.sql`

pgTAP écrit à la main, en propriétaire avec `app.operator_id` posé (accords de WP07 absents), prestataires A et B. Un
cas par refus, chacun avec son témoin :
- création commerçant : terminal suspendu, révoqué, `TOPUP_DESK`, événement non `LIVE`, session invalide (`CL032`),
  montant nul, devise différente, durée 14 et 301 s, empreinte de 31 octets, lignes en `KEYPAD_TPE` ; doublon
  d'empreinte ; une ligne `detail` par demande ; aucune colonne ne contient le jeton (seule l'empreinte) ;
- QR client : portefeuille d'un autre festivalier, bloqué, autre prestataire ; événement du grand livre ;
- verrouillage : mauvais jeton, expirée (poser `expires_at` en propriétaire), payée, annulée, autre événement,
  portefeuille bloqué, session close, terminal suspendu → toutes `CL037`, **même message** (comparer `SQLERRM`) ;
- confirmation : montant, portefeuille, terminal, clé ou type différents → refus ; vente exacte → `CONFIRMED`,
  `transaction_id` posé, attribution `MERCHANT_QR` écrite ; seconde confirmation → `CL037` ;
- annulation : terminal d'origine, autre terminal, festivalier avec et sans le bon jeton, demande payée ;
- isolation : prestataire B ne crée, ne verrouille, ne confirme ni n'annule une demande de A ;
- `search_path=public, pg_temp` et aucun droit `PUBLIC` sur chaque fonction.
Concurrence (20 paiements simultanés d'un jeton, NFR-005) : laissée aux tests Jest de WP13 et WP14 ; un test pgTAP
prouve au moins que la seconde confirmation de la même demande est refusée.

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`,
`npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w
@cashless/api -- --runInBand`. Jamais pgTAP sur une base où Jest vient de tourner (rejouer `reset-db`). La base
partagée appartient à l'orchestrateur : valide ton SQL sur un cluster PostgreSQL 17 jetable dans le scratchpad, ou
demande à l'orchestrateur ; tests en série seulement. Dans un worktree de lane, crée d'abord les liens
`node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de la base Docker qui peut reculer : aucun
test ne compare l'heure de Node à `now()` sans marge ; les expirations se testent en posant `expires_at` dans le passé.

## Definition of Done

- `0034_payment_requests.sql` rejouable ; toutes les suites pgTAP vertes (dont `tests_definer_search_path.sql`,
  `tests_execute_grants.sql`) ; Jest vert.
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status Txxx --status done --mission
  terminaux-paiement-en-ligne-01M52QB9`.
- Compte rendu ajouté en fin de ce fichier : écarts au plan (sens), décisions sur les quatre points à trancher,
  retouches hors carte (une ligne chacune), points soumis au porteur, fichiers à faire relire par une personne
  (`0034_payment_requests.sql`), **critères couverts avec leur preuve** (fichier et nom du cas) : FR-018, FR-019,
  FR-020 (base), NFR-008 (empreinte seule), NFR-007 (base).

## Risks

- Interblocage entre le chemin festivalier (verrous pris dans la fonction) et le chemin terminal (terminal `FOR
  UPDATE` par l'API) : respecter l'ordre global ; un `FOR SHARE` sur le terminal ne doit jamais être monté en
  `FOR UPDATE` dans la même transaction.
- Réponses distinctes selon la cause (fuite d'état d'une demande ou d'existence d'un jeton).
- Confirmation qui accepte une vente d'un autre montant, d'un autre portefeuille ou d'une autre clé (A10).

## Reviewer Guidance

Le relecteur distinct vérifie, refus par refus : aucun `INSERT`/`UPDATE` de `payment_request` hors de ces fonctions ;
jamais de jeton en clair (paramètres `bytea` de 32 octets) ; ordre des verrous de `lock_payment_request_for_pay`
(lecture sans verrou, puis terminal, vendeur, session, demande, portefeuille) ; expiration à l'heure de la base ; même
`CL037` et même message pour toutes les issues ; confirmation liée au montant, au portefeuille, au terminal, à la clé
et au type exacts ; attribution `MERCHANT_QR` par la session de la demande ; QR client sur l'événement du grand
livre ; isolation à deux prestataires ; `search_path` et `REVOKE … FROM PUBLIC` ; aucun `GRANT` ; aucun fichier
généré modifié.
