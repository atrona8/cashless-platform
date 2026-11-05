---
work_package_id: WP04
title: 'Base : bascule, rendu et reprise (migration 0059)'
dependencies: [WP03]
requirement_refs:
- FR-003
- FR-006
- FR-007
- FR-021
- FR-022
- FR-024
- C-003
- C-012
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-passerelle-locale-01M6NM1S
base_commit: 1b845fc307e11da9f24d9b87c0ccddb8f662a68e
created_at: '2026-11-05T15:45:39.897763+00:00'
subtasks: [T014, T015, T016, T017, T018, T019]
phase: Phase 2 - Base du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0059_edge_handover.sql
create_intent: [packages/ledger-sql/migrations/0059_edge_handover.sql, packages/ledger-sql/tests/tests_edge_handover.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0059_edge_handover.sql, packages/ledger-sql/tests/tests_edge_handover.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 : Base, bascule, rendu et reprise (migration 0059)

> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour la lecture réelle de `edge_reference_change` (aucune table temporaire, aucun SQL dynamique) et `edge_stuck_handovers`.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis ensuite la fiche de contexte fournie par l'orchestrateur, ce prompt, puis seulement :

- `docs/passation-8/contexte-m8.md` : décisions 5 et 6 ;
- `contracts/interfaces.md` § 1 (ligne 0059), § 2 (bloc WP04, signatures figées), § 7 (CL013 à CL017) ;
- `data-model.md` A.3 (colonnes, compte PAR CYCLE, époques), A.4 (lignes des fonctions de bascule), A.6 invariants 1 et 4,
  A.7 (machine à états et « persisté avant de répondre ») ;
- `research.md` R-06 (points 2 et 4), R-07 (lignes de WP04 et les deux notes après la table), R-11 (points 2 et 3) ;
- constats `A03`, `A05`, `A13`, `A17` de `docs/passation-8/rapports/plan-adversarial.md` ;
- code : `schema_grand_livre_cashless.sql` l. 2491-2704 (handover, transitions, `grant_edge_authority`, `ack_edge_handover`,
  `fail_edge_grant`, `request_edge_release`, `complete_edge_release`, `force_central_authority`, tous NON modifiés), l. 2707-2760
  (`edge_sync_registry`, `record_edge_seq`) ; `migrations/0036_cash_sessions.sql` l. 366-420 et `migrations/0040*.sql` l. 19-60
  (dernière définition de `begin_cash_close`, ordre des verrous) ; `migrations/0058_edge_gateway_admin.sql` (WP03, fait).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. En cas de désaccord entre `tasks.md`,
`interfaces.md` et `data-model.md`, `interfaces.md` fait foi.

## Objective

Compléter la base de la bascule d'autorité sans toucher aux fonctions S12 du kit : colonnes du handover, notification
`pg_notify`, enveloppes liées à la passerelle (accord, accusé idempotent, rendu en deux temps, échec, lecture), reprise forcée
avec preuve d'approbation, et refus de `begin_cash_close` tant que l'autorité n'est pas au central. Aucun `GRANT`.

## Branch Strategy

- Branche de planification et de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP04 --agent claude --mission passerelle-locale-01M6NM1S`
  (avec `LC_ALL=C LANG=C`).

## Périmètre et arbitrages

- Dans le lot : `0059_edge_handover.sql`, suite pgTAP **sous le propriétaire** (pas de `SET ROLE`). `SECURITY DEFINER`,
  `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC` ; aucun `GRANT`. Les S12 gardent signature et corps
  (C-003) ; `force_central_authority` n'est JAMAIS modifiée.
- **Numéro de migration** : `interfaces.md` § 1 donne 0059 pour ce contenu ; `data-model.md` A.3 range `pg_notify` en 0058 et
  `research.md` R-11 place `begin_cash_close` en 0058. 0059 fait foi. Signale l'écart.
- **Dépendance inversée à signaler (A03)** : `reference_watermark_seq` est le dernier `change_seq` du journal
  `edge_reference_change`, table créée en 0063 (WP08), APRÈS ce lot. Une fonction plpgsql se crée sans la table, mais l'accord
  échouerait sur une base arrêtée à 0059. Fais lire le journal par SQL dynamique : si la table est absente, **échec fermé** (refus de
  l'accord, jamais filigrane à 0). Tes tests créent une table temporaire de même nom et de même forme
  (`ledger_id`, `change_seq`) dans la transaction du test ; le test de bout en bout avec le vrai journal est celui de WP08
  et de WP25. Dis-le dans le rapport : c'est un point de contrôle pour l'orchestrateur.
- `edge_grant_authority` est l'enveloppe HUMAINE (appelée par `cashless_app`, pas de `app.gateway_id`). `fail_edge_grant` et
  `request_edge_release` du kit existent déjà ; `interfaces.md` ne les redéclare pas : n'en crée pas de nouvelle version. Vérifie à
  quels rôles ils sont accordés aujourd'hui et signale à WP09 ce qui manque dans `data-model.md` A.1.
- Types : `authority_epoch` et `epoch` sont `int` au schéma (S:2491) ; les signatures de `interfaces.md` disent `bigint` : compare
  en `bigint`, sans changer une colonne.
- Les enveloppes `edge_*` comparent `p_gateway` à `current_setting('app.gateway_id', true)` ; désaccord ou absence : `42501`.
  Passerelle `REVOKED` : refus. Rôle `PRIMARY` exigé sauf pour la lecture.

## Subtasks

### T014 : Colonnes du handover et notification

- `debit_authority_handover` : `begun_releasing_at timestamptz NULL`, `ops_count bigint NULL`, `edge_seq_at_activation bigint NULL`,
  `reference_watermark_seq bigint NULL`. Toutes nullables ; le déclencheur `check_handover_transition` n'interdit pas ces colonnes
  (relis-le : il ne protège que l'identité et les transitions). Vérifie qu'un `UPDATE` de ces colonnes passe.
- Déclencheur `AFTER INSERT OR UPDATE` : `pg_notify('edge_handover_changed', edge_gateway_id::text)` (R-17, réveil de l'attente
  longue, WP10). Le payload ne contient que l'identifiant de la passerelle, rien d'autre.

### T015 : `edge_grant_authority`, `get_debit_authority`, `get_current_edge_handover`

- `edge_grant_authority(p_ledger, p_gateway, p_actor)` : refuse (`CL013`) si une session de caisse du grand livre est `CLOSING` (un
  comptage en cours serait faussé), puis appelle `grant_edge_authority` (qui prend le verrou d'autorité exclusif), puis, **sous ce
  même verrou**, lit le dernier `change_seq` du grand livre et le range dans `reference_watermark_seq` du handover rendu.
  Passerelle d'un autre événement, `STANDBY`, `REVOKED` ou non `ACTIVE` : refus par `grant_edge_authority` (ne le réimplémente pas).
- `get_debit_authority(p_ledger)` : renvoie `(ledger_id, authority, epoch, edge_gateway_id, lan_url)`, `assert_tenant`, `STABLE` ;
  `no_data_found` hors périmètre. `lan_url` vient de la passerelle désignée par `ledger.edge_gateway_id`, nul sous `CENTRAL`.
- `get_current_edge_handover(p_gateway)` : UN handover au plus, par priorité (A13) : (1) le `TO_CENTRAL` ouvert (`RELEASE_REQUESTED`,
  `RELEASING`) ; (2) sinon le dernier `TO_CENTRAL` `FAILED` du `TO_EDGE` actif, tant que ce `TO_EDGE` reste `ACTIVE` et qu'aucun
  `TO_CENTRAL` plus récent n'existe ; (3) sinon le `TO_EDGE` `GRANTED` ou `ACTIVE` ; (4) sinon aucune ligne. Un handover d'une
  AUTRE passerelle n'est jamais rendu. Compare `p_gateway` à `app.gateway_id`.

### T016 : `edge_ack_handover` idempotent, `reference_applied_seq`

- Contrôles d'appartenance (handover de cette passerelle, `PRIMARY`, non `REVOKED`) puis S12 `ack_edge_handover(h, epoch, replicated)`.
  `CL013` pour un handover étranger ou inconnu (message identique : aucun oracle sur l'existence).
- **Refus (`CL014`, `409 EDGE_NOT_CAUGHT_UP`)** tant que `edge_gateway.reference_applied_seq < reference_watermark_seq` (A03). La
  colonne est posée par `edge_replication_page` (WP08), pas ici : ton test pose la valeur par `UPDATE` sous le propriétaire.
- **Idempotence (A17)** : handover déjà `ACTIVE`, de cette passerelle, à cette époque, grand livre encore `EDGE` à cette époque :
  rend l'état courant sans écrire (la réponse perdue puis rejouée donne `200`). Autre époque ou grand livre revenu au central : `CL015`.
- À l'accusé réel : pose `edge_seq_at_activation := edge_gateway.contiguous_edge_seq` (dernier numéro du cycle précédent).

### T017 : `begin_edge_release`, `edge_complete_release`, `fail_edge_release`

- `begin_edge_release(gw, h, epoch, final_seq, last_hash, ops)` : `RELEASE_REQUESTED -> RELEASING`, pose `begun_releasing_at`, `ops_count`,
  `final_edge_seq`, `last_chain_hash`. Rejouable (déjà `RELEASING` : sans effet). Ne vérifie que l'appartenance et l'époque
  (`CL013`, `CL015`). **Le commit propre n'est pas une fonction SQL** : l'API l'appelle dans sa propre transaction avant la
  vérification (WP12). N'essaie ni transaction autonome ni `dblink`. Documente-le en en-tête.
- `edge_complete_release(...)` : refuse un `COMPLETED` direct depuis `RELEASE_REQUESTED` (le handover doit être passé par `RELEASING`,
  `CL013`) ; contrôle `ops = final_edge_seq - edge_seq_at_activation` du `TO_EDGE` lié, sinon `CL017` ; puis appelle
  `complete_edge_release`. Erreurs `CL014` (numéros manquants : le message liste les `missing_edge_seqs`, WP12 en fait une réponse),
  `CL017` (chaîne ou compte), `CL015`.
- **`operations_count` est un compte PAR CYCLE (A05)** : la numérotation ne repart jamais de zéro. Premier cycle :
  `edge_seq_at_activation = 0`, `ops_count = final_edge_seq`. Deuxième cycle d'une passerelle rendue à 4211 : file de 40 ventes,
  `final_edge_seq = 4251`, `ops_count = 40`.
- `fail_edge_release(p_handover, p_actor)` : `TO_CENTRAL RELEASE_REQUESTED|RELEASING -> FAILED` ; l'autorité reste à la passerelle
  (le grand livre reste `EDGE`). Humaine (`cashless_app`).

### T018 : `force_central_authority_approved`, `begin_cash_close`

- `force_central_authority_approved(p_ledger, p_approval, p_reason)` : lit `approval_request` (action `FORCE_CENTRAL_AUTHORITY`, statut
  `APPROVED`, demandeur et valideur distincts, jamais exécutée, du même prestataire et du même grand livre) puis appelle
  `force_central_authority`. Refus : `CL013` ou `42501` selon l'erreur. La demande est rendue `EXECUTED` par l'API, pas ici
  (garde `approval_request_guard`). Relis `approval_request` (S:2908) pour les colonnes exactes de la charge.
- `begin_cash_close` : `CREATE OR REPLACE` depuis la DERNIÈRE définition (0040), signature et valeurs de retour inchangées, garde
  ajoutée **après** les verrous de 0040 (terminal, session, solde) : refus (`CL029`, rendu `409 CONFLICT_STATE` par l'API) si
  `ledger.debit_authority <> 'CENTRAL'` ou si un handover `TO_EDGE`/`TO_CENTRAL` est ouvert pour le grand livre de la session. Comportement
  NOUVEAU hors `/edge/*` : couvert par la décision 6 du porteur, à consigner (WP25). Aucun autre changement de la fonction.

## Tests attendus : T019, `tests_edge_handover.sql`

Gabarit `tests/tests_cash_sessions.sql` ; propriétaire seul ; prestataires A et B ; deux passerelles du même événement et une
d'un autre événement.

- Deux cycles complets : premier (`ops_count = final_edge_seq`), second (4211 puis 4251, `ops_count = 40`) ; compte faux : `CL017`.
- `get_current_edge_handover` : les quatre priorités (A13), y compris `TO_CENTRAL` ouvert qui l'emporte sur le `TO_EDGE ACTIVE`, le
  `FAILED` de la fenêtre bornée, et une autre passerelle qui ne voit rien.
- A17 : accusé rejoué deux fois, `200` sans écriture ; à une autre époque `CL015` ; après retour au central `CL015`.
- A03 : accusé refusé tant que `reference_applied_seq < reference_watermark_seq` ; accepté ensuite ; accord sans journal : refusé.
- A05 : `edge_seq_at_activation` posé à l'accusé du deuxième cycle.
- RELEASING conservé : `begin_edge_release`, `SAVEPOINT`, `edge_complete_release` qui échoue (`CL014`), `ROLLBACK TO SAVEPOINT`, l'état
  est encore `RELEASING` ; `COMPLETED` direct depuis `RELEASE_REQUESTED` refusé.
- Reprise forcée : sans approbation, approbation du même demandeur, action autre, déjà exécutée : refus ; avec approbation valide :
  passerelle `REVOKED` (déclencheur WP03), grand livre `CENTRAL` à l'époque `e+2`, handovers `FORCED`.
- Accord refusé avec une session de caisse `CLOSING` ; `begin_cash_close` refusé sous `EDGE` et avec un handover ouvert, accepté sous
  `CENTRAL` (les suites de caisses existantes doivent rester vertes).
- Handover d'une autre passerelle : `CL013` sur chaque enveloppe ; autre prestataire : `no_data_found` ; `search_path` des fonctions ;
  notification `edge_handover_changed` émise (écoute dans la transaction).
- Chaque test doit échouer sur une implémentation fausse (compte global au lieu du compte par cycle, accusé non idempotent).
- Tu ne lances ni pgTAP ni `reset-db` ; l'orchestrateur relance aussi `tests_cash_sessions.sql` et les suites du kit.

## Sécurité

- **À faire relire par une personne** : `begin_cash_close` (remplacée), `edge_grant_authority`, `force_central_authority_approved`,
  `edge_ack_handover` (règle 4 de `CLAUDE.md`). `force_central_authority` reste intacte.
- Les enveloppes lient la passerelle au handover : sans cela, une `PRIMARY` d'un autre événement du même prestataire pourrait
  accuser ou rendre le handover d'une autre (R-06). Test pour chaque enveloppe.
- Une seule autorité à la fois (invariant 1) : rien de ce lot n'ouvre une écriture débitrice de plus. `CL006` reste levée.
- Règle 1 : tout écart qui affaiblit la sécurité (garde retirée, accord sans filigrane de référence) est soumis au porteur
  AVANT d'être codé.

## Definition of Done

- [ ] `0059_edge_handover.sql` applicable ; en-tête (ordre des verrous, commit séparé du début de rendu, dépendance au journal 0063).
- [ ] Fonctions de `interfaces.md` § 2 (WP04) aux signatures figées ; `search_path`, `REVOKE ALL ... FROM PUBLIC`, aucun `GRANT`.
- [ ] S12 inchangées (`git diff` du schéma vide) ; `begin_cash_close` seule fonction du kit remplacée.
- [ ] `tests_edge_handover.sql` écrit, deux cycles et reprise forcée compris.
- [ ] Rapport : signatures réelles, contradictions (numéro de migration, dépendance au journal, EXECUTE de `fail_edge_grant` et
      `request_edge_release`), fichiers à relire, ce qui n'a pas été lancé.
- [ ] Aucun `.sql` généré modifié ; aucun commit ; le port 80 n'est pas touché.

## Ce que le relecteur doit casser

1. Accuser deux fois : la seconde réponse est `200` sans écriture ; à une autre époque, `CL015`.
2. Accuser avec `reference_applied_seq` en retard d'un cran : refusé ; accord sans journal : refusé (pas de filigrane à 0).
3. Rendre avec une file incomplète : `CL014` et `RELEASING` conservé ; avec un compte d'opérations faux : `CL017`.
4. Demander le handover d'une autre passerelle à chaque enveloppe : refusé, même message qu'un handover inconnu.
5. Deuxième cycle avec le compte du premier : `CL017`.
6. Reprise forcée avec le même demandeur et valideur, ou une demande déjà `EXECUTED`.
7. `begin_cash_close` sous `EDGE`, sous `CENTRAL` avec un handover `GRANTED` ouvert ; puis sous `CENTRAL` normal.
8. Vérifier que `force_central_authority` et `grant_edge_authority` du kit n'ont pas bougé.
