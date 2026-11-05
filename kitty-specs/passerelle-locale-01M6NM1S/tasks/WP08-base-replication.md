---
work_package_id: WP08
title: 'Base : réplication côté base (migration 0063)'
dependencies: [WP03, WP04, WP05]
requirement_refs:
- FR-008
- FR-009
- FR-036
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T033, T034, T035, T036, T037]
phase: Phase 2 - Base du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0063_edge_replication.sql
create_intent: [packages/ledger-sql/migrations/0063_edge_replication.sql, packages/ledger-sql/tests/tests_edge_replication.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0063_edge_replication.sql, packages/ledger-sql/tests/tests_edge_replication.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 : Base, réplication côté base (migration 0063)

> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour les déclencheurs seuls de `edge_reference_change` (table déjà créée en 0058), la dépendance à WP05 (aucune table temporaire), `pack_delay_seconds` lu en table, `edge_gateways_awaiting_pack`.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis ensuite la fiche de contexte fournie par l'orchestrateur, ce prompt, puis seulement :

- `docs/passation-8/contexte-m8.md` : décisions 11, 12, 16, 18 ;
- `contracts/interfaces.md` § 1 (ligne 0063), § 2 (bloc WP08), § 7 (audit `EDGE_STAFF_TOKEN_TOLERATED`, alertes `EDGE_SILENT`) ;
- `contracts/replication-page-additions.yaml` EN ENTIER : c'est la forme exacte de ce que `edge_replication_page` renvoie (noms de
  champs, `required`, « Ce que le flux ne porte jamais ») ;
- `data-model.md` A.4 (lignes `edge_replication_page`, `mark_edge_gateways_silent`, `edge_record_staff_token_audit`), A.5 (`edge_pwd_pack_key`,
  `edge_pwd_pack`, `edge_reference_change`, `edge_staff_token_audit`, `edge_device_seq_acked`), A.6 invariants 5 et 6 ;
