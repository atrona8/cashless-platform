---
work_package_id: WP02
title: Base de données — remboursements, IBAN chiffré, passerelles, App Attest
dependencies: []
requirement_refs: [FR-010, FR-011, FR-012, FR-018, FR-020, C-004]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: Planning artifacts for this mission were generated on feat/durcissements-serveur. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
subtasks: [T005, T006, T007, T008, T009]
phase: Phase 1 - Base
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/
create_intent:
- packages/ledger-sql/migrations/0092_refund_request_insert_guard.sql
- packages/ledger-sql/migrations/0093_iban_sealed.sql
- packages/ledger-sql/migrations/0094_register_edge_gateway_ledger.sql
- packages/ledger-sql/migrations/0095_device_app_attest_key.sql
- packages/ledger-sql/tests/tests_refund_insert_guard.sql
- packages/ledger-sql/tests/tests_iban_sealed.sql
- packages/ledger-sql/tests/tests_device_app_attest.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/migrations/0092_refund_request_insert_guard.sql
- packages/ledger-sql/migrations/0093_iban_sealed.sql
- packages/ledger-sql/migrations/0094_register_edge_gateway_ledger.sql
- packages/ledger-sql/migrations/0095_device_app_attest_key.sql
- packages/ledger-sql/tests/tests_refund_insert_guard.sql
- packages/ledger-sql/tests/tests_iban_sealed.sql
- packages/ledger-sql/tests/tests_device_app_attest.sql
- packages/ledger-sql/tests/tests_refund_transitions.sql
- packages/ledger-sql/tests/tests_cash_sessions.sql
- packages/ledger-sql/tests/tests_edge_gateway.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 : Base de données, remboursements, IBAN chiffré, passerelles, App Attest

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis la fiche commune
`docs/passation-11a/fiche-implementation.md`, ce prompt, puis seulement :

- `interfaces.md` (table « Base de données ») ; `plan.md` IC-04, IC-07 (`CHECK`), IC-08, IC-09 et les trois « Décisions
  différées » (tranchées le 18/11/2026) ; `spec.md` FR-010 à FR-012, FR-018, FR-020 ;
- `research/R-9b-iban-remboursements-versements.md` §1.2, §1.4 point 6, §2 ;
  `research/R-N64-N116-app-attest- passerelles.md` A1 à A3 et B1 à B3 ;
- migrations : `0081_refund_requests.sql`, `0085_payouts.sql` l. 30-50, `0086_refund_debts.sql` l. 19-160,
  `0035_enrollment_event_state.sql` l. 105-fin (**dernière** `enroll_device`, à reprendre en entier),
  `0022_device_enrollment.sql` l. 57-82 et 219-221, `0058_edge_gateway_admin.sql` l. 130-225, `0069_*` l. ~71 (modèle de
  `DROP FUNCTION`), `0063_edge_replication.sql` l. 540-560 ;
- tests à mettre à jour : `tests_refund_transitions.sql` l. 280-380, `tests_cash_sessions.sql` l. 185-210 et 510-600,
  `tests_edge_gateway.sql` l. 60-110, 190-245, 265-275 ; modèle `tests_refund_requests.sql` l. 280-340.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective
Quatre migrations qui rendent la base seule juge de ce que le code garantissait : une demande de remboursement née par
l'API n'a que son état initial (`0092`, et retrait de `refund_deposit_for_session(uuid, uuid)`) ; aucun IBAN en clair
ne s'écrit plus sur `refund_request` ni `payout` (`0093`) ; l'inscription d'une passerelle rend le grand livre de
l'événement (`0094`) ; la clé App Attest d'un iPhone et son compteur ont leur table et leurs fonctions (`0095`).
Ce lot **n'accorde ni ne retire aucun droit** (WP03) et prouve ses objets **en propriétaire**.

## Context
- Dernière migration existante `0089` ; tu poses `0092` à `0095` (WP01 prend `0090` et `0091`). Aucun `.sql` généré ni
  migration antérieure ne se retouche (C-004).
