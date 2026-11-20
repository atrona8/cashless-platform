---
work_package_id: WP03
title: Base de données — avis de solde provisoire et canaux d'envoi des codes
dependencies: []
requirement_refs:
- FR-010
- FR-013
planning_base_branch: feat/serveur-app-festivalier
merge_target_branch: feat/serveur-app-festivalier
branch_strategy: Planning artifacts for this mission were generated on feat/serveur-app-festivalier. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/serveur-app-festivalier unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-serveur-app-festivalier-01M7WB69
base_commit: 32be3fc8b41f7abc63c65e408963a3753d75f209
created_at: '2026-11-20T14:47:56.878762+00:00'
subtasks: [T011, T012, T013]
phase: Phase 1 - Base de données
agent: claude
history:
- timestamp: '2026-11-20T10:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/
create_intent:
- packages/ledger-sql/migrations/0098_pending_offline_notice.sql
- packages/ledger-sql/migrations/0099_otp_channel_attempt.sql
- packages/ledger-sql/tests/tests_pending_offline_notice.sql
- packages/ledger-sql/tests/tests_otp_channel_attempt.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/migrations/0098_pending_offline_notice.sql
- packages/ledger-sql/migrations/0099_otp_channel_attempt.sql
- packages/ledger-sql/tests/tests_pending_offline_notice.sql
- packages/ledger-sql/tests/tests_otp_channel_attempt.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 : Base de données, avis hors ligne et canaux d'envoi

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-10a/fiche-implementation.md`, ce prompt, puis seulement :

- `interfaces.md` de la mission (lignes `wallet_pending_offline_notice` et `otp_channel_attempt`, et
  le paragraphe sur l'`EXECUTE` de `cashless_app` : table `otp_channel_attempt` : `INSERT`, `UPDATE
  (confirmed_at, failed_reason)`, `SELECT`) ; `contracts/otp-sender-chain.md` ; `plan.md` IC-05 et
  IC-06 ; `spec.md` FR-010 à FR-013, NFR-002, NFR-004 ; `research.md` R-07 et R-08 ;
- `packages/ledger-sql/migrations/0048_offline_device_vendor.sql` l. 55-70 (`offline_snapshot_ack` :
  colonnes, index, RLS, ajout seul) ; `schema_grand_livre_cashless.sql` l. 2119-2145
  (`offline_batch`), l. 150-179 (`device`, `status` dont `REVOKED`), l. 202-218 (`ledger`,
  `scope_type`, `scope_id`), l. 41 (type `event_status`), l. 220-228 (`wallet`) ;
- `migrations/0080_customer_auth.sql` l. 37-58 (`otp_challenge`, sa RLS et ses index) ;
  `0081_refund_requests.sql` l. 103-110 (colonnes `purpose` et `subject_id`) ;
- `tests/tests_offline_device_vendor.sql` l. 123-126 (insertion d'accusés) et l. 330-336 (insertion
  d'un `offline_batch`) ; `tests_payment_rights.sql` l. 89-100 (terminaux, grand livre) ;
  `tests_customer_auth.sql` l. 13-33 (comptes, défis) et l. 38-65 (preuves de RLS et de droits).

Priorité des sources (SPECIFICATION §0.3). `interfaces.md` fait foi ; contradiction ou manque : tu
la signales, tu ne la tranches pas en silence.

## Objective

Deux objets de base pour la suite : (1) `wallet_pending_offline_notice`, le booléen que `/me` (WP09)
rend en `pending_offline_notice` : le solde affiché peut être provisoire parce qu'un terminal hors
ligne n'a pas encore remonté ses achats ; (2) la table `otp_channel_attempt` qui note chaque canal
essayé d'une chaîne d'envoi (WP10), **sans jamais porter le code**. Ce lot **n'accorde ni ne retire
aucun droit** : WP04 pose les `EXECUTE` et les droits de table. Tests en propriétaire, isolation par
`SET LOCAL ROLE cashless_app` quand une preuve de RLS l'exige (le propriétaire local ignore la RLS).

## Context

- Dernière migration existante : `0095` ; tes deux : `0098` et `0099` (WP01 : `0096`, WP02 :
  `0097`). Aucune migration existante, aucun `.sql` généré ne se retouche.
- **Décision du porteur (plan, 20/11/2026)** : le code OTP reste en mémoire du processus, **jamais
  en base ni dans un journal** (NFR-002) ; la table ne note que le canal, le fournisseur et le
  résultat. Les bascules de la chaîne ne créent pas de défi : une ligne de cette table, pas une
  ligne `otp_challenge`.
- **Contradictions et manques à signaler (ne pas trancher en silence)** :
  1. `interfaces.md` dit « événement du grand livre non `CLOSED` » : seul un grand livre de portée
     `EVENT` désigne un événement (`ledger.scope_type`, `scope_id`, l. 205-206). Pour `ORGANIZER` ou
     `OPERATOR_BILLING`, retiens **faux** (aucun événement à comparer) et signale-le.
  2. « dernier `offline_batch` » : `offline_batch.status` vaut `PROCESSING`, `COMPLETED` ou
     `REJECTED`. Retiens **tous les statuts** (littéral : le terminal a remonté quelque chose) et
     signale-le.
  3. `plan.md` et `research.md` annoncent l'index `offline_snapshot_ack (ledger_id, device_id,
     acked_at)` ; l'existant est `(device_id, acked_at)` (0048 l. 63) et la clé `(device_id,
     version)`.
  4. `data-model.md` place `printed_number` en `0098` et les canaux en `0099` ; `interfaces.md` (qui
     fait foi) donne `0097` à WP02, `0098` à l'avis, `0099` aux canaux. Suis `interfaces.md`.

## Subtasks

### T011 : `wallet_pending_offline_notice` et index (migration `0098`)

`wallet_pending_offline_notice(p_wallet uuid) RETURNS boolean`, `STABLE`, `SECURITY INVOKER` (la RLS
de l'appelant s'applique ; **pas** de `SECURITY DEFINER`, pas d'`assert_tenant`). Vrai si, pour le
portefeuille :
1. son grand livre est de portée `EVENT` et l'événement n'est pas `CLOSED` (`event.status <>
   'CLOSED'`, type `event_status` : `DRAFT`, `LIVE`, `CLOSING`, `RECONCILING`, `SETTLING`,
   `REFUND_WINDOW`, `CLOSED`) ;
2. **et** il existe un terminal non révoqué (`device.status <> 'REVOKED'`, `SUSPENDED` compris) qui
   a un `offline_snapshot_ack` sur **ce** grand livre (`a.ledger_id = w.ledger_id`) plus récent que
   son dernier `offline_batch` (`a.acked_at > max(b.received_at)` pour ce `device_id`), ou qui n'a
   **aucun** lot (`coalesce(max(received_at), '-infinity')`). Portefeuille inconnu ou d'un autre
   prestataire (RLS) : **faux**, pas d'erreur. Une seule requête SQL (`LANGUAGE sql`), sans table
   temporaire ni écriture. Index, `CREATE INDEX IF NOT EXISTS` : `offline_batch (device_id,
   received_at)` et `offline_snapshot_ack (ledger_id, device_id, acked_at)` (tiens NFR-004 : cinq
   portefeuilles lus dans un `getMe` de 300 ms au 95e centile). `REVOKE ALL ON FUNCTION
   wallet_pending_offline_notice(uuid) FROM PUBLIC`. Pas de `GRANT`.
- Piège : plusieurs terminaux d'un même événement ; **un seul** terminal en attente suffit (vrai).
- Piège : un terminal qui a remonté un lot **après** son dernier accusé n'est plus en attente, même
  si d'autres terminaux le sont ; un terminal révoqué n'en compte pas, comme ceux d'un autre grand
  livre.
- Joins par `operator_id` inutiles (RLS), mais n'ajoute aucun contournement de la RLS.

### T012 : table `otp_channel_attempt` (migration `0099`)

Colonnes (`interfaces.md`, fait foi) : `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `operator_id
uuid NOT NULL REFERENCES party(id)`, `challenge_id uuid NOT NULL REFERENCES otp_challenge(id)`,
`channel text NOT NULL CHECK (channel IN ('WHATSAPP','SMS_PRIMARY','SMS_FALLBACK'))`, `provider text
NOT NULL` (1 à 64 caractères), `sent_at timestamptz NOT NULL DEFAULT clock_timestamp()`,
`confirmed_at timestamptz`, `failed_reason text`. **Aucune colonne de code, d'empreinte, de numéro
ni de texte libre.** Contraintes :
- `CHECK (confirmed_at IS NULL OR failed_reason IS NULL)` ;
- `failed_reason` : liste de raisons en capitales, `CHECK (failed_reason IS NULL OR failed_reason ~
  '^[A-Z0-9_]{1,40}$')` : un texte libre pourrait recevoir un numéro ou un code. **Renforcement**
  (WP10 écrit des raisons de ce format : `NO_WHATSAPP`, `TIMEOUT`, `REFUSED`...) : consigne-le dans
  la note ;