- `research.md` R-08 (paragraphes « Lecture du flux », horizon A18, blocages A03), R-15 (états de lien), R-24 en entier ;
- constats `A02`, `A03`, `A16`, `A18`, `A22`, `A25`, `A26` de `docs/passation-8/rapports/plan-adversarial.md` ; ADR-160, OP-N105 ;
- code : `schema_grand_livre_cashless.sql` (tables `media`, `wallet`, `posting`, `device`, `cash_session`, `vendor`, `vendor_session`,
  `app_user`, rôles d'affectation, catalogue, `event`, `snapshot` : cherche ce que lit déjà la publication de snapshots),
  `migrations/0044_offline_snapshots.sql` et `0053` à `0057` (sources de snapshot : entrées `SnapshotEntry`, `pwd_pack_enc`),
  la migration qui définit `device_seq_registry` (schéma S6) ; `migrations/0058`, `0059` (WP03, WP04), `0060` (WP05) si
  présentes dans ta lane.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. En cas de désaccord entre `tasks.md`,
`interfaces.md` et `data-model.md`, `interfaces.md` fait foi.

## Objective

Servir à la passerelle un flux sans trou, sans double comptage et cloisonné : colis de mots de passe chiffrés sous une clé de
contenu PAR passerelle, journal ordonné des changements de référence, page de réplication lue en `REPEATABLE READ` à l'horizon des
écritures validées, audit immuable de la tolérance des jetons de personne, détection de silence. Aucun `GRANT` ; aucun secret en
clair dans le flux.

## Branch Strategy

- Branche de planification et de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP08 --agent claude --mission passerelle-locale-01M6NM1S`
  (avec `LC_ALL=C LANG=C`).

## Périmètre et arbitrages

- Dans le lot : `0063_edge_replication.sql`, suite pgTAP **sous le propriétaire**. Fonctions `SECURITY DEFINER`,
  `search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC` ; aucun `GRANT`. Toute table nouvelle : `operator_id`,
  `tenant_isolation` ENABLE + FORCE, `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` pour les rôles applicatifs (WP09 fait les droits).
- **Numéros de migration** : `data-model.md` range ces objets en 0060/0061 ; `interfaces.md` § 1 donne 0063. 0063 fait foi. Signale.
- **Dépendance manquante à signaler** : `tasks.md` donne WP08 → WP03, WP04. Mais `edge_record_staff_token_audit` doit lire
  l'intervalle du lot dans `edge_sync_batch` (0060, WP05), et le journal `edge_reference_change` est lu par WP04 (accord, filigrane).
  Lis `edge_sync_batch` par SQL dynamique en échec fermé (table absente : refus), et crée dans tes tests une table temporaire de même
  forme. La preuve de bout en bout est celle de l'orchestrateur et de WP25.
- **Source du délai des colis (A16)** : `interfaces.md` § 8 le met en configuration du central (`EDGE_PACK_DELAY_SECONDS`, 1800,
  jamais 0 en production), mais `edge_replication_page` n'a aucun paramètre de délai. Un réglage de session posé par le processus
  `edge` serait modifiable par un processus compromis : le délai ne vaudrait rien. Retenu : une ligne de la table de réglage de
  plateforme (celle de WP06 si elle est déjà dans ta lane, sinon une table à toi de même forme), valeur initiale 1800 s, lue par la
  fonction. **Signale à l'orchestrateur** que la clé de configuration de WP10 ne peut pas l'écrire sans fonction dédiée : question au porteur.
- Les clés maîtres des bracelets ne sortent jamais du central (C-009). Ce lot ne CHIFFRE rien : le processus des clés produit
  les colis (`deposit_edge_pwd_pack`, `deposit_edge_pwd_pack_key` ; accordées à `cashless_tagkeys` par WP09) ; la fonction SQL ne lit que `edge_pwd_pack`.
- Hors lot : routes HTTP (WP12), application côté passerelle (WP18), outil d'inscription (WP15), canari de bout en bout (WP25).

## Subtasks

### T033 : `edge_pwd_pack_key`, `edge_pwd_pack`, dépôts

- `edge_pwd_pack_key` : `gateway_id` PK, `operator_id`, `agreement_key_sha256 bytea(32)`, `wrapped_key jsonb` (`WrappedKey` du contrat),
  `created_at`. Une clé de contenu PAR passerelle, scellée pour `agreement_public_key`, jamais pour un terminal ; remplacée si la clé
  d'accord change (les colis de l'ancienne clé ne sont plus servis).
- `edge_pwd_pack` : `(gateway_id, media_id)` PK, `operator_id`, `pwd_pack_enc` (AES-256-GCM sous la clé de contenu, jamais en clair),
  `pwd_pack_sha256`, `media_version bigint`, `created_at`.
- `deposit_edge_pwd_pack(p_gateway, p_media, p_pack, p_pack_sha256, p_media_version)` et `deposit_edge_pwd_pack_key(p_gateway,
  p_agreement_key_sha256, p_wrapped)` : contrôlent que la passerelle est du prestataire, non `REVOKED`, le bracelet du même événement,
  l'empreinte à 32 octets, et que l'empreinte de clé d'accord déposée est celle de `edge_gateway.agreement_public_key` ; `ON CONFLICT`
  met à jour seulement si `media_version` est supérieure. `deposit_edge_pwd_pack_key` figure dans `interfaces.md` § 2 mais PAS dans la
  liste de `cashless_tagkeys` de `data-model.md` A.1 : **signale-le à WP09**.
- **Qui reçoit des colis (A16, décision 16)** : seulement une passerelle `PRIMARY` non `REVOKED` dont `role_changed_at` date de plus du délai
  réglé. `STANDBY` non promue : rien. À la promotion (`swap_edge_gateway_roles`, WP03), le délai repart et la passerelle reprend une copie
  complète (`after_posting_id = 0`, `after_change_seq = 0`).

### T034 : `edge_reference_change`, déclencheurs, numérotation sous verrou

- `(ledger_id, change_seq)` PK, `operator_id`, `entity_kind` (`WALLET_STATE`, `MEDIA`, `DEVICE`, `DEVICE_CONFIG`, `CASH_SESSION`, `VENDOR`,
  `VENDOR_SESSION`, `STAFF`, `CATALOG`, `EVENT`, `UNASSIGNED_MEDIA`, `GATEWAY`), `entity_id`, `changed_at`.
- Déclencheurs sur les tables d'origine (aucun `.sql` généré à modifier : déclencheurs AJOUTÉS par migration). Dresse la liste EXACTE des tables
  et colonnes dans l'en-tête : statut et palier d'identification du portefeuille, statut du bracelet, terminaux, configurations, sessions de
  caisse et de vendeur, vendeurs (statut, blocage), personnes habilitées (statut, affectations `CASHIER`/`SUPERVISOR`), catalogue, réglages de
  l'événement, bracelets personnalisés non attachés, rôle et statut de la passerelle (A03, A25). N'ajoute un déclencheur que sur les colonnes
  servies : un déclencheur sur `UPDATE` de n'importe quelle colonne d'une table chaude serait un coût sans usage.
- **Numérotation** : verrou consultatif transactionnel PAR GRAND LIVRE, tenu jusqu'à la validation, puis `max(change_seq) + 1` : l'ordre des
  numéros est l'ordre de validation, aucun saut possible, aucun trou pour une transaction lente. Volume faible (références, pas ventes).
- Le journal ne porte ni valeur ni secret, seulement `(kind, id)` : la page lit l'ÉTAT COURANT de l'entité (une fermeture est un
  changement d'état, jamais une suppression).

### T035 : `edge_replication_page`

`edge_replication_page(p_gateway, p_after_posting, p_after_change, p_limit)` → `jsonb` ayant la forme de `ReplicationPage`
(`replication-page-additions.yaml`). `p_after_change` NULL : bloc `reference` non servi (réponse d'avant l'ajout, aux nouveaux champs
facultatifs près). Compare `p_gateway` à `app.gateway_id` (`42501`), passerelle non `REVOKED`, `assert_tenant`.

- **Lecture `REPEATABLE READ`** : si la transaction appelante n'a pas ce niveau, la fonction refuse ou le documente avec un contrôle
  (`SHOW transaction_isolation`) ; `edge_seq_applied` (= `contiguous_edge_seq`) est lu DANS la même transaction que les soldes.
- **Horizon (A18)** : avant la lecture, prendre le verrou exclusif de l'autorité de débit (même clé que `grant_edge_authority` :
  `hashtextextended('debit-authority:' || ledger, 0)`), `lock_timeout` 200 ms, le relâcher aussitôt après `SELECT max(id) FROM posting` ;
  `to_posting_id <= horizon`. Verrou non obtenu : servir l'horizon précédent (consigné, p. ex. dans une colonne de la passerelle ou une
  table d'horizon par grand livre que tu crées). Aucune écriture validée hors ordre ne peut être sautée.
- Contenu : `wallets[]` (`paid`, `promo`, `status`, `kyc_verified`, `topup_month_paid` du mois UTC de `to_posting_id`, même calcul que
  `check_wallet_limits`), `media[]` (entrées de snapshot avec `pwd_pack_enc` seulement si délai écoulé), `pwd_pack_key`, `device_seq_acked`
  (dernière page seulement, `has_more = false`), et `reference` (par `change_seq`, au plus `p_limit` entités, deux `has_more` indépendants).
  Borne de taille 2 Mio : `has_more` quand elle est atteinte.
- `reference_applied_seq` : une requête qui porte le curseur `c` met `edge_gateway.reference_applied_seq := greatest(old, c)` (preuve
  d'application, A03). C'est la seule écriture de la fonction.
- Vue `edge_device_seq_acked` : `(device_id, contiguous_acked_seq, max_seen_seq, missing_seqs, next_seq_floor, as_of)`, lecture étroite.
- **Cloisonnement (NFR-011)** : toute lecture limitée à l'événement, au grand livre et au prestataire de la passerelle appelante ; aucune
  entité d'un autre événement, y compris pour `unassigned_media`, `staff`, `devices`. Aucun `pin_hash`, `failed_attempts`, courriel, téléphone,
  nom, rôle autre que `CASHIER`/`SUPERVISOR`, clé maître, PWD en clair. `token_family.refresh_token_sha256_current` (décision 11, OP-N102)
  n'est servie qu'à la passerelle `PRIMARY` ; elle marque la famille `edge_exposed` et force la rotation au rendu (relis la table des
  jetons d'appareil ; si la colonne manque, dis-le et NE l'invente pas).

### T036 : `edge_staff_token_audit`, `edge_record_staff_token_audit`, `mark_edge_gateways_silent`

- `edge_staff_token_audit` : `(gateway_id, batch_id, edge_seq)` PK, `operator_id`, `at`, `subject`, `issuer`, `jti`, `seconds_past_expiry`,
  `route` (`activateMedia`, `takeDeposit`, `createCashTopup`), `device_serial`, `cash_session_id`, `received_at`. Immuable (`forbid_mutation`).
- `edge_record_staff_token_audit(p_gateway, p_batch, p_rows jsonb)` : au plus 500 lignes, chacune avec `edge_seq` dans l'intervalle du lot
  (sinon `check_violation`, le lot est refusé en entier côté API), idempotente par la clé primaire (même ligne : rien ; ligne différente :
  `CL002`), copie dans `audit_log` (action `EDGE_STAFF_TOKEN_TOLERATED`). Aucun jeton, seulement `jti`, `subject`, `issuer`.
- `mark_edge_gateways_silent(p_threshold interval)` → `integer` (R-15) : `ACTIVE` sans `last_seen_at` récent devient `ISOLATED` (seuil 75 s
  par défaut côté travailleur) ; retour à `ACTIVE` par le même travailleur quand la passerelle est vue et qu'aucun lot n'a été reçu depuis 60 s ;
  chaque passage audité ; alerte `EDGE_SILENT` seulement si un handover est ouvert. `ISOLATED` et `CATCHING_UP` n'accordent AUCUN droit
  (invariant 9) : ne les lis nulle part comme condition d'autorité. Ne touche jamais `REVOKED`.

## Tests attendus : T037, `tests_edge_replication.sql`

Gabarit `tests/tests_cash_sessions.sql` ; propriétaire seul ; deux événements d'un même prestataire (passerelles G1 et G2) et un
second prestataire.

- Écriture hors d'ordre (A18) : transaction 1 écrit un `posting.id` bas sans valider, transaction 2 un `id` plus haut validé ; la page ne
  dépasse jamais l'horizon, puis l'écriture tardive apparaît à la page suivante (deux sessions : si impossible en pgTAP seul, dis ce qui
  n'est pas prouvé et demande la preuve à l'orchestrateur avec deux connexions).
- Blocage sans écriture (A03) : un bracelet bloqué sans `posting` apparaît dans `reference` à la page suivante ; curseur rejoué : même page ;
  `reference_applied_seq` n'avance qu'avec la demande.
- Pas de double comptage : `edge_seq_applied` égal au registre, dans la même transaction que les soldes.
- Cloisonnement : G2 d'un autre événement ne voit aucune entité de G1, sur CHAQUE tableau de `reference` et de la page ; autre prestataire : `no_data_found`.
- Colis (A16) : aucun colis avant le délai, après changement de rôle le délai repart, aucun colis pour une `STANDBY`, pour une `REVOKED`, ni
  si la clé de contenu n'est plus la courante ; aucun colis en clair, jamais de clé maître.
- Secrets : la page ne contient ni `pin_hash`, ni compteur d'échecs, ni courriel, ni téléphone (recherche du canari dans le `jsonb` rendu).
- Journal : numéros contigus, deux transactions concurrentes (documente la limite d'un test mono-session), déclencheurs seulement sur les
  colonnes servies ; `edge_record_staff_token_audit` : ligne hors intervalle, 501 lignes, doublon, immuabilité ; `mark_edge_gateways_silent` :
  transitions, `REVOKED` intact, alerte conditionnelle.
- RLS forcée sur les tables nouvelles ; `search_path` et absence d'exécution par `PUBLIC` des fonctions.
- Chaque test doit échouer sur une implémentation fausse (curseur sur `posting.id` seul, horizon ignoré, colis servi à une `STANDBY`).
- Tu ne lances ni pgTAP ni `reset-db`.

## Sécurité

- **À faire relire par une personne** : `edge_replication_page` (frontière de cloisonnement), `deposit_edge_pwd_pack*`, déclencheurs sur tables chaudes.
- Écarts acceptés et nommés : inscription par une personne avec délai des colis (OP-N105, ADR-160), empreinte du jeton de rafraîchissement
  répliquée (OP-N102, ADR-157). Tests de borne : aucun colis avant le délai ni à une `STANDBY` ; empreinte servie à la `PRIMARY` seule.
- La fuite entre événements ou prestataires est le défaut majeur de ce lot : un test par tableau.
- Règle 1 : tout écart qui affaiblit la sécurité (délai désactivable par le processus, colonne sensible ajoutée au flux) est soumis au
  porteur AVANT d'être codé.

## Definition of Done

- [ ] `0063_edge_replication.sql` applicable ; en-tête (liste des déclencheurs, horizon, source du délai, ordre des verrous).
- [ ] Tables et fonctions de `interfaces.md` § 1 et § 2 (WP08), sorties conformes à `replication-page-additions.yaml`.
- [ ] `tests_edge_replication.sql` écrit, cloisonnement par tableau et horizon compris.
- [ ] Rapport : signatures réelles, contradictions (numéros, dépendances, source du délai, `deposit_edge_pwd_pack_key`), fichiers à relire.
- [ ] Aucun `.sql` généré modifié ; aucun commit ; le port 80 n'est pas touché.

## Ce que le relecteur doit casser

1. Demander la page d'une passerelle d'un autre événement, avec le `p_gateway` de la première : refus, ou rien dans chaque tableau.
2. Chercher `pin_hash`, courriel, téléphone, clé maître dans le `jsonb` rendu.
3. Servir un colis à une `STANDBY` ou dans le délai ; changer de rôle et revérifier.
4. Valider une écriture d'`id` bas après une d'`id` haut : jamais sautée.
5. Bloquer un bracelet sans écriture : visible à la passe suivante.
6. Insérer 501 lignes d'audit, une hors intervalle, ou modifier une ligne existante : refus.
7. Remonter `reference_applied_seq` sans demander le curseur : impossible.
8. Mesurer le coût des déclencheurs sur `wallet`/`media` : aucune colonne non servie ne déclenche.
