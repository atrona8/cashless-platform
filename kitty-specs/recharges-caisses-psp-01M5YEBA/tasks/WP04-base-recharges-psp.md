---
work_package_id: WP04
title: 'Base : recharges PSP, notifications, contestations (migration 0038)'
dependencies: [WP03]
requirement_refs: [FR-012, FR-013, FR-016, FR-017, FR-018, FR-019, FR-024, FR-025, FR-026, FR-027, NFR-001, C-009]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
subtasks: [T017, T018, T019, T020, T021, T022]
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
owned_files: [packages/ledger-sql/migrations/0038_psp_topups.sql, packages/ledger-sql/tests/tests_psp_topups.sql]
create_intent: [packages/ledger-sql/migrations/0038_psp_topups.sql, packages/ledger-sql/tests/tests_psp_topups.sql]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 – Base : recharges PSP, notifications, contestations (migration 0038)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement : `spec.md` (FR-012, FR-013, FR-016 à FR-019, FR-024 à
FR-027, NFR-001, C-009), `data-model.md` (sections `psp_topup` avec son tableau de transitions,
`psp_event`, `psp_webhook_rejection`, `psp_chargeback`, extensions, correspondances), `research.md`
R-11, R-12, R-14 et **R-20 (fait foi, bloc « Notifications et recharges » et « Contestations »)**,
`research-adversarial.md` (A2, A3, A4, A9, A11 à A14, A20, A22, A24, A25, A33), `contracts/psp.md`
(règles 7 à 14), `contracts/database-rights.md`. Code de référence :
`packages/ledger-sql/migrations/0037_psp_configurations.sql` (WP03, fusionnée : noms réels de
`resolve_psp_configuration`, `psp_account_code`, `psp_configuration`), `0036_cash_sessions.sql`
(WP02 : style et helpers), `0031_vendors.sql` (style), `0020_tag_key_job_approval.sql` (vérification
d'une demande approuvée), `0033_payments.sql` (liste `approval_request_action_check` à recopier),
`schema_grand_livre_cashless.sql` (`anomaly` et son `CHECK` de sortie, `wallet`,
`wallet_topup_headroom`, bloc `CHARGEBACK` de `check_late_claim`, colonnes
`card_topup_daily_max_per_card` et `card_alert_cards_per_wallet` de `event`), `0004_audit_log.sql`
et `apps/api/src/audit/` (comment une ligne d'audit s'écrit). En cas de contradiction entre sources,
applique la priorité de SPECIFICATION §0.3 (tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > PRD) et **signale-la**. Ne modifie jamais un `.sql` généré de
`packages/ledger-sql/`.

## Objective

Créer en base le registre des recharges PSP avec son automate d'états, le registre durable des
notifications authentifiées, le compteur des notifications refusées, les contestations avec leur
plafond cumulé, le blocage et le déblocage de portefeuille, et les extensions de listes fermées
(anomalie `PSP_TOPUP_NOT_CREDITED`, actions `WALLET_UNBLOCK` et `CASH_DEPOSIT`). L'API (WP11 à WP13)
écrit le grand livre par le moteur ; la base ne laisse passer ni double crédit, ni transition
interdite, ni contestation au-delà du crédité (NFR-001, C-004).

## Context

- IC-07 du plan. Constats : A2 (corrélation par `psp_topup_id`), A3 (tableau des états), A4
  (conservation avant traitement), A9 (fonctions neutres), A11/A12 (carte : 3-D Secure, empreinte,
  plafond sous verrou consultatif), A13 (verrou de ligne, `CHECK` statut/crédit), A14
  (contestation), A20 (portefeuille bloqué), A22 (compteur de refus), A24 (corps purgé, lecture
  auditée), A25 (bornes de recharges en attente), A33 (caution après doublon).
- Dépend de WP03 : `resolve_psp_configuration(p_event, p_method)` (échec `CL042`),
  `psp_account_code`, `psp_configuration` (statuts, `secret_ref` non rendu).
- Ce qui dépend de ce lot : WP05 (liste des fonctions à accorder : voir « Arbitrages »), WP11
  (demande et traitement), WP12 (réception, travailleur), WP13 (contestations).
- Fonctions neutres (`psp_poll_candidates`, `psp_events_to_retry`, `purge_psp_event_bodies`,
  `record_webhook_rejection`) : sans prestataire de session, **hypothèse sur le propriétaire** de
  0022 (il ignore la RLS ; sinon l'échec est fermé). À écrire dans l'en-tête et à faire relire par
  une personne.
- Codes : `CL001`, `CL004` (grand livre qui n'accepte plus : `EVENT_CLOSING`), `CL023`, `CL029`,
  `CL039` (`WALLET_BLOCKED`, 422 aujourd'hui), `CL042` (WP03), `P0002` existent. **Nouveaux :
  `CL043`** (contestation au-delà du montant restant, 409) et **`CL044`** (contestation non permise
  : recharge non `SUCCEEDED`, non carte, sans transaction, autre portefeuille, 409). Le mappage
  TypeScript est à WP07 : ne touche pas `sqlstate-map.ts`. Note de contradiction à signaler : le
  contrat veut `409 WALLET_BLOCKED` à l'initiation, `CL039` mappe `422` ; WP11 contrôlera le statut
  avant d'appeler la base.

**Règle de sécurité du projet (`CLAUDE.md`, règle 1)** : si un point de ce lot ne peut être tenu
qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
faux gardé), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et
les options ; continue le reste. Un renforcement se fait, puis se consigne. Aucun faux en production
; aucune nouvelle dépendance npm (R-18).

## Arbitrages de l'orchestrateur (27/10/2026)

Ces points de R-20 priment sur tout texte antérieur.

- **Noms imposés par les lots déjà écrits** : `create_psp_topup`, `mark_psp_topup_initiated`,
  `cancel_psp_topup`, `expire_psp_topups`, `psp_poll_candidates`, `record_psp_event`,
  `complete_psp_topup`, `fail_psp_topup`, `complete_card_topup`, `card_topups_today`,
  `wallet_card_count`, `record_webhook_rejection`, `read_psp_event_body`, `record_chargeback`,
  `block_wallet_after_chargeback`, `unblock_wallet`.
- **Fonctions complémentaires** que WP12 et WP13 exigent et que le contrat ne nomme pas (sans elles
  ils s'arrêtent sur une lacune) : `mark_psp_event`, `psp_events_to_retry`,
  `purge_psp_event_bodies`, `attach_chargeback_tx`. Signale-les comme compléments du data-model et
  des accords de WP05 (appelées par l'API : à accorder).
- **Colonnes complémentaires** : `psp_event.normalized jsonb` (notification normalisée sans secret,
  relue par la reprise : le corps brut n'est pas lisible par `cashless_app`),
  `psp_topup.succeeded_at`, `psp_topup.created_at`, `psp_chargeback.anomaly_id`,
  `psp_chargeback.unblocked_by_request`, `psp_chargeback.created_at`.
- **Une carte ne se crédite que par `complete_card_topup`** : `complete_psp_topup` refuse `method =
  'CARD'` (`CL001`). Ainsi aucun chemin n'évite le 3-D Secure, l'empreinte et le plafond par carte
  (FR-024, FR-025).
- **Jour du plafond par carte** : jour civil UTC (R-20 prime sur « jour civil de l'événement » de
  R-11).
- **Clés d'écriture** (C-009, qualifiées par la configuration pour tous les moyens, A31) :
  `wave:<config>:<paiement>`, `om:<config>:<paiement>`, `psp:<config>:<paiement>` ; contestation
  `psp:<config>:<contestation>`. La base les vérifie lors de la complétion et du rattachement (la
  contradiction avec le contrat est déjà signalée au plan).
- **Anomalie exclusive d'un crédit** (A13) : une recharge `SUCCEEDED` n'a pas d'`anomaly_id` ; une
  recharge `FAILED` après paiement en a une, et une seule par paiement. Un succès tardif sur
  `FAILED`/`EXPIRED`/`CANCELLED` crédite (si recevable), ferme l'anomalie avec la transaction de
  crédit comme résolution et vide `anomaly_id`.
- **Aucune écriture d'attente en V1** pour l'argent encaissé non crédité (A16) : seule l'anomalie.
- Contradiction à signaler : le contrat (règle 9) traite un succès après annulation comme non
  crédité ; R-20 (A3) fait créditer un succès authentifié recevable sur `CANCELLED`. R-20 prime : le
  tableau du data-model s'applique.

## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendance : WP03 (worktree dérivé de la
base de WP03 ; lis `0037` fusionnée avant d'écrire). Commande : `spec-kitty agent action implement
WP04 --agent claude --mission recharges-caisses-psp-01M5YEBA`.

## Subtasks

### T017 — Tables `psp_topup`, `psp_event`, `psp_webhook_rejection`, `psp_chargeback`

1. En-tête de la migration (modèle 0031) : contenu, tableau des fonctions (rôle, INTERNE ou non,
   neutre ou prestataire), codes (dont `CL043`, `CL044`), automate d'états, hypothèse sur le
   propriétaire.
2. `psp_topup` : colonnes du data-model (`psp_topup_id` PK, `operator_id`, `ledger_id`, `event_id`,
   `wallet_id`, `psp_configuration_id`, `method`, `provider`, `amount`, `currency`, `fee_amount`,
   `status`, `provider_payment_ref`, `expires_at`, `requested_by_kind`, `device_id`, `person_id`,
   `customer_id`, `card_fingerprint`, `three_ds`, `topup_tx_id`, `failure_reason`, `anomaly_id`) +
   `created_at`, `succeeded_at`. Contraintes nommées : `amount > 0` ; `status IN
   ('PENDING','SUCCEEDED','FAILED','EXPIRED','CANCELLED')` ; `requested_by_kind IN
   ('DESK','CUSTOMER')` et `(kind = 'DESK') = (device_id IS NOT NULL AND person_id IS NOT NULL)`,
   `(kind = 'CUSTOMER') = (customer_id IS NOT NULL)` ; **`CHECK ((status = 'SUCCEEDED') =
   (topup_tx_id IS NOT NULL))`** ; `CHECK (status <> 'SUCCEEDED' OR (anomaly_id IS NULL AND
   failure_reason IS NULL AND succeeded_at IS NOT NULL AND fee_amount IS NOT NULL))` ; `CHECK
   ((status IN ('PENDING','SUCCEEDED')) = (failure_reason IS NULL))` ; `failure_reason` dans la
   liste fermée `THREE_DS`, `NO_FINGERPRINT`, `CARD_DAILY_LIMIT`, `LEDGER_STATUS`, `WALLET_LIMIT`,
   `MONTHLY_LIMIT`, `WALLET_BLOCKED`, `PERIOD_CLOSED`, `DEBIT_AUTHORITY_EDGE`, `FEES_EXCEED_AMOUNT`,
   `ACCOUNT_INACTIVE`, `PSP_FAILED`, `EXPIRED`, `CANCELLED` ; `three_ds IN
   ('SUCCEEDED','FAILED','NOT_PERFORMED')` ; `card_fingerprint` et `three_ds` nuls hors carte ;
   `fee_amount >= 0` et `< amount` ; `expires_at > created_at`. Clés étrangères :
   `psp_configuration`, `wallet`, `ledger`, `event`, `device`, `journal_transaction`, `anomaly`.
3. Index : unique partiel `(psp_configuration_id, provider_payment_ref) WHERE provider_payment_ref
   IS NOT NULL` ; `(wallet_id) WHERE status = 'PENDING'` ; `(device_id) WHERE status = 'PENDING'` ;
   `(status, created_at) WHERE status = 'PENDING'` (interrogation) ; `(ledger_id, card_fingerprint)
   WHERE status = 'SUCCEEDED'` (plafond carte).
4. Déclencheur `psp_topup_transition_guard` (BEFORE UPDATE, `SECURITY DEFINER`, `search_path =
   public, pg_temp`) : transitions admises `PENDING → SUCCEEDED | FAILED | EXPIRED | CANCELLED` et
   `FAILED | EXPIRED | CANCELLED → SUCCEEDED` ; `SUCCEEDED` définitif ; toute autre (y compris
   `FAILED → EXPIRED`) : `CL029`. Colonnes immuables après création : `operator_id`, `ledger_id`,
   `event_id`, `wallet_id`, `psp_configuration_id`, `method`, `provider`, `amount`, `currency`,
   `requested_by_kind`, `device_id`, `person_id`, `customer_id`, `created_at`.
   `provider_payment_ref` ne change plus une fois posée (`CL029`). Déclencheur BEFORE DELETE :
   refus.
5. `psp_event` : `psp_event_id` PK, `operator_id`, `psp_configuration_id`, `provider_event_id`,
   `received_at` (`clock_timestamp()`), `body bytea` (nullable ; `octet_length <= 65536`),
   `body_purged_at`, `signature_valid boolean NOT NULL DEFAULT true CHECK (signature_valid)`, `kind
   IN ('PAYMENT_SUCCEEDED','PAYMENT_FAILED', 'PAYMENT_CANCELLED','DISPUTE','UNKNOWN')`, `status IN
   ('RECEIVED','PROCESSED','UNMATCHED','RETRY')`, `attempts int NOT NULL DEFAULT 0`, `processed_at`,
   `outcome IN ('CREDITED','NOT_CREDITED','MISMATCH','DUPLICATE_PAYMENT',
   'CHARGEBACK','NO_EFFECT')`, `psp_topup_id` nullable, `normalized jsonb NOT NULL CHECK
   (jsonb_typeof(normalized) = 'object' AND pg_column_size(normalized) <= 8192)`. Unique
   `(psp_configuration_id, provider_event_id)` ; `CHECK ((status = 'PROCESSED') = (outcome IS NOT
   NULL AND processed_at IS NOT NULL))`. Index `(status, received_at)` et `(received_at) WHERE body
   IS NOT NULL`. Ajout seul pour tout sauf les colonnes de traitement (`status`, `attempts`,
   `processed_at`, `outcome`, `psp_topup_id`, `body`, `body_purged_at`) : déclencheur
   `psp_event_guard` qui refuse tout autre changement et tout `DELETE`.
6. `psp_webhook_rejection` : `config_key uuid NOT NULL` (identifiant de la configuration, ou l'UUID
   nul quand elle est inconnue), `psp_configuration_id uuid` (nul si inconnue, sans clé étrangère),
   `operator_id uuid` (nul si inconnue), `reason` (liste fermée : `BODY_TOO_LARGE`,
   `UNKNOWN_CONFIG`, `CONFIG_NOT_ACTIVE`, `PROVIDER_MISMATCH`, `SECRET_UNAVAILABLE`,
   `SIGNATURE_MISSING`, `SIGNATURE_MALFORMED`, `SIGNATURE_INVALID`, `TIMESTAMP_OUT_OF_TOLERANCE`,
   `BODY_MALFORMED`), `minute timestamptz` (tronquée), `count int NOT NULL CHECK (count >= 1)`,
   `PRIMARY KEY (config_key, reason, minute)`. Borne : au plus configurations × motifs × minutes.
   RLS : activée et forcée, politique `operator_id IS NULL OR operator_id = app.operator_id` en
   lecture (compteurs sans corps ; WP05 teste l'isolation) ; aucune écriture par politique : seul
   `record_webhook_rejection` écrit.
7. `psp_chargeback` : `psp_chargeback_id` PK, `operator_id`, `psp_configuration_id`,
   `provider_dispute_id text`, `psp_topup_id`, `amount bigint CHECK (amount > 0)`, `chargeback_tx_id
   uuid` (nul tant que la contestation tardive attend son approbation), `wallet_blocked boolean NOT
   NULL DEFAULT false`, `late boolean NOT NULL DEFAULT false`, `anomaly_id uuid`,
   `unblocked_by_request uuid`, `created_at`. Unique `(psp_configuration_id, provider_dispute_id)`.
   `CHECK (NOT late OR anomaly_id IS NOT NULL)`.
8. RLS activée et forcée, politique `tenant_isolation`, sur `psp_topup`, `psp_event`,
   `psp_chargeback`.

Validation :
- [ ] Chaque `CHECK` est exercé par un `INSERT` ou `UPDATE` direct du propriétaire qui doit échouer.
- [ ] `psp_event` : modification d'une colonne d'identité (`body` hors purge, `kind`,
      `provider_event_id`) refusée.

### T018 — `create_psp_topup`, `mark_psp_topup_initiated`, `cancel_psp_topup`, `expire_psp_topups`, `psp_poll_candidates`

Toutes `SECURITY DEFINER SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`, heure =
`clock_timestamp()`. Sauf `psp_poll_candidates` (neutre), elles nomment le prestataire de la session
(`P0002` sinon).

1. `create_psp_topup(p_psp_topup uuid, p_wallet uuid, p_method text, p_amount bigint, p_kind text,
   p_device uuid, p_person uuid, p_customer uuid, p_expires_at timestamptz) RETURNS TABLE
   (psp_topup_id uuid, psp_configuration_id uuid, provider text, expires_at timestamptz,
   replayed boolean)` :
   0. `p_psp_topup` est l'identifiant fourni par l'appelant (WP11 le dérive de l'`Idempotency-Key` ;
      il enchaîne trois transactions courtes : création, appel PSP hors verrou,
      `mark_psp_topup_initiated`). Il est la clé primaire : l'unicité est garantie par la base.
      Avant tout autre contrôle, si une ligne de ce prestataire porte déjà cet identifiant avec
      les mêmes portefeuille, moyen, montant et `p_kind` : rend cette ligne avec `replayed = true`,
      sans écriture ni contrôle de bornes ; mêmes identifiant et contenu différent : `CL029` ;
      identifiant d'un autre prestataire : `CL029` sans révéler l'existence. Nul : `CL001` ;
   a. portefeuille du prestataire (`P0002`) ; `ACTIVE` sinon `CL039` ; grand livre du portefeuille
      `OPEN` sinon `CL004` ; devise = celle du grand livre ; `p_amount > 0` ; `p_expires_at` entre
      maintenant et 7 jours ;
   b. événement = celui du grand livre ; `open_psp_accounts(grand livre)` (WP03, idempotente, filet
      pour un grand livre sans comptes `A-PSP-*`) ; configuration par
      `resolve_psp_configuration(event, p_method)` (`CL042` si aucune) ; `method`, `provider`,
      configuration figés dans la ligne ;
   c. `pg_advisory_xact_lock(hashtextextended('psp-pending:' || p_wallet, 0))` puis : au plus 3
      `PENDING` par portefeuille et, si `p_device` non nul, 20 par terminal ; au-delà : `CL029`
      (message « trop de recharges en attente ») (A25) ;
   d. `DESK` : `p_device` et `p_person` obligatoires, terminal du prestataire `ACTIVE` de mode
      `TOPUP_DESK`, personne active ; `CUSTOMER` : `p_customer` obligatoire, c'est le client du
      portefeuille (`wallet.customer_id`) ; sinon `CL001`/`P0002` ;
   e. insère `PENDING`, `fee_amount` nul. Le frais est calculé au crédit, jamais ici.
2. `mark_psp_topup_initiated(p_psp_topup uuid, p_provider_payment_ref text, p_expires_at timestamptz
   DEFAULT NULL) RETURNS void` : ligne `FOR UPDATE` ; pose la référence du PSP si elle est nulle,
   sinon exige la même (`CL029`) ; valable aussi quand la recharge est déjà `SUCCEEDED` par une
   notification arrivée avant (A2) ; `p_expires_at` facultatif (valeur de l'adaptateur) jamais
   antérieur à maintenant ; référence de 1 à 200 caractères sans espace. Violation de l'unicité
   `(configuration, référence)` : `CL029`.
3. `cancel_psp_topup(p_psp_topup uuid) RETURNS text` : `FOR UPDATE` ; `PENDING` → `CANCELLED`
   (`failure_reason = 'CANCELLED'`), rend le nouveau statut ; déjà `CANCELLED` : rend `CANCELLED`
   sans écriture ; `SUCCEEDED` ou autre statut final : `CL029`. L'API n'appelle cette fonction
   qu'APRÈS confirmation de l'adaptateur.
4. `expire_psp_topups(p_ids uuid[]) RETURNS int` : pour chaque identifiant du prestataire (ordre
   croissant, `FOR UPDATE`), `PENDING` ET `expires_at <= clock_timestamp()` → `EXPIRED`
   (`failure_reason = 'EXPIRED'`) ; rend le nombre passé à `EXPIRED`. Une recharge payée entre-temps
   n'est plus `PENDING` : ignorée. Tableau de plus de 500 éléments : `CL001`.
5. `psp_poll_candidates(p_limit int) RETURNS TABLE (psp_topup_id uuid, operator_id uuid,
   psp_configuration_id uuid, provider text, method text, provider_payment_ref text, created_at
   timestamptz, expires_at timestamptz, expired boolean)` : neutre, `STABLE`, aucun verrou ;
   `PENDING` créées il y a plus de 2 minutes, les plus anciennes d'abord, `p_limit` borné à 1 à 500
   (`CL001` sinon) ; ne filtre PAS sur le statut de la configuration (A15 : une configuration
   suspendue reste interrogée) ; `expired` = `expires_at <= clock_timestamp()`.

Validation :
- [ ] Portefeuille `BLOCKED`/`CLOSED`, grand livre `CLOSING`, devise ou montant invalides,
      configuration absente, 4e `PENDING` du portefeuille, 21e du terminal, terminal d'un autre
      mode, client d'un autre portefeuille.
- [ ] `mark_psp_topup_initiated` avant ET après un succès ; référence différente refusée ; doublon
      de référence dans la même configuration refusé, dans une autre accepté.
- [ ] Annulation, expiration (avant et après l'échéance), interrogation sans filtre de
      configuration.

### T019 — `record_psp_event`, `complete_psp_topup`, `fail_psp_topup`, `complete_card_topup`, `record_webhook_rejection`

1. `record_psp_event(p_config uuid, p_provider_event_id text, p_kind text, p_body bytea,
   p_normalized jsonb) RETURNS TABLE (psp_event_id uuid, duplicate boolean)` : prestataire de la
   session = celui de la configuration (`P0002` sinon) ; configuration `ACTIVE` sinon `CL029` ;
   identifiant de 1 à 200 caractères ; corps ≤ 65 536 octets (`CL001`) ; `INSERT … ON CONFLICT
   (psp_configuration_id, provider_event_id) DO NOTHING` ; sur conflit rend la ligne existante avec
   `duplicate = true` et n'écrit rien. Statut initial `RECEIVED`, `attempts = 0`.
2. `mark_psp_event(p_psp_event uuid, p_status text, p_outcome text DEFAULT NULL, p_psp_topup uuid
   DEFAULT NULL) RETURNS void` (complément) : ligne `FOR UPDATE` ; `PROCESSED` exige `p_outcome` et
   fixe `processed_at` ; `RETRY` incrémente `attempts` ; `UNMATCHED` laisse `attempts` ; `PROCESSED`
   est définitif (un nouvel appel `PROCESSED` de même issue : sans effet ; autre : `CL029`) ;
   `p_psp_topup` doit être du même prestataire.
3. `psp_events_to_retry(p_limit int) RETURNS TABLE (psp_event_id uuid, operator_id uuid,
   psp_configuration_id uuid, kind text, status text, attempts int, received_at timestamptz,
   normalized jsonb, exhausted boolean)` (complément, neutre, `STABLE`) : `RECEIVED` de plus d'une
   minute, `RETRY`, `UNMATCHED` ; `exhausted` = `RETRY` à plus de 5 essais ; `p_limit` 1 à 500 ; les
   plus anciens d'abord. WP12 filtre lui-même les 24 h de `UNMATCHED`.
4. `purge_psp_event_bodies(p_older_than_days int DEFAULT 400) RETURNS bigint` (complément, neutre) :
   `p_older_than_days` au moins 365 sinon `CL001` ; met `body = NULL` et `body_purged_at =
   clock_timestamp()` pour les événements plus anciens ; métadonnées gardées ; rend le nombre de
   corps vidés.
5. `read_psp_event_body(p_psp_event uuid, p_actor uuid) RETURNS bytea` : prestataire de la session ;
   auteur `OPERATOR_ADMIN` actif (helper local INTERNE) sinon `P0002` ; écrit une ligne d'audit
   (action `PSP_EVENT_BODY_READ`, auteur, objet `psp_event`, identifiant) DANS la fonction, selon la
   façon dont `apps/api/src/audit/` alimente `audit_log` (lis les colonnes fournies par l'appelant
   et celles posées par le déclencheur de 0004) ; rend le corps (NULL s'il a été purgé).
6. `complete_psp_topup(p_psp_topup uuid, p_tx uuid, p_fee_amount bigint, p_provider_payment_ref text
   DEFAULT NULL) RETURNS void` (Wave et Orange Money) et `complete_card_topup(p_psp_topup uuid, p_tx
   uuid, p_fee_amount bigint, p_card_fingerprint text, p_three_ds text, p_provider_payment_ref text
   DEFAULT NULL) RETURNS void` partagent un noyau INTERNE. Le noyau : recharge `FOR UPDATE` du
   prestataire ; `SUCCEEDED` avec la même `p_tx` → sans effet (rejeu) ; `SUCCEEDED` avec une autre →
   `CL029` ; statuts `PENDING`, `FAILED`, `EXPIRED`, `CANCELLED` acceptés ; `p_tx` : transaction du
   même grand livre, `type = 'TOPUP'`, `source = 'PSP_WEBHOOK'`, clé exacte (préfixe selon le moyen
   + configuration + référence de paiement), au moins une ligne positive sur le compte
   `psp_account_code( method)` du grand livre dont la somme vaut `amount` (brut) et une ligne
   négative sur le `WALLET_PAID` de la recharge ; `0 <= p_fee_amount < amount` ; pose `fee_amount`,
   `topup_tx_id`, `succeeded_at = clock_timestamp()`, `provider_payment_ref` (nulle ou identique),
   vide `failure_reason`, et si `anomaly_id` n'est pas nul : anomalie `RESOLVED` avec
   `resolution_tx_id = p_tx`, puis `anomaly_id = NULL`. `complete_psp_topup` refuse `CARD`
   (`CL001`). `complete_card_topup` exige `CARD`, `p_three_ds = 'SUCCEEDED'` et une empreinte non
   vide (sinon `CL001`), prend `pg_advisory_xact_lock(hashtextextended('card:' || ledger || ':' ||
   empreinte, 0))`, relit la somme des recharges `SUCCEEDED` du jour UTC pour cette empreinte, exige
   `somme + amount <= event.card_topup_daily_max_per_card` (sinon `CL029`, message « plafond carte
   »), puis pose empreinte et `three_ds`.
7. `fail_psp_topup(p_psp_topup uuid, p_reason text, p_paid boolean, p_anomaly_kind text DEFAULT
   'PSP_TOPUP_NOT_CREDITED', p_card_fingerprint text DEFAULT NULL, p_three_ds text DEFAULT NULL)
   RETURNS uuid` : recharge `FOR UPDATE` ; `p_reason` de la liste fermée ; `p_anomaly_kind` ∈
   {`PSP_TOPUP_NOT_CREDITED`, `PSP_TOPUP_OVER_LIMIT`} ; `SUCCEEDED` → `CL029` ; `PENDING` → `FAILED`
   ; `FAILED`/`EXPIRED`/`CANCELLED` gardent leur statut. Si `p_paid` : une seule anomalie par
   recharge (`anomaly_id`, montant = `amount`, grand livre, `OPEN`) ; si elle existe déjà, la rend
   sans écrire. Si non payé (échec confirmé par l'interrogation) : `FAILED` sans anomalie. Rend
   l'identifiant de l'anomalie (ou NULL). Enregistre empreinte et `three_ds` si fournis.
8. `card_topups_today(p_ledger uuid, p_fingerprint text, p_at timestamptz) RETURNS bigint`
   (VOLATILE, prestataire de la session) : prend le même verrou consultatif par carte, rend la somme
   des recharges `SUCCEEDED` de cette empreinte dans ce grand livre pour le jour UTC de `p_at` (WP11
   la lit AVANT d'écrire `TOPUP`, le verrou tient jusqu'à la fin de sa transaction).
   `wallet_card_count(p_wallet uuid, p_fingerprint text) RETURNS TABLE (distinct_cards int, is_new
   boolean)` : nombre d'empreintes distinctes ayant rechargé ce portefeuille (la nouvelle incluse)
   et si l'empreinte est nouvelle pour lui (vélocité, FR-026).
9. `record_webhook_rejection(p_config uuid, p_reason text) RETURNS integer` (neutre, `SECURITY
   DEFINER`) : motif de la liste fermée sinon `CL001` ; si la configuration existe : son identifiant
   et son prestataire sont gardés, sinon `config_key` = UUID nul et colonnes nulles ; `INSERT … ON
   CONFLICT (config_key, reason, minute) DO UPDATE SET count = count + 1` ; rend le compteur de la
   minute (WP12 alerte à 1 et au seuil) ; supprime au plus 100 lignes de plus de 30 jours. Aucune
   donnée de la requête n'est stockée.

Validation :
- [ ] Doublon d'événement : `duplicate = true`, une ligne. Corps de 65 537 octets : refusé.
- [ ] Les neuf cellules du tableau de transitions (état × issue) sont couvertes, y compris succès
      tardif sur `FAILED`/`EXPIRED`/`CANCELLED` (crédité, anomalie fermée) et rejeu de la même
      complétion.
- [ ] `complete_psp_topup` d'une carte refusé ; carte sans 3-D Secure, sans empreinte, au-delà du
      plafond du jour : refusées par la base ; le jour d'avant (UTC) ne compte pas ; la limite
      exacte passe.
- [ ] Transaction fausse (autre clé, autre type, autre grand livre, montant brut faux) : `CL001`.

### T020 — `psp_chargeback`, `record_chargeback`, `block_wallet_after_chargeback`, `unblock_wallet`

1. Déclencheur `psp_chargeback_cap` (BEFORE INSERT, `SECURITY DEFINER`) : somme des contestations de
   la recharge plus la nouvelle ≤ montant net crédité (`CL043`). Montant net crédité =
   `-sum(amount)` des lignes de `topup_tx_id` sur le compte `WALLET_PAID` du portefeuille de la
   recharge (R-20, A14 : jamais le brut).
2. `record_chargeback(p_psp_topup uuid, p_dispute_id text, p_amount bigint, p_late boolean DEFAULT
   false) RETURNS TABLE (psp_chargeback_id uuid, duplicate boolean, remaining bigint)` : recharge
   `FOR UPDATE` du prestataire (`P0002`) ; doublon `(configuration, dispute_id)` → rend l'existant,
   `duplicate = true`, sans écriture ni contrôle du montant ; sinon préconditions : `status =
   'SUCCEEDED'`, `topup_tx_id` non nul, `method = 'CARD'`, `p_amount > 0` (sinon `CL044`) ;
   `p_amount` ≤ restant (sinon `CL043`). `p_late` : ouvre l'anomalie `LATE_CHARGEBACK` (montant,
   grand livre, `OPEN`) et la lie (`anomaly_id`) ; `chargeback_tx_id` reste nul. Rend l'identifiant
   et le restant après insertion. L'identifiant de contestation de 1 à 200 caractères.
3. `attach_chargeback_tx(p_chargeback uuid, p_tx uuid) RETURNS void` (complément) : contestation
   `FOR UPDATE` ; transaction du même grand livre, `type = 'CHARGEBACK'`, clé exacte
   `psp:<configuration>:<contestation>`, avec une ligne négative sur le compte `A-PSP-CARTE` de ce
   grand livre pour `amount` ; pose `chargeback_tx_id` (même transaction : sans effet ; autre :
   `CL029`) ; si une anomalie `LATE_CHARGEBACK` est ouverte et liée : `RESOLVED` avec
   `resolution_tx_id = p_tx`.
4. `block_wallet_after_chargeback(p_wallet uuid, p_chargeback uuid) RETURNS void` : la contestation
   est du prestataire et de la recharge de ce portefeuille (`CL044`) ; `wallet.status` `ACTIVE` →
   `BLOCKED` (déjà `BLOCKED` : sans erreur, idempotent ; `CLOSED` : `CL044`) ; `wallet_blocked =
   true`.
5. `unblock_wallet(p_wallet uuid, p_request uuid) RETURNS void` (modèle `enqueue_tag_key_job`) :
   demande du prestataire `FOR UPDATE`, action `WALLET_UNBLOCK`, `APPROVED`, `payload ->>
   'wallet_id' = p_wallet`, `decided_by` ≠ `requested_by`, tous deux `ORGANIZER_ADMIN` actifs de
   l'organisateur de l'événement du portefeuille, sinon `CL023` ; portefeuille `BLOCKED` avec au
   moins une contestation `wallet_blocked` sans `unblocked_by_request`, et `decided_at` postérieure
   à la plus récente de ces contestations, sinon `CL029` ; remet `ACTIVE`, pose
   `unblocked_by_request` sur ces lignes. Un portefeuille bloqué pour une autre cause : `CL029`.

Validation :
- [ ] Deux contestations dont la somme dépasse le crédité : la seconde `CL043` ; montant égal au
      restant accepté ; carte Wave/Orange Money, recharge `FAILED`, recharge sans transaction :
      `CL044` ; doublon : sans écriture.
- [ ] Rattachement : mauvaise clé, mauvais type, mauvais compte : refusé ; anomalie tardive fermée
      par le rattachement.
- [ ] Blocage idempotent ; déblocage avec demande rejouée, demande plus ancienne que la
      contestation, même personne, rôle insuffisant, autre événement : refusés.

### T021 — Extensions : anomalie `PSP_TOPUP_NOT_CREDITED`, actions `WALLET_UNBLOCK` et `CASH_DEPOSIT`

1. `anomaly` : remplace la contrainte de liste fermée (nom réel lu dans `pg_constraint`,
   probablement `anomaly_kind_check`) par la liste de `pg_get_constraintdef` de la base (relis-la,
   ne la recopie pas de mémoire) plus `'PSP_TOPUP_NOT_CREDITED'` ; ajoute `CHECK (kind <>
   'PSP_TOPUP_NOT_CREDITED' OR (ledger_id IS NOT NULL AND amount > 0))` (data-model : montant et
   grand livre exigés). Les anomalies existantes restent valides.
2. `approval_request_action_check` : remplace par la liste de 0033 recopiée à l'identique plus
   `'WALLET_UNBLOCK'` et `'CASH_DEPOSIT'` (ne touche à aucune autre valeur ; compare avant / après
   avec `pg_get_constraintdef`).
3. Vérifie que `check_late_claim` (bloc `CHARGEBACK` du schéma) accepte l'écriture `A-PSP-CARTE`
   crédité et `WALLET_PAID` / `ORG_PERTES` / `OPE_PERTES` débités (compte `PSP`, famille `ASSET`) :
   c'est déjà le cas, mais le test T022 le prouve avec un grand livre `LOCKED`. Ne modifie pas le
   schéma de référence.
4. Cas limites : les listes sont recopiées sur la base RÉELLE de la branche (une autre mission a pu
   en ajouter) ; l'ordre des valeurs n'importe pas, l'ensemble oui.

Validation :
- [ ] Une anomalie `PSP_TOPUP_NOT_CREDITED` sans montant ou sans grand livre : refusée ; avec :
      acceptée.
- [ ] Les deux nouvelles actions s'insèrent dans `approval_request` ; une valeur inconnue reste
      refusée ; aucune valeur précédente n'a disparu.

### T022 — Suite `tests_psp_topups.sql`

Fichier pgTAP écrit à la main, modèle `tests/tests_vendors.sql` ; prestataires A et B, événement et
grand livre par `open_event_ledger`, configuration `ACTIVE` avec règle de frais (fixtures de
`tests_psp_configurations.sql`), portefeuilles, transactions `TOPUP` / `CHARGEBACK` posées par
`post_transaction` du propriétaire avec les clés exactes. Sections :

1. Structure : tables, RLS forcée, contraintes (une par une), index uniques, déclencheurs d'automate
   et d'ajout seul.
2. Création (T018) : chaque refus ; bornes 3 et 20 ; frais nul à la création.
3. Automate : tableau état × issue du data-model, cellule par cellule ; succès tardif ; rejeu ;
   anomalie unique par paiement et fermée par le crédit ; `CHECK` statut/crédit exercé en direct.
4. Notifications : `record_psp_event` (doublon, taille, configuration suspendue), `mark_psp_event`
   (transitions, essais), `psp_events_to_retry`, purge (401 jours vidé, 399 intact, métadonnées
   gardées, plancher 365), lecture auditée (ligne d'audit écrite, rôle, corps purgé).
5. Carte : trois refus, plafond du jour UTC (veille ignorée, limite exacte), vélocité
   (`wallet_card_count`), verrou consultatif présent (`pg_locks` dans la transaction du test après
   `card_topups_today`).
6. Compteur de refus : même minute `count = 2`, minutes distinctes, configuration inconnue, motif
   inconnu, borne de lignes (1 000 appels, une configuration inconnue : une ligne par motif et par
   minute).
7. Contestations (T020) : plafond sur le net (frais `CUSTOMER` : net < brut), doublon, tardive +
   rattachement, blocage, déblocage, grand livre `LOCKED` accepté pour `CHARGEBACK` (extension
   T021).
8. Cloisonnement : chaque fonction à prestataire avec un objet de B sous la session de A : `P0002` ;
   sans session `P0002` ; fonctions neutres : aucune fuite de colonne secrète (ni `secret_ref`, ni
   corps).
9. Clés d'écriture : complétion avec la clé d'un autre moyen ou d'une autre configuration : refusée.

Validation :
- [ ] Suite verte sur la base du lot ; elle échoue si l'on retire le `CHECK` statut/crédit, le
      plafond des contestations ou le refus de `complete_psp_topup` pour une carte (essai de
      neutralisation, puis restauration).

## Test Strategy

Base propre au lot : `PGDATABASE=cashless_wp04 npm run reset-db -w @cashless/ledger-sql` (migrations
0036 à 0038 dans l'ordre) puis `pg_prove -d cashless_wp04
packages/ledger-sql/tests/tests_psp_topups.sql`. Lance aussi sur cette base : les suites de
référence (`tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`), `tests_psp_
configurations.sql`, `tests_cash_sessions.sql`, `tests_definer_search_path.sql`,
`tests_definer_trigger_writers.sql`. `cashless_test` est réservée à l'orchestrateur. Aucune
comparaison avec l'horloge de Node ; les ancienneté (corps de 401 jours, recharge de 3 minutes) se
fabriquent par `UPDATE` du propriétaire sur les horodatages ; pas de `sleep`. La concurrence réelle
(100 rejeux, plafond carte à deux connexions) est prouvée par WP14 (T071) : ici, la preuve de
l'unicité et du verrou est structurelle (index, `CHECK`, `pg_locks`).

## Definition of Done

- [ ] Migration `0038_psp_topups.sql` appliquée sur base propre et sur une base peuplée (anomalies
      et actions existantes préservées) ; en-tête complet ; aucun `GRANT`/`REVOKE` de table.
- [ ] Toutes les fonctions `SECURITY DEFINER` fixent `search_path = public, pg_temp` ; `REVOKE ALL …
      FROM PUBLIC`.
- [ ] `tests_psp_topups.sql` vert ; suites de référence et suites des lots WP02/WP03 vertes.
- [ ] Compte rendu du lot : signatures réelles de TOUTES les fonctions (WP05, WP11, WP12, WP13 les
      lisent), dont les compléments (`mark_psp_event`, `psp_events_to_retry`,
      `purge_psp_event_bodies`, `attach_chargeback_tx`) et les colonnes ajoutées ; fonctions
      INTERNES ; `CL043`/`CL044` à mapper (WP07) ; contradictions signalées (contrat règle 9 contre
      A3 ; `CL039` 422 contre 409 ; jour UTC contre jour de l'événement) ; hypothèse sur le
      propriétaire ; retouches hors carte justifiées ; points soumis au porteur ; fichiers à faire
      relire par une personne (cette migration : verrou consultatif, lecture auditée du corps,
      contestations) ; critères couverts avec commande et résultat (FR-012, FR-013, FR-016 à FR-019,
      FR-024 à FR-027, NFR-001).

## Risks

- Automate : une transition admise par erreur permet un double crédit ou la perte d'une anomalie.
- `CHECK` statut / crédit et anomalie exclusive : une complétion qui oublie de vider `anomaly_id`.
- Verrou consultatif par carte non tenu jusqu'à la fin de la transaction de WP11 (il l'est, par
  construction : verrou de transaction ; vérifie qu'aucune fonction ne le relâche).
- Plafond des contestations calculé sur le brut au lieu du net crédité.
- Neutres sans prestataire : une colonne secrète rendue par mégarde (`body`, `secret_ref`).
- Copie des listes fermées (`anomaly.kind`, actions) qui oublie une valeur ajoutée depuis.

## Reviewer Guidance

Essaie de casser : (1) un double crédit par deux complétions concurrentes ou par un succès tardif ;
(2) une carte créditée sans 3-D Secure, sans empreinte ou au-delà du plafond du jour, par
`complete_psp_topup` ou en sautant `complete_card_topup` ; (3) une contestation au-delà du net, sur
une recharge non carte, non créditée, ou rejouée avec un autre identifiant ; (4) un déblocage avec
une demande rejouée, plus ancienne que la contestation ou signée par la même personne ; (5) une
recharge `PENDING` au-delà de 3 par portefeuille ; (6) une lecture de `body` ou de `secret_ref` par
une fonction neutre ; (7) un compteur de refus qui grossit sans borne ; (8) un test qui ne prouve
pas ce qu'il dit (transition vérifiée par le propriétaire sans passer par la fonction, plafond testé
avec un seul jour). Vérifie que chaque transition du tableau du data-model a une preuve, et que les
listes fermées recopiées sont des sur-ensembles stricts des listes de la base.