- clé étrangère composite `(challenge_id, operator_id)` vers `otp_challenge (id, operator_id)` :
  elle exige `ALTER TABLE otp_challenge ADD CONSTRAINT otp_challenge_id_operator_key UNIQUE (id,
  operator_id)` dans la même migration (ajout, aucune ligne à réécrire). **Renforcement** : une
  ligne ne peut pas désigner le défi d'un autre prestataire. Signale l'ajout sur une table de `0080`
  ;
- index `(challenge_id, sent_at)`. RLS : `ENABLE` et `FORCE`, politique `tenant_isolation` `USING`
  et `WITH CHECK` sur `operator_id = current_setting('app.operator_id', true)::uuid` (forme de
  `otp_challenge`, 0080). Pas de déclencheur d'ajout seul : WP04 limite `UPDATE` aux deux colonnes
  `confirmed_at` et `failed_reason`. Aucun `DELETE`. `REVOKE ALL ON otp_channel_attempt FROM
  PUBLIC`. Pas de `GRANT`.
- Piège : `roles.sql` rejoué rend `SELECT, INSERT, UPDATE` sur **toute** table nouvelle à
  `cashless_app` : c'est WP04 qui retire `UPDATE` hors des deux colonnes ; ne le fais pas ici.

### T013 : pgTAP `tests_pending_offline_notice.sql` et `tests_otp_channel_attempt.sql`

