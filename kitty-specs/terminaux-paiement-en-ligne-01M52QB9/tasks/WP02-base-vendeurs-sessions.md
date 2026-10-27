---
work_package_id: WP02
title: Vendeurs, sessions et set_device_status (migration 0031)
dependencies: []
requirement_refs: [FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-026, NFR-002, NFR-003, NFR-007, C-001, C-002]
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-terminaux-paiement-en-ligne-01M52QB9
base_commit: 53703b537493f2472b75388c9d558de6a22ca82f
created_at: '2026-10-22T15:14:55.663459+00:00'
subtasks: [T006, T007, T008, T009, T010]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/
create_intent: [packages/ledger-sql/migrations/0031_vendors.sql, packages/ledger-sql/tests/tests_vendors.sql]
execution_mode: code_change
owned_files: [packages/ledger-sql/migrations/0031_vendors.sql, packages/ledger-sql/tests/tests_vendors.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 – Vendeurs, sessions et set_device_status (migration 0031)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis seulement :
`spec.md` (FR-001 à FR-006, NFR-002, NFR-003, NFR-007), `data-model.md` (sections vendor, vendor_public,
vendor_pin_check, vendor_session, set_device_status, codes d'erreur), `research.md` R-02 et R-11 (A6, A7, A15, A20),
`contracts/vendors.md` (en entier), `contracts/database-rights.md` (ligne `vendor`). Code de référence :
`migrations/0022_device_enrollment.sql` (`set_device_status`, `device_admin_allowed`, style des fonctions),
`migrations/0023_device_tokens_nonces.sql` (`assert_device_active`), `migrations/0021_definer_search_path.sql` (règle
du `search_path`). En cas de contradiction entre sources, applique la priorité de SPECIFICATION §0.3 (tests
exécutables > schéma SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **signale-la**. Ne modifie
jamais un `.sql` généré de `packages/ledger-sql/`.

## Objective

Créer en base les vendeurs (S2), l'essai de PIN « compté d'abord », les sessions de vendeur et leur garde, et
remplacer `set_device_status` pour qu'elle ferme les sessions d'un terminal suspendu ou révoqué. La base tient
toutes les règles (C-001) ; l'API (WP09) ne fait qu'argon2id et l'audit.

## Context

- IC-01 (plan) ; décisions `DM-01M5HJXZ4QPS4NY8SABQKY95Q2` (PIN vérifié par le serveur), `DM-01M5HKT8GW5ZCAESAJC6WV5S6H`
  (règles du PIN), `DM-01M5HRNFEFWDG47YEGE5N3C3GN` (limite consignée OP-N76 / ADR-121 : l'API lit l'empreinte et la
  base croit la transaction B ; consignation faite par WP14, rien à coder ici).
- Constats : A6 (compter d'abord, aucun verrou pendant argon2), A7 (ordre global, fermeture à la suspension), A20
  (vue `vendor_public`, seule lecture du statut « bloqué »).
- Ordre global des verrous : **terminal → vendeur → session de vendeur → demande QR → bracelet → portefeuille**.
- Erreurs nouvelles : `CL032` → `409 VENDOR_SESSION_INVALID` ; `CL033` → `401 VENDOR_PIN_INVALID`. Existantes :
  `CL001` (paramètre), `P0002` (introuvable / hors périmètre), `CL030` et `42501` (terminal suspendu / révoqué).
- Ce qui en dépend : WP04 (`sale_attribution` lit la session), WP05, WP07 (droits et vue), WP09 (routes).
- Droits : la migration fait `REVOKE ALL ON FUNCTION … FROM PUBLIC` sur chaque fonction et rien d'autre ; les accords
  à `cashless_app` et les retraits de table sont faits par WP07 dans `post-roles.sql`.

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en
affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus
longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ;
continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- 5e essai « compter d'abord » : on suit le contrat (4 PIN faux puis le bon PIN → bloqué) ; plus strict que la lettre de FR-004, consigné.
- `vendor_public` : vue exécutée avec les droits du propriétaire, `security_barrier`, filtrée sur `app.operator_id` (WP07 retire `INSERT`/`UPDATE` sur la vue).
- Purge de `vendor_pin_check` : `CREATE OR REPLACE` de `purge_device_enrollment_attempts()` à signature égale (déjà accordée et planifiée), `search_path` reposé, contrôles existants gardés.
- `set_vendor_status` vers le statut déjà en place : sans effet, sans audit, sans erreur.
- `close_vendor_session(p_device) RETURNS uuid` ; `vendor_admin_allowed` interne, jamais accordée.

## Branch Strategy

Planification et fusion sur `feat/terminaux-paiement-en-ligne`. Dépendances : aucune. Worktree attribué par lane
(`lanes.json`). Commande : `spec-kitty agent action implement WP02 --agent claude --mission
terminaux-paiement-en-ligne-01M52QB9`.

## Subtasks

### T006 — Tables `vendor`, `vendor_pin_check`, `vendor_session`, vue `vendor_public`

- `vendor` : colonnes de `data-model.md`. Contraintes : `display_name` (après `btrim`) de 1 à 80 caractères ;
  `pin_hash LIKE '$argon2id$v=19$%'` et longueur bornée (≤ 200) ; `status IN ('ACTIVE','DISABLED')` ;
  `failed_attempts BETWEEN 0 AND 5` ; `CHECK ((locked_at IS NOT NULL) = (failed_attempts = 5))`. FK `merchant_id` et
  `operator_id` → `party`. Index `(operator_id, merchant_id)`.
- `vendor_pin_check` : `(id, operator_id, vendor_id, device_id, created_at, expires_at, used_at)`,
  `CHECK (expires_at = created_at + interval '30 seconds')`. Index `(created_at)` pour la purge.
- `vendor_session` : colonnes de `data-model.md` ; `CHECK (expires_at = opened_at + interval '12 hours')` ;
  `closed_reason IN ('LOGOUT','REPLACED','VENDOR_DISABLED','VENDOR_LOCKED','DEVICE_SUSPENDED','DEVICE_REVOKED',
  'PIN_CHANGED')` ; `CHECK ((closed_at IS NULL) = (closed_reason IS NULL))`. Index unique partiel
  `vendor_session_open_per_device ON vendor_session (device_id) WHERE closed_at IS NULL` ; index
  `(vendor_id) WHERE closed_at IS NULL`.
- RLS activée **et forcée** sur les trois tables, politique `tenant_isolation` identique à 0022 (boucle `DO`).
- `vendor_public` : `id, operator_id, merchant_id, display_name, status, (locked_at IS NOT NULL) AS locked`.
  **Point de conception à respecter** : WP07 retire à `cashless_app` la lecture de `locked_at` sur `vendor` ; une vue
  `security_invoker` exigerait ce droit. La vue est donc exécutée avec les droits du propriétaire, déclarée
  `WITH (security_barrier = true)`, et **filtre elle-même** `WHERE operator_id = nullif(current_setting(
  'app.operator_id', true), '')::uuid` (le propriétaire local ignore la RLS : sans ce filtre, la vue montrerait tous
  les prestataires). Le dire en commentaire et le tester (T010). Si tu vois une meilleure option, soumets-la.

### T007 — `create_vendor`, `set_vendor_pin`, `set_vendor_status`

Toutes `SECURITY DEFINER SET search_path = public, pg_temp`, prestataire = `app.operator_id` (absent → `P0002`),
nommé dans chaque lecture et écriture (pas d'appui sur la RLS, comme 0022).
- Helper interne `vendor_admin_allowed(p_operator uuid, p_merchant uuid, p_actor uuid) RETURNS boolean` (STABLE) :
  personne `ACTIVE` du prestataire, attribution non révoquée, `MERCHANT_ADMIN` portée `MERCHANT` = `p_merchant`, ou
  `OPERATOR_ADMIN` du prestataire. Non accordée à `cashless_app` (à signaler à WP07, comme `device_admin_allowed`).
  Renforcement (la base revérifie l'auteur que l'API a contrôlé) : à consigner.
- `create_vendor(p_merchant uuid, p_display_name text, p_pin_hash text, p_actor uuid) RETURNS uuid` : commerçant =
  `party` `kind = 'MERCHANT'` du prestataire, sinon `P0002` ; auteur refusé → `P0002` ; paramètres invalides → `CL001`
  (sans écho de l'empreinte dans le message). `status = 'ACTIVE'`, `failed_attempts = 0`.
- `set_vendor_pin(p_vendor uuid, p_pin_hash text, p_actor uuid) RETURNS void` : vendeur `FOR UPDATE` ; nouvelle
  empreinte, `failed_attempts = 0`, `locked_at = NULL`, `updated_at = now()` ; sessions ouvertes du vendeur fermées
  (`PIN_CHANGED`).
- `set_vendor_status(p_vendor uuid, p_status text, p_actor uuid) RETURNS void` : `ACTIVE` ⇄ `DISABLED` ; passage à
  `DISABLED` → sessions ouvertes fermées (`VENDOR_DISABLED`). Réactiver ne rouvre rien et ne débloque pas.
  **Point à trancher** (non dit au plan) : même statut demandé → sans effet et sans erreur (proposition), ou `CL029` ;
  signale ton choix.
- Ordre des verrous : vendeur `FOR UPDATE`, puis sessions du vendeur.

### T008 — `begin_vendor_pin_check`, `open_vendor_session`, `close_vendor_session`, `assert_vendor_session`

- `begin_vendor_pin_check(p_vendor uuid, p_device uuid) RETURNS TABLE (check_id uuid, pin_hash text, locked boolean)`
  — transaction A, validée par l'API :
  1. terminal du prestataire `FOR SHARE` (absent → `P0002`) ; `REVOKED` → `42501`, `SUSPENDED` → `CL030` (comme
     `assert_device_active`) ;
  2. vendeur `FOR UPDATE` ; s'il n'existe pas, n'est pas du prestataire, n'est pas `ACTIVE`, est bloqué, ou si son
     commerçant n'est pas celui du point de vente du terminal (`device.pos_id` → `point_of_sale.participation_id` →
     `merchant_participation.merchant_id`), ou si le mode du terminal n'est pas `CATALOG_POS`/`KEYPAD_TPE`, ou si le
     terminal n'a pas de point de vente : **zéro ligne, rien n'est écrit** (l'API utilise l'empreinte factice) ;
  3. sinon `failed_attempts + 1` (compté **avant** la vérification) ; à 5 : `locked_at = now()` et sessions ouvertes du
     vendeur fermées (`VENDOR_LOCKED`) ; insertion d'un `vendor_pin_check` (30 s) ; rend `check_id`, `pin_hash`, et
     `locked` = vrai si ce compte vient de bloquer (l'API audite `VENDOR_LOCKED`).
  Le compteur ne dépasse jamais 5 : un vendeur bloqué n'est plus compté.
  **Point à trancher, à soumettre avant de coder T008** : avec ce texte (celui du contrat), le 5e essai est bloqué
  avant d'être vérifié, donc 4 PIN faux puis le bon PIN bloquent le vendeur, alors que FR-004 dit « bloqué après 5 PIN
  faux ». C'est plus strict (pas un affaiblissement) : par défaut, suis le contrat et signale l'écart dans le compte
  rendu ; ne code une variante qu'après décision du porteur.
- `open_vendor_session(p_check uuid, p_device uuid) RETURNS TABLE (vendor_session_id uuid, vendor_id uuid,
  vendor_display_name text, expires_at timestamptz)` — transaction B, appelée seulement si le PIN est bon. Verrous :
  terminal `FOR SHARE`, vendeur du check `FOR UPDATE` (lu d'abord sans verrou), check `FOR UPDATE`, sessions du
  terminal. Revérifie tout : check du prestataire, de ce terminal, `used_at IS NULL`, `expires_at > now()` ; vendeur
  `ACTIVE`, non bloqué, du commerçant du point de vente du terminal ; terminal `ACTIVE` ; mode `CATALOG_POS` ou
  `KEYPAD_TPE`. Tout échec → `CL033` (même SQLSTATE pour chaque cause, aucun détail exploitable dans le message).
  Succès : `used_at = now()`, `failed_attempts = 0`, session ouverte du terminal fermée (`REPLACED`), nouvelle
  session (`opened_at = now()`, `expires_at = now() + 12 h`).
- `close_vendor_session(p_device uuid) RETURNS uuid` : terminal `FOR SHARE`, ferme la session ouverte du terminal
  (`LOGOUT`) et rend son identifiant, ou NULL s'il n'y en a pas (l'API décide de la réponse). **Signature proposée**
  (« arrêtées à l'implémentation », database-rights.md) : signale-la à WP07.
- `assert_vendor_session(p_device uuid, p_session uuid) RETURNS uuid` (vendeur) : lit sans verrou le vendeur de la
  session, prend `FOR SHARE` le vendeur puis la session, puis revérifie : session du prestataire, de ce terminal,
  ouverte, égale à `p_session`, `expires_at > now()`, vendeur `ACTIVE` et non bloqué ; sinon `CL032`. Ne prend pas
  le terminal (l'appelant a déjà pris `record_device_seq` / `assert_device_active` avant, ordre global).
- Purge de `vendor_pin_check` (data-model : « avec les essais d'enrôlement, plus de 24 h ») : **point à trancher** ;
  proposition : `CREATE OR REPLACE` de `purge_device_enrollment_attempts()` (0022, même signature, déjà accordée et
  planifiée par le travailleur) qui supprime aussi les essais de PIN de plus de 24 h. Si l'orchestrateur refuse,
  signale le manque (une nouvelle fonction devrait être accordée par WP07 et branchée par WP09).

### T009 — `set_device_status` remplacée : fermeture des sessions

`CREATE OR REPLACE FUNCTION set_device_status(p_device uuid, p_to text, p_reason text, p_actor uuid)` : reprendre
**à l'identique** le corps de la dernière définition (0022 ; aucune migration ultérieure ne la remplace — vérifié) :
prestataire de session, statut cible, motif 1-500, terminal `FOR UPDATE`, `device_admin_allowed`, transitions
(`CL029`), familles de jetons révoquées vers `REVOKED`, historique. Ajouter, après la mise à jour du statut et dans
le même ordre (terminal, puis sessions) : vers `SUSPENDED` → sessions ouvertes du terminal fermées
(`DEVICE_SUSPENDED`) ; vers `REVOKED` → `DEVICE_REVOKED`. Retour à `ACTIVE` : rien rouvert. Garder `SECURITY DEFINER
SET search_path = public, pg_temp` (un `CREATE OR REPLACE` efface le réglage, règle de 0021) et rejouer `REVOKE ALL …
FROM PUBLIC`. Placer cette fonction **après** la création de `vendor_session` dans la migration.

### T010 — Suite `tests_vendors.sql`

Style de `tests/tests_device_enrollment.sql` (`BEGIN`, `no_plan()`, `pg_temp.id`, deux prestataires, `ROLLBACK`).
Cas : structure (SECURITY DEFINER, `search_path`, non exécutable par `PUBLIC` pour chaque fonction ; RLS forcée sur
les trois tables) ; contraintes (empreinte non PHC, nom vide ou de 81 caractères, compteur 6, `locked_at` sans
compteur 5, deuxième session ouverte sur un terminal → violation de l'index) ; `create_vendor` (auteur
`MERCHANT_ADMIN` du commerçant, `OPERATOR_ADMIN`, auteur d'un autre commerçant → `P0002`, commerçant d'un autre
prestataire → `P0002`) ; compter d'abord (1 à 4 : compteur monte, check rendu ; 5e : `locked = true`, `locked_at`
posé, sessions du vendeur fermées `VENDOR_LOCKED` ; 6e : zéro ligne, compteur reste 5) ; vendeur d'un autre
commerçant, `DISABLED`, inconnu, terminal `TOPUP_DESK` : zéro ligne et compteur inchangé ; `open_vendor_session` :
succès (compteur à 0, session précédente `REPLACED`), check expiré (poser `created_at`/`expires_at` dans le passé
en propriétaire), déjà utilisé, d'un autre terminal, vendeur bloqué ou désactivé entre A et B → `CL033` ;
`assert_vendor_session` : session valide, autre identifiant, expirée, fermée, vendeur désactivé → `CL032` ;
`set_vendor_pin` débloque et ferme (`PIN_CHANGED`) ; `set_vendor_status` ferme (`VENDOR_DISABLED`) ;
`set_device_status` ferme à `SUSPENDED` et `REVOKED`, ne rouvre pas à `ACTIVE`, et garde ses refus (rejouer ceux de
0022 : motif vide, transition interdite, auteur hors périmètre) ; `vendor_public` : `locked` exact, autre prestataire
invisible, aucun prestataire de session → zéro ligne ; ordre des verrous : après `begin_vendor_pin_check`,
`pg_locks` montre le terminal en `RowShareLock`/partagé et le vendeur en exclusif (une seule session : pas de
concurrence réelle, prouvée par WP09/WP14). Ne teste pas les droits de `cashless_app` (WP07).

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w
@cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`.
Jamais pgTAP sur une base où Jest vient de tourner (rejouer `reset-db`). La base partagée appartient à
l'orchestrateur : valide ton SQL sur un cluster PostgreSQL 17 jetable dans le scratchpad, ou demande-lui de lancer
les suites ; tests en série seulement. Dans un worktree de lane, crée d'abord les liens
`node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de la base Docker qui peut reculer : aucun
test ne compare l'heure de Node à `now()` sans marge. Non-régression attendue : `tests_device_enrollment.sql`,
`tests_device_tokens.sql`, `tests_execute_grants.sql`, `tests_definer_search_path.sql`, `tests_device_purge_window.sql`
restent vertes.

## Definition of Done

- `0031_vendors.sql` rejouable après `reset-db` ; toutes les suites pgTAP vertes, dont `tests_vendors.sql`.
- Chaque fonction : `SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC` ; aucun `GRANT`.
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status Txxx --status done --mission
  terminaux-paiement-en-ligne-01M52QB9`.
- Compte rendu du lot en fin de ce fichier : écarts au plan (sens : renforcement ou non), retouches hors carte (une
  ligne de justification chacune), points soumis au porteur (au moins le 5e essai et la purge), signatures finales
  pour WP07 et WP09, fichiers à faire relire par une personne (`0031_vendors.sql` : `SECURITY DEFINER`, verrous,
  vue `vendor_public`, `set_device_status` remplacée), **critères d'acceptation couverts avec leur preuve** (fichier
  de test et nom du cas, pour `acceptance-matrix.json`).

## Risks

- Compteur au-delà de 5 ou essai non compté sur un chemin : NFR-003 tombe.
- Vue `vendor_public` qui fuit entre prestataires (propriétaire qui ignore la RLS).
- `set_device_status` remplacée qui perd un contrôle de 0022 ou son `search_path`.
- Interblocage si une fonction prend vendeur avant terminal, ou session avant vendeur.

## Reviewer Guidance

Vérifier, refus par refus : vendeur inconnu, d'un autre commerçant, désactivé ou bloqué → zéro ligne et rien
d'écrit ; compteur jamais > 5 ; le 5e compte bloque et ferme les sessions ; `open_vendor_session` revérifie chaque
condition et rend le même `CL033` ; check à usage unique et borné à 30 s ; une session par terminal ;
`assert_vendor_session` exige l'égalité avec l'identifiant reçu ; ordre terminal → vendeur → session partout ;
`set_device_status` identique à 0022 hors fermeture des sessions (diff du corps) ; vue filtrée par le prestataire de
session ; aucune empreinte dans un message d'erreur ; aucun `GRANT` dans la migration.
