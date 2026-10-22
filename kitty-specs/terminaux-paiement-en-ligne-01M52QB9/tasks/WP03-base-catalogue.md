---
work_package_id: WP03
title: "Catalogue versionné et lignes de vente (migration 0032)"
dependencies: []
requirement_refs: [FR-007, FR-008, FR-011, FR-012, FR-026, NFR-006, NFR-007, C-001, C-002]
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks: [T011, T012, T013, T014, T015]
phase: "Phase 1 - Contrat et base de données"
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: implementer-ivan
role: implementer
agent: claude
authoritative_surface: packages/ledger-sql/
create_intent: [packages/ledger-sql/migrations/0032_catalog.sql, packages/ledger-sql/tests/tests_catalog.sql]
execution_mode: code_change
owned_files: [packages/ledger-sql/migrations/0032_catalog.sql, packages/ledger-sql/tests/tests_catalog.sql]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 – Catalogue versionné et lignes de vente (migration 0032)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis seulement :
`spec.md` (FR-007, FR-008, FR-011, FR-012, NFR-006), `data-model.md` (sections catalog_*, device_catalog_served,
sale_line, codes d'erreur), `research.md` R-04 (avec la révision A2) et R-11 (A2, A21), `contracts/catalog.md` (en
entier), `contracts/database-rights.md` (ligne catalogue). Code de référence : `migrations/0022_device_enrollment.sql`
(`device_admin_allowed`, RLS forcée, style), `schema_grand_livre_cashless.sql` (`journal_transaction`, `posting`,
`account.purpose`, `forbid_mutation`, `point_of_sale`, `merchant_participation`, `event.status`). En cas de
contradiction entre sources, applique la priorité de SPECIFICATION §0.3 (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **signale-la**. Ne modifie jamais un `.sql` généré de
`packages/ledger-sql/`.

## Objective

Créer le catalogue par point de vente (état courant), ses versions immuables, la politique de délégation au
commerçant, les versions servies à chaque terminal et les lignes de vente contrôlées par la base : une ligne n'est
acceptée qu'au prix et au taux de la version courante ou de la **dernière** version servie au terminal, une seule
version par vente (A2).

## Context

- IC-03 (plan) ; décision du porteur `DM-01M5HK8RJSX2KVK7Y6Y0C7XSRD` (prix servi ou actuel). R-04 révisé par A2 : le
  premier texte (« toute version servie ») élargissait la décision ; seules la version courante et la dernière servie
  sont admises. A21 : verrou du point de vente pour des versions successives ; délégation revérifiée par la base.
- `record_config_served` ne voit pas le catalogue et sa déduplication ne change pas : `device_catalog_served` est une
  table à part, en ajout seul.
- Erreur nouvelle : `CL034` → `422 SALE_LINES_INVALID`. Existantes : `CL001`, `P0002`, `42501` (terminal révoqué).
- Ce qui en dépend : WP04 (appelle `record_sale_lines` dans la vente), WP05 (lignes d'une demande QR), WP07 (droits),
  WP10 (routes du back-office, `DeviceConfigService.build`).
- Droits : `REVOKE ALL ON FUNCTION … FROM PUBLIC` sur chaque fonction, aucun `GRANT` (WP07 dans `post-roles.sql`).

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en
affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus
longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ;
continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- Expose `check_sale_lines(...)` : contrôle seul (somme, prix de la version admise, bornes), **sans écriture** ; `record_sale_lines` l'appelle, et WP05 l'appelle à la création d'une demande QR.
- Libellé de catégorie **copié** dans la version (immuabilité réelle) ; au plus 200 lignes par vente ; article d'une catégorie inactive exclu de la version.
- Écriture du catalogue sur un événement `CLOSED` : `CL029` si son sens existant convient, sinon signale.
- Montant de la vente : à vérifier contre `apps/api/src/ledger/` (`purchase`) avant de coder ; le calcul retenu est décrit dans le compte rendu.

## Branch Strategy

Planification et fusion sur `feat/terminaux-paiement-en-ligne`. Dépendances : aucune. Worktree attribué par lane
(`lanes.json`). Commande : `spec-kitty agent action implement WP03 --agent claude --mission
terminaux-paiement-en-ligne-01M52QB9`.

## Subtasks

### T011 — Tables

Toutes portent `operator_id` (FK `party`), RLS activée **et forcée**, politique `tenant_isolation` comme 0022.
- `point_of_sale_catalog_policy (pos_id PK → point_of_sale, operator_id, merchant_manages boolean NOT NULL DEFAULT
  false, updated_by, updated_at)` : créée à la première écriture du catalogue du point de vente ; sa ligne sert de
  verrou.
- `catalog_category (id, operator_id, pos_id, label_fr, label_en, position int ≥ 0, active, created_at, updated_at)`.
- `catalog_item (id, operator_id, pos_id, category_id, label_fr, label_en, unit_price bigint > 0, vat_rate_bps int
  0..10000, active, created_at, updated_at)` ; `pos_id` de l'article = celui de sa catégorie (contrôlé par les
  fonctions). Libellés : `btrim` non vide, 120 caractères au plus.
- `catalog_version (operator_id, pos_id, version int ≥ 1, created_by, created_at)`, PK `(pos_id, version)`.
- `catalog_version_item (operator_id, pos_id, version, item_id, category_id, label_fr, label_en, unit_price,
  vat_rate_bps)`, PK `(pos_id, version, item_id)`, FK `(pos_id, version)` → `catalog_version`.
  **Point à trancher** : la configuration sert `category` (libellé de la catégorie) pour les articles d'une version ;
  sans copie, un renommage ultérieur changerait le libellé d'une version « immuable ». Proposition : copier aussi
  `category_label_fr`, `category_label_en`, `category_position` dans `catalog_version_item`. Signale ton choix.
- `catalog_version` et `catalog_version_item` : déclencheurs `forbid_mutation` (UPDATE, DELETE).
- `device_catalog_served (operator_id, device_id, pos_id, version, served_at DEFAULT now())`, ajout seul
  (`forbid_mutation`), unique `(device_id, version)` selon `data-model.md`. **Point à trancher** : une version est
  numérotée par point de vente ; `(device_id, pos_id, version)` serait exact si un terminal changeait de point de
  vente (réaffectation retirée à l'API par WP07, donc cas presque impossible). Suis `data-model.md` sauf décision
  contraire et signale-le. Index `(device_id, pos_id, served_at DESC)`.
- `sale_line` : colonnes de `data-model.md` + `operator_id` ; PK `(transaction_id, line_no)` ; FK `transaction_id` →
  `journal_transaction(id)` ; `line_no ≥ 1`, `quantity ≥ 1`, `unit_price > 0`, `vat_rate_bps` 0..10000,
  `CHECK (line_total = quantity * unit_price)` ; `forbid_mutation`.

### T012 — Fonctions d'écriture du catalogue

`SECURITY DEFINER SET search_path = public, pg_temp` ; prestataire = `app.operator_id` (absent → `P0002`), nommé
partout. Noms proposés (signatures « arrêtées à l'implémentation » : les rapporter à WP07 et WP10) :
- interne `catalog_admin_allowed(p_operator uuid, p_pos uuid, p_actor uuid) RETURNS boolean` : vrai si
  `device_admin_allowed(p_operator, <événement du point de vente>, p_actor)` (OPERATOR_ADMIN, ORGANIZER_ADMIN de
  l'organisateur), ou si `merchant_manages` est vrai **et** l'auteur est `MERCHANT_ADMIN` (portée `MERCHANT`,
  attribution non révoquée, personne `ACTIVE` du prestataire) du commerçant du point de vente. Non accordée.
- interne `catalog_bump_version(p_operator uuid, p_pos uuid, p_actor uuid) RETURNS int` : version suivante
  (`max + 1`, ou 1), insertion de `catalog_version`, copie des articles actifs (proposition : article **et**
  catégorie actifs — non dit au plan, à signaler).
- `create_catalog_category(p_pos, p_label_fr, p_label_en, p_position, p_actor)`,
  `update_catalog_category(p_category, p_label_fr, p_label_en, p_position, p_active, p_actor)`,
  `create_catalog_item(p_category, p_label_fr, p_label_en, p_unit_price, p_vat_rate_bps, p_actor)`,
  `update_catalog_item(p_item, p_category, p_label_fr, p_label_en, p_unit_price, p_vat_rate_bps, p_active, p_actor)`
  (paramètre NULL = inchangé ; changement de catégorie limité au même point de vente). Chacune rend
  `(id uuid, version int)`.
- `set_catalog_policy(p_pos uuid, p_merchant_manages boolean, p_actor uuid) RETURNS void` : auteur
  `device_admin_allowed` seulement (jamais le commerçant) ; ne crée pas de version.
Déroulé commun : point de vente du prestataire (→ `P0002`) ; ligne de politique créée si absente
(`INSERT … ON CONFLICT DO NOTHING`) puis `SELECT … FOR UPDATE` (A21 : deux écritures simultanées donnent deux
versions successives) ; auteur revérifié après le verrou (→ `P0002`) ; événement `CLOSED` → refus (**code non fixé**
au plan : proposer `CL029` → `409 CONFLICT_STATE` et le signaler) ; bornes → `CL001` ; écriture de l'état courant ;
`catalog_bump_version` dans la même transaction. Pas de suppression (désactivation seulement).

### T013 — `record_device_catalog_served` et lecture d'une version

`record_device_catalog_served(p_device uuid) RETURNS TABLE (pos_id uuid, version int)` : terminal du prestataire
`FOR SHARE` (→ `P0002`) ; `REVOKED` → `42501` ; terminal sans point de vente, mode autre que `CATALOG_POS`, ou point de
vente sans version → `(pos_id, 0)` sans écriture ; sinon dernière version du point de vente, insérée dans
`device_catalog_served` si `(device_id, version)` n'y est pas (`ON CONFLICT DO NOTHING`), et rendue. Lecture d'une
version (back-office `getCatalogVersion`, configuration servie) : simple `SELECT` sous la RLS sur `catalog_version_item`
(aucune fonction ; `SELECT` reste accordé). Index utile à `(pos_id, version)`.

### T014 — `record_sale_lines`

`record_sale_lines(p_tx uuid, p_device uuid, p_lines jsonb) RETURNS int` (nombre de lignes), appelée par WP04 après
l'écriture de la vente et avant `consume_tap` :
1. `p_lines` : tableau JSON non vide d'objets `{product_id, quantity, unit_price}` (noms du schéma `SaleLine` du
   contrat) ; forme invalide, quantité < 1, prix ≤ 0, nombre de lignes au-delà d'une borne (proposer 200, à signaler)
   → `CL034`. Produits calculés en `numeric` : dépassement de `bigint` → `CL034`, jamais une erreur 500.
2. Vente `p_tx` : `journal_transaction` du prestataire, `type = 'PURCHASE'`, `device_id = p_device`, sans
   `sale_line` ; sinon `CL034`. Point de vente = `device.pos_id` du terminal.
3. Montant de la vente : non stocké dans `journal_transaction`. **Point à trancher** ; proposition : `−Σ
   posting.amount` des lignes négatives sur les comptes `purpose = 'MERCHANT'` de la vente (le constructeur `PURCHASE`
   crédite le commerçant du montant ; la commission est un débit). Vérifie dans
   `apps/api/src/ledger/builders/festival/purchase.ts` et signale.
4. Versions candidates, dans cet ordre : courante (`max(version)` du point de vente), puis dernière servie à ce
   terminal pour ce point de vente (ligne la plus récente de `device_catalog_served`, `served_at DESC, version
   DESC`) si elle diffère. Aucune autre.
5. Version retenue : la première où **toutes** les lignes ont leur article présent dans la version au prix reçu ;
   aucune → `CL034`.
6. Insertion des lignes (`line_no` = rang dans le tableau ; libellés, prix, taux copiés de la version ;
   `catalog_version`) ; Σ `line_total` ≠ montant → `CL034` (l'exception annule tout).

### T015 — Suite `tests_catalog.sql`

Style de `tests/tests_device_enrollment.sql`. Cas : structure (SECURITY DEFINER, `search_path`, non exécutable par
`PUBLIC`, RLS forcée, `forbid_mutation` sur versions, versions servies et lignes) ; bornes (prix 0, taux 10 001,
libellé vide ou de 121 caractères) ; chaque écriture crée la version suivante, contenu = articles actifs ; article
désactivé absent de la version suivante ; délégation : `MERCHANT_ADMIN` refusé sans délégation, accepté avec,
refusé de nouveau après retrait ; `set_catalog_policy` refusée au commerçant ; événement `CLOSED` refusé ; autre
prestataire → `P0002` ; verrou : après une écriture, `pg_locks` montre la ligne de politique verrouillée ;
`record_device_catalog_served` (version 0 sans catalogue, insertion unique, terminal révoqué) ; **test de borne A2** :
version 1 servie, version 2 servie, version 3 courante → ligne au prix de la version 1 refusée ; vente mêlant prix des
versions 2 et 3 refusée ; prix de la version 2 seule accepté, prix de la 3 seule accepté ; somme fausse, article
inconnu, d'un autre point de vente, vente non `PURCHASE`, autre terminal, lignes déjà écrites, quantité énorme
(dépassement) → `CL034` ; tout ou rien : après un refus, aucune `sale_line`. Ventes de test : écrire
`journal_transaction` et `posting` en propriétaire (comme les suites existantes) ou via `post_transaction` si plus
simple. Ne teste pas les droits de `cashless_app` (WP07).

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w
@cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`.
Jamais pgTAP sur une base où Jest vient de tourner (rejouer `reset-db`). La base partagée appartient à
l'orchestrateur : valide ton SQL sur un cluster PostgreSQL 17 jetable dans le scratchpad, ou demande-lui de lancer
les suites ; tests en série seulement. Dans un worktree de lane, crée d'abord les liens
`node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de la base Docker qui peut reculer : aucun
test ne compare l'heure de Node à `now()` sans marge. Non-régression : `tests_execute_grants.sql` et
`tests_definer_search_path.sql` restent vertes.

## Definition of Done

- `0032_catalog.sql` rejouable après `reset-db` ; toutes les suites pgTAP vertes, dont `tests_catalog.sql`.
- Chaque fonction : `SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC` ; aucun `GRANT`.
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status Txxx --status done --mission
  terminaux-paiement-en-ligne-01M52QB9`.
- Compte rendu du lot en fin de ce fichier : écarts au plan (sens : renforcement ou non), retouches hors carte (une
  ligne de justification chacune), points soumis au porteur et choix faits sur les points à trancher (libellés de
  catégorie copiés, clé de `device_catalog_served`, code du refus `CLOSED`, montant de la vente, borne du nombre de
  lignes, catégorie inactive), signatures finales pour WP04, WP07 et WP10, fichiers à faire relire par une personne,
  **critères d'acceptation couverts avec leur preuve** (fichier de test et nom du cas, pour
  `acceptance-matrix.json`).

## Risks

- Élargir les versions admises (toute version servie) : retour au défaut A2.
- Mélange de versions dans une vente ; version calculée sans verrou (deux versions de même numéro).
- Délégation contrôlée par l'API seule.
- Erreur 500 sur une quantité énorme (dépassement non intercepté).

## Reviewer Guidance

Vérifier : seules la version courante et la dernière servie sont candidates, dans cet ordre, une seule retenue pour
toutes les lignes ; prix **et** taux copiés de la version retenue ; somme comparée au montant réel de la vente ;
verrou de la ligne de politique avant le calcul de la version ; auteur relu après le verrou, commerçant accepté
seulement avec délégation active ; versions et lignes en ajout seul ; chaque refus de `record_sale_lines` en `CL034`
sans écriture ; aucun `GRANT` dans la migration.