- **Décisions du porteur du 18/11/2026 qui s'appliquent** : (1) l'IBAN est chiffré par une clé de configuration de l'API
  (côté TypeScript, WP08) : ici, seul le `CHECK` en base ; (2) `refund_deposit(uuid, uuid)` reste en base, interne,
  exécutable par personne (droits : WP03, test) : **tu ne la retires pas**, tu retires seulement
  `refund_deposit_for_session(uuid, uuid)` ; (3) un seul `EXECUTE` nouveau pour `cashless_app` hors OP-N60 :
  `advance_app_attest_counter`, étroit (WP03 l'accorde).
- Codes `SQLSTATE` à poser : `CL057` insertion de demande refusée ; `CL058` grand livre d'inscription introuvable ou
  ambigu ; `CL059` appareil App Attest refusé. Les mappages HTTP sont à WP09, WP12 et WP13, pas à toi.
- **Piège majeur** : `migrate.ts` applique migrations, `roles.sql` et `post-roles.sql` dans UNE transaction. Or
  `post-roles.sql` accorde `EXECUTE` sur des signatures que tu **retires** : l. 462 (`enroll_device` à 13 arguments) et
  l. 711 (`refund_deposit_for_session(uuid, uuid)`). Tant que WP03 n'a pas fusionné, `reset-db.sh` échoue et **annule
  toute la série**. Contournement, **local et jamais commité** : édite ces deux lignes dans ta lane (signature à 15
  arguments ; supprime l. 711) le temps des preuves, puis `git checkout -- packages/ledger-sql/post-roles.sql` avant
  `git add`. Dis-le dans ta note : c'est pourquoi WP03 dépend de ce lot. Les suites de droits figées échouent de toute
  façon.
- Aucune reprise de lignes d'IBAN existantes (plan IC-07) : le `CHECK` est `NOT VALID`.

## Subtasks
### T005 : `0092_refund_request_insert_guard.sql`
1. `refund_request_insert_guard()` : déclencheur `BEFORE INSERT ON refund_request FOR EACH ROW`, fonction **non**
   `DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC` (modèle : gardes de `0086`). Il ne
   s'applique qu'à la session `cashless_app` : `pg_has_role(current_user, 'cashless_app', 'MEMBER')`. Pour elle :
   `status` ∈ {`AWAITING_HOLDER`, `REQUESTED`} seulement ; `holder_decision`, `holder_decided_at`,
   `approval_request_id`, `approved_by`, `transaction_id`, `external_reference`, `failure_reason`, `reject_reason`,
   `reversal_transaction_id`, `confirmed_by`, `confirmed_at` tous nuls ; sinon
   `RAISE EXCEPTION … USING ERRCODE = 'CL057'`. Les fixtures du propriétaire (`statement-fixtures.ts`,
   `refund-flow-fixtures.ts`, `tests_statements.sql`) insèrent des états finals : le déclencheur doit les laisser passer
   (R-9b §2.2 point 2). Ne fais pas un déclencheur inconditionnel.
2. `CREATE TRIGGER refund_request_insert_guard BEFORE INSERT …` (l'ordre alphabétique des déclencheurs n'importe pas
   ici).
3. `DROP FUNCTION refund_deposit_for_session(uuid, uuid);` (seule la surcharge à deux arguments ; la surcharge à quatre
   arguments de `0086` reste). Contrôle d'abord par `grep` dans `migrations/`, `apps/`, `tools/`, `packages/` qu'aucun
   appelant n'existe hors `tests/` écrits à la main (R-9b §2.3 : aucun appel TypeScript).
- `refund_deposit(uuid, uuid)` : **ne pas toucher** (décision 2).
- Les droits de colonne d'`INSERT` (16 colonnes) sont à WP03 : ici, seulement le déclencheur (défense en profondeur).
- Mutation (NFR-004) : désactive le déclencheur (`ALTER TABLE … DISABLE TRIGGER`) dans une transaction de test :
  l'`INSERT` en `CANCELLED` sous `cashless_app` doit alors passer ; réactive. Note le résultat.

### T006 : `0093_iban_sealed.sql`
`ALTER TABLE refund_request ADD CONSTRAINT refund_request_iban_sealed CHECK (iban IS NULL OR iban LIKE 'enc:v1:%')
NOT VALID;` et la même sur `payout` (`payout_iban_sealed`) ; noms figés par `interfaces.md`. `NOT VALID` : lignes
anciennes tolérées, toute écriture à venir porte l'enveloppe ; le `CHECK` `payout_destination_bank` (0085) reste
satisfait.
- **Ne modifie pas** les gardes de transition de `0085`/`0086` : un chiffrement à IV aléatoire n'est jamais comparé, la
  colonne ne change pas à l'`UPDATE` (R-9b §1.2). Aucune reprise de lignes, aucun outil `iban-seal`.
- Preuve : `tests_iban_sealed.sql` (T009). Mutation : retire le `CHECK` (`DROP CONSTRAINT`) en transaction : l'`INSERT`
  en clair doit passer ; remets, note le résultat.

### T007 : `0094_register_edge_gateway_ledger.sql`
Changer le type de retour interdit `CREATE OR REPLACE` (`42P13`) : `DROP FUNCTION register_edge_gateway(uuid, uuid,
text, text, bytea, bytea, bytea, text, text);` puis `CREATE FUNCTION` avec les **mêmes neuf arguments** que `0058` et
`RETURNS TABLE (gateway_id uuid, ledger_id uuid)`, `SECURITY DEFINER SET search_path = public, pg_temp`.
- Reprends le corps de `0058` à l'identique, avec `#variable_conflict use_column` en tête (les colonnes de sortie
  entrent en conflit avec celles des tables lues) ; **sous le verrou de l'événement** (`edge_event_lock`), avant
  l'`INSERT` :
  `SELECT l.id … FROM ledger l WHERE l.scope_type = 'EVENT' AND l.scope_id = p_event AND l.operator_id = p_operator`.
  Aucun grand livre : `CL058` ; plusieurs (multi-devise) : `CL058`, message distinct ; **rien d'écrit** dans les deux
  cas. Ne modifie pas `identify_edge_gateway`.