Modèle : `tests_customer_auth.sql` (RLS, droits) et `tests_offline_device_vendor.sql` (fixtures hors
ligne). Écris à la main, `\ir _grants_for_tests.sql`, `no_plan`.
- **Avis** : fixtures : prestataires A et B, événement `LIVE` et grand livre `EVENT`, portefeuille,
  deux terminaux (un actif, un `REVOKED`), accusés posés **avec `acked_at` explicites**, lots avec
  `received_at` explicites. Cas : aucun terminal : faux ; accusé sans lot : **vrai** ; lot
  postérieur à l'accusé : faux ; nouvel accusé postérieur au lot : vrai ; accusé du seul terminal
  révoqué : faux ; accusé sur un autre grand livre : faux ; événement `CLOSED` : faux (même accusé
  en attente) ; autres statuts d'événement non clos : vrai ; grand livre `ORGANIZER` : faux ; lot
  `REJECTED` postérieur : faux (littéral, point 2 du Context) ; portefeuille inconnu : faux ; sous
  `SET LOCAL ROLE cashless_app` avec `app.operator_id` de B sur le portefeuille de A : faux
  (isolation, avec contrôle positif sous A) ; `prosecdef` faux ; `volatility` `s` ; les deux index
  existent (`pg_indexes`, test qui échoue s'ils disparaissent).
- **Canaux** : RLS `ENABLE` + `FORCE` ; isolation A et B sous `SET LOCAL ROLE cashless_app` après un
  `GRANT` **local à la transaction** du test (jamais dans `0099`) ; forme exacte des colonnes
  (`set_eq` sur `pg_attribute` : aucune colonne `code`, `code_hash`, `phone` ; **aucune colonne
  `bytea`**) ; `channel` hors liste : `23514` ; `confirmed_at` et `failed_reason` ensemble : `23514`
  ; `failed_reason` en minuscules ou avec espace ou chiffres d'un numéro (`+221...`) : `23514` ; clé
  étrangère composite : défi du prestataire B avec `operator_id` de A : `23503` ; ligne valide
  (contrôle positif) lue en valeur.

## Tests et preuves

Base `cashless_wp03` (jamais `cashless_test`), serveur 5433, depuis la lane :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp03
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh && cd packages/ledger-sql
pg_prove -d cashless_wp03 tests/tests_pending_offline_notice.sql tests/tests_otp_channel_attempt.sql
pg_prove -d cashless_wp03 tests/tests_customer_auth.sql tests/tests_offline_device_vendor.sql \
  tests/tests_offline_snapshots.sql tests/tests_definer_search_path.sql
```

`reset-db.sh` doit réussir : tes migrations ne nomment aucune signature retirée. Si WP02 n'a pas
encore fusionné, `post-roles.sql` reste celui de `feat` et la série passe. Les suites de droits
figées échouent sur les objets nouveaux tant que WP04 n'a pas fusionné : normal, ne les touche pas.
`tests_offline_snapshot_source_no_stats.sql` est instable (fiche) : ne le relance pas.

## Branch Strategy

- Planification et fusion : `feat/serveur-app-festivalier`. Worktree de lane calculé par
  `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP03 --agent claude --mission
  serveur-app-festivalier-01M7WB69`.

## Definition of Done

- [ ] `0098` : fonction `STABLE` `INVOKER`, les deux index, aucun `GRANT`. `0099` : table, `CHECK`,
      clé composite, RLS forcée, index ; `UNIQUE (id, operator_id)` sur `otp_challenge` signalé.
- [ ] Deux suites vertes, contrôles positifs et valeurs lues ; suites de `0048` et `0080` vertes.
- [ ] **Mutations vérifiées**, rejouées puis rétablies, résultat noté : (a) retirer `d.status <>
      'REVOKED'` : le test du terminal révoqué échoue ; (b) remplacer `>` par `>=` ou retirer le
      `coalesce` du « sans lot » : le test accusé sans lot ou accusé postérieur échoue ; (c) retirer
      le test `event.status <> 'CLOSED'` ; (d) retirer `FORCE ROW LEVEL SECURITY` de la table ; (e)
      retirer le `CHECK` de `failed_reason` : le test du numéro dans `failed_reason` échoue.
- [ ] Note de lane : signatures réelles, les quatre points du Context, renforcements (`CHECK` de
      `failed_reason`, clé composite), mesure ou `EXPLAIN` de l'avis sur la fixture.

## Risks

- Une fonction `INVOKER` lue par le propriétaire local ignore la RLS : sans test sous
  `cashless_app`, l'isolation n'est pas prouvée.
- Une table de canaux qui reçoit un jour un texte libre contenant un code : le `CHECK` est la
  défense.
- `UNIQUE (id, operator_id)` sur `otp_challenge` : ajout sans risque de données, mais c'est une
  modification d'une table de `0080` : le porteur la voit dans la note.

## Ce que le relecteur doit casser

- Un terminal qui a remonté un lot après l'accusé reste-t-il compté ? Un révoqué, un terminal d'un
  autre grand livre, un événement `CLOSED`, un grand livre `ORGANIZER`, un portefeuille d'un autre
  prestataire : l'avis ment-il ? Les index sont-ils utilisés (`EXPLAIN` sur 2 000 accusés) ?
- Insérer dans `otp_channel_attempt` un `failed_reason` libre, un code de six chiffres, un défi d'un
  autre prestataire, un canal inconnu ; chercher une colonne qui pourrait porter le code.
- Un droit accordé dans `0098` ou `0099`, `DELETE`, une fonction `DEFINER` sans nécessité, un test
  sans contrôle positif, une mutation notée mais jamais rejouée.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0099_otp_channel_attempt.sql` (table des canaux : absence de tout
  code ou numéro, RLS forcée, contrainte ajoutée sur `otp_challenge`).