- L'audit `EDGE_GATEWAY_REGISTERED` ajoute `ledger_id` au JSON. Renvoie `(v_id, v_ledger)`.
- `REVOKE ALL ON FUNCTION register_edge_gateway(…) FROM PUBLIC` dans la migration (le `DROP` emporte les droits ;
  `post-roles.sql` § 9e les rend à `cashless_edgeadmin`, mêmes arguments). Aucun droit nouveau, aucun appelant dans
  `apps/` ; l'outil `tools/edge-admin` est à WP12.
- **Tests à adapter dans tes fichiers** (`tests_edge_gateway.sql` l. 68, 194 :
  `INSERT … SELECT register_edge_gateway(…)` devient `SELECT gateway_id FROM register_edge_gateway(…)` ; l. 87-109, 243
  : `throws_ok`/`lives_ok` inchangés dans leur forme). Ajoute : événement sans grand livre : `CL058` et aucune ligne
  `edge_gateway` écrite ; le `ledger_id` rendu égale celui d'`identify_edge_gateway` ; événement d'un autre prestataire
  : `no_data_found` inchangé ; deux grands livres (deux devises) sur un événement : `CL058`.

### T008 : `0095_device_app_attest_key.sql`
R-N64 A3 (table dédiée, pas de colonne sur `device`) ; noms figés par `interfaces.md`.
1. Table `device_app_attest_key` : `device_id uuid PRIMARY KEY REFERENCES device(id)`,
   `operator_id uuid NOT NULL REFERENCES party(id)`, `key_id bytea NOT NULL UNIQUE CHECK (octet_length(key_id) = 32)`,
   `public_key bytea NOT NULL` (SPKI),
   `counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0 AND counter <= 4294967295)`, `created_at`,
   `updated_at timestamptz NOT NULL DEFAULT now()`. RLS **activée et forcée**, politique `tenant_isolation` copiée de
   `0022` l. 219-221. **Aucun `GRANT`/`REVOKE`** (WP03 retire à `cashless_app` le `INSERT`/`UPDATE` que `roles.sql` rend
   par défaut ; le test de WP03 le prouve). Aucun déclencheur de réplication de passerelle (0063) : la clé reste au
   central.
2. `enroll_device` **nouvelle version** : `DROP FUNCTION enroll_device(<13 types de 0035>)` puis `CREATE FUNCTION` avec
   les arguments d'`0035` **plus** `p_app_attest_key_id bytea DEFAULT NULL, p_app_attest_public_key bytea DEFAULT NULL`
   (les appels positionnels existants à 13 arguments restent valides ; **aucune surcharge** : l'ancienne signature est
   retirée dans la même migration, sinon appel ambigu). Reprends le corps d'`0035` **en entier et à l'identique**, puis
   ajoute après l'insertion de l'appareil : si les deux nouveaux arguments sont fournis, exige `p_os = 'IOS'` et
   `p_attestation_kind = 'IOS_APP_ATTEST'`, `octet_length(p_app_attest_key_id) = 32`, clé publique non vide, et insère
   la ligne de `device_app_attest_key` (même transaction : un échec annule l'enrôlement) ; un seul des deux arguments,
   ou fournis hors iOS : `CL001`. Même `RETURNS TABLE (device_id uuid, next_seq bigint)`, mêmes `SET search_path` et
   `#variable_conflict`. `REVOKE ALL … FROM PUBLIC` sur la nouvelle signature.
3. `advance_app_attest_counter(p_device uuid, p_key_id bytea, p_counter bigint) RETURNS boolean` :
   `DEFINER SET search_path = public, pg_temp`. **Un seul `UPDATE` conditionnel** (jamais `SELECT` puis `UPDATE`) :
   `UPDATE device_app_attest_key k SET counter = p_counter, updated_at = now() FROM device d WHERE k.device_id =
   p_device AND k.key_id = p_key_id AND k.counter < p_counter AND k.operator_id = <prestataire de session> AND d.id =
   k.device_id AND d.status <> 'REVOKED'`
   ; rend `FOUND`. Avant : appareil introuvable, d'un autre prestataire ou `REVOKED` : `RAISE … USING ERRCODE = 'CL059'`
   ; `p_counter` hors `[0, 4294967295]` : `CL059`. Compteur non supérieur : `false`, sans erreur. Prestataire de session
   lu comme dans `enroll_device` (`nullif(current_setting('app.operator_id', true), '')::uuid`), refus si absent.
4. `REVOKE ALL ON FUNCTION advance_app_attest_counter(uuid, bytea, bigint) FROM PUBLIC`.
- Piège : le verrou de ligne du `UPDATE` sérialise deux assertions de même compteur ; ne l'« optimise » pas.
- Mutation : remplace `k.counter < p_counter` par `<=` ; le test « même compteur rendu : `false` » doit échouer.

### T009 : pgTAP des objets de `0092` à `0095` et références mises à jour
Nouveaux fichiers (`BEGIN`, `no_plan`, fixtures en propriétaire, `ROLLBACK`) :
- `tests_refund_insert_guard.sql` : sous `SET LOCAL ROLE cashless_app`, `INSERT` en `PAID`, `CANCELLED`, `FAILED`,
  `REJECTED` refusés (`CL057` ou `23514` selon la barrière qui parle d'abord : **écris le code obtenu**) ; `REQUESTED`
  avec `approved_by`, `transaction_id` ou `confirmed_at` : `CL057` ; positifs : `AWAITING_HOLDER` et `REQUESTED` à
  colonnes de transition nulles passent ; en propriétaire un `INSERT` en `PAID` complet passe ; le déclencheur est
  `BEFORE INSERT` et exécutable par personne d'autre que le propriétaire.
- `tests_iban_sealed.sql` : IBAN en clair refusé sur les deux tables (`23514`, nom de contrainte) ; `enc:v1:k1:AAAA` et
  `NULL` acceptés ; `convalidated = false` ; une ligne ancienne insérée avant les contraintes reste lisible.
- `tests_device_app_attest.sql` : enrôlement iOS avec clé : ligne créée, `counter = 0`, `key_id` de 32 octets ; sans clé
  : aucune ligne ; clé pour Android : `CL001` et appareil non créé ; `key_id` pris : `23505` ; appels à 13 arguments
  valides ; `advance_app_attest_counter` : `true` si croissant, `false` si égal ou inférieur, `CL059` si `REVOKED`,
  autre prestataire ou hors plage ; deux appels de même compteur : un seul `true` ; RLS : B ne voit rien de A.
Fichiers existants à mettre à jour (liste exhaustive de tes retouches) :
- `tests_refund_transitions.sql` l. 289-293 : `has_function … deux arguments conservée` devient
  `hasnt_function('refund_deposit_for_session', ARRAY['uuid','uuid'], …)` ; supprime les appels à deux arguments (l.
  318-319, 366-367) ou passe-les à quatre arguments `(…, NULL, NULL)` avec commentaire ; garde la preuve que
  `refund_deposit(uuid, uuid)` existe et n'est exécutable par personne côté applicatif.
- `tests_cash_sessions.sql` l. 194-207 (comptes par nom : compte par signature, avec commentaire) et l. 518, 561, 587,
  597 (quatre arguments avec `NULL, NULL`). Chaque ligne modifiée est listée dans ta note. `tests_edge_gateway.sql` :
  T007.
- `tests_edge_gateway.sql` : voir T007.

## Tests et preuves
Base `cashless_wp02`, serveur 5433, depuis la lane, **avec la retouche locale de `post-roles.sql` décrite en Context** :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp02
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh
cd packages/ledger-sql
pg_prove -d cashless_wp02 tests/tests_refund_insert_guard.sql tests/tests_iban_sealed.sql \
  tests/tests_device_app_attest.sql tests/tests_edge_gateway.sql tests/tests_refund_transitions.sql \
  tests/tests_cash_sessions.sql tests/tests_refund_requests.sql tests/tests_device_enrollment.sql \
  tests/tests_enrollment_event_state.sql
```

`tests_edge_rights.sql`, `tests_execute_grants.sql`, `tests_cash_psp_rights.sql` et les autres suites de droits
échouent sur les signatures changées : c'est WP03, ne les touche pas. Avant le commit : `git checkout --
packages/ledger-sql/post-roles.sql` puis `git status` (seuls tes fichiers).

## Branch Strategy
Planification et fusion : `feat/durcissements-serveur` ; worktree de lane calculé par `lanes.json`. Commande :
`LC_ALL=C LANG=C spec-kitty agent action implement WP02 --agent claude --mission durcissements-serveur-01M7QAJD`.

## Definition of Done
- [ ] `0092` (déclencheur `CL057` ; `refund_deposit_for_session(uuid, uuid)` retirée, `refund_deposit(uuid, uuid)`
      intacte), `0093` (deux `CHECK … NOT VALID`), `0094` (retour `(gateway_id, ledger_id)`, `CL058` sans écriture),
      `0095` (table à RLS forcée, `enroll_device` à 15 arguments sans ancienne signature, compteur atomique).
- [ ] Aucun `GRANT`/`REVOKE` hors `FROM PUBLIC` ; aucune migration antérieure retouchée ; `post-roles.sql` non commité.
- [ ] Trois suites nouvelles et trois mises à jour vertes sur `cashless_wp02` ; mutations notées.
- [ ] Note de lane : retouches de tests ligne par ligne, `SQLSTATE` réellement obtenus, signature d'`enroll_device`.

## Risks
- Reprise d'`enroll_device` : toute divergence avec `0035` casse l'enrôlement (`diff` ligne à ligne). Fonction
  `DEFINER` sous propriétaire superutilisateur : nomme le prestataire dans chaque requête ; avant un `DROP`, `grep` de
  `pg_proc.prosrc` pour les appelants.

## Ce que le relecteur doit casser
- Insérer sous `cashless_app` une demande `PAID`, `CANCELLED`, `FAILED`, avec `approved_by` ou `external_reference`, par
  `INSERT` direct et `INSERT … SELECT` multi-lignes ; le déclencheur ne se désactive qu'au propriétaire.
- Écrire un IBAN en clair (espaces, `ENC:V1:`, `enc:v2:`) dans `refund_request` ou `payout`.
- `register_edge_gateway` pour un événement sans grand livre, avec deux, d'un autre prestataire : rien d'écrit.
- `advance_app_attest_counter` : deux appels concurrents de même compteur, appareil `REVOKED`, autre prestataire,
  mauvais `key_id`, `p_counter` à `-1` ou `4294967296` ; lecture croisée de `device_app_attest_key`.
- `enroll_device` : 13 arguments par position, clé sur un appareil Android, un seul des deux arguments ; une seule
  signature dans `pg_proc`. Test qui ne prouve rien, mutation non rejouée, droit accordé ou retiré, `post-roles.sql`
  commité.

## Fichiers à faire relire par une personne
`0092_refund_request_insert_guard.sql`, `0094_register_edge_gateway_ledger.sql`, `0095_device_app_attest_key.sql`
(surtout `advance_app_attest_counter` et la reprise d'`enroll_device`).
