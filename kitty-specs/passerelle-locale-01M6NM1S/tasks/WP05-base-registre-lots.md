---
work_package_id: WP05
title: 'Base : registre, lots et garde EDGE_SYNC (migration 0060)'
dependencies: [WP03]
requirement_refs:
- FR-019
- FR-031
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T020, T021, T022, T023]
phase: Phase 2 - Base du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0060_edge_sync_registry.sql
create_intent: [packages/ledger-sql/migrations/0060_edge_sync_registry.sql, packages/ledger-sql/tests/tests_edge_sync.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0060_edge_sync_registry.sql, packages/ledger-sql/tests/tests_edge_sync.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 : Base, registre, lots et garde `EDGE_SYNC` (migration 0060)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis ensuite la fiche de contexte fournie par l'orchestrateur, ce prompt, puis seulement :

- `docs/passation-8/contexte-m8.md` : décisions 4, 5, 6 ;
- `contracts/interfaces.md` § 1 (ligne 0060), § 2 (bloc WP05, signatures figées et phrase finale sur `app.gateway_id`), § 7 ;
- `data-model.md` A.5 (`edge_sync_batch`, `edge_sync_batch_result`, `edge_sync_registry` modifiée, lot abandonné A29), A.6
  invariants 2, 3, 5, 10 ;
- `research.md` R-06 (points 2 et 3), R-08 (table d'idempotence, traitement, issues du registre), R-09 (paragraphe « Garde dans
  `post_transaction` ») ;
- constats `A06`, `A10`, `A29` de `docs/passation-8/rapports/plan-adversarial.md` ;
- code : `schema_grand_livre_cashless.sql` l. 510-600 (`post_transaction`, source `EDGE_SYNC`, CL006), l. 1973-1981 (`chain_step`,
  `edge_chain_genesis`), l. 2120-2143 (`offline_batch`, index « un seul lot en vol »), l. 2705-2760 (`edge_sync_registry`,
  `record_edge_seq`) ; la DERNIÈRE définition de `post_transaction` dans `migrations/` (cherche `post_transaction` en
  `CREATE OR REPLACE`) ; `tests_grand_livre_cashless.sql` l. 118 et 495-545 ; `gen_tests.py` l. 166 et 662.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. En cas de désaccord entre `tasks.md`,
`interfaces.md` et `data-model.md`, `interfaces.md` fait foi.

## Objective

Donner à la file de la passerelle une base sûre : un registre qui accepte `VOID`, des tables d'idempotence des lots (un seul lot
en vol par passerelle), l'enveloppe `edge_record_seq` qui refuse une passerelle révoquée ou sans handover, et la garde qui
retire `EDGE_SYNC` à `cashless_app`. Le test du kit qui appelle `post_transaction` en `EDGE_SYNC` sous le propriétaire doit
rester vert. Aucun `GRANT`.

## Branch Strategy

- Branche de planification et de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP05 --agent claude --mission passerelle-locale-01M6NM1S`
  (avec `LC_ALL=C LANG=C`).

## Périmètre et arbitrages

- Dans le lot : `0060_edge_sync_registry.sql` et la suite pgTAP **sous le propriétaire**. `SECURITY DEFINER`,
  `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC` ; aucun `GRANT`. Toute table nouvelle : `operator_id`,
  `tenant_isolation` ENABLE + FORCE, aucune écriture directe prévue pour un rôle applicatif (c'est WP09 qui retire les droits).
- **Numéro de migration** : `interfaces.md` donne 0060 pour la garde `EDGE_SYNC` et les tables de lot ; `research.md` R-08 range
  `edge_sync_batch` en 0059 et R-09 range la garde en 0058 ; `data-model.md` A.5 les range en 0060/0061. 0060 fait foi. Signale-le.
- Hypothèse : ce lot ne dépend que de WP03 (la passerelle et son statut `REVOKED`). Il ne peut pas compter sur les colonnes de
  handover de 0059 (WP04) : la lane de WP05 peut ne pas les contenir. Pour le contrôle « handover de cette passerelle »,
  lis directement `debit_authority_handover` (colonnes du kit : `edge_gateway_id`, `direction`, `status`, `ledger_id`, `epoch`).
- Les fonctions S12 (`record_edge_seq`) ne sont PAS modifiées (C-003). `post_transaction` : `CREATE OR REPLACE` depuis sa dernière
  définition, signature et corps INCHANGÉS sauf une garde ajoutée. Fichier à faire relire par une personne.
- Hors lot : `edge_post_transaction` et les fonctions de guichet (WP06, WP07), les routes (WP13), les droits (WP09).

## Subtasks

### T020 : Tables d'idempotence, `VOID` au registre, trois fonctions de lot

- **`edge_sync_batch`** (A.5) : `batch_id uuid PK` (= `Idempotency-Key`), `operator_id`, `gateway_id` REFERENCES `edge_gateway`, `ledger_id`,
  `epoch`, `edge_seq_from`, `edge_seq_to` (`from <= to`, au plus 500 opérations), `request_sha256 bytea` (32 octets), `status`
  (`RECEIVED`, `PROCESSING`, `DONE`, `ABANDONED`), `received_at`, `completed_at`. Index unique partiel
  `edge_sync_batch_one_in_flight (gateway_id) WHERE status IN ('RECEIVED','PROCESSING')`.
- **`edge_sync_batch_result`** : `(batch_id, edge_seq)` PK, `operator_id`, `outcome` (`ACCEPTED`, `ACCEPTED_WITH_SHORTFALL`, `DUPLICATE`,
  `REJECTED`, `VOID`), `reason`, `detail`, `transaction_id` NULL, `retryable boolean`. Immuable (`forbid_mutation`).
- **`edge_sync_registry`** : remplace la contrainte d'`outcome` pour admettre `VOID` (numéro consommé sans effet comptable, aussi
  l'`ONLINE_REF` sans écriture). Trouve le nom réel de la contrainte (auto-nommée) par le catalogue, ne le devine pas. Conserve les deux
  `CHECK` (`transaction_id` exigé pour `ACCEPTED_WITH_SHORTFALL`/`DUPLICATE`, interdit pour `REJECTED`). La table reste immuable.
  `WAIVED` n'est PAS ajoutée.
- `edge_sync_batch_begin(p_gateway, p_batch, p_epoch, p_from, p_to, p_request_sha256)` → `(state, already_done)` : compare `p_gateway` à
  `app.gateway_id` (`42501`). Lot nouveau : le crée en `PROCESSING`. Même `batch_id`, même empreinte : rend l'état (`already_done = true`
  si `DONE`). Même `batch_id`, autre empreinte : `CL002` (rendu `422 IDEMPOTENCY_KEY_REUSED`). Autre lot déjà en vol pour la passerelle :
  `CL010`. Un lot en vol interrompu depuis plus de 15 minutes passe `ABANDONED` (même règle que le lot de terminal, SP §6.2-6) avant
  l'ouverture du suivant.
- `edge_sync_batch_result(p_batch, p_edge_seq, p_outcome, p_reason, p_detail, p_tx, p_retryable)` : lot de la passerelle appelante,
  `edge_seq` dans l'intervalle du lot, idempotent (même ligne : rien ; ligne différente : `CL002`).
- `edge_sync_batch_finish(p_batch, p_status)` : `DONE` ou `ABANDONED` seulement ; pose `completed_at`. Cette fonction figure dans
  `interfaces.md` § 2 mais pas dans `data-model.md` A.4 ni dans la liste de `cashless_edge` de A.1 : **signale-le à WP09**.
- **Lot abandonné (A29)** : documente en en-tête que ses résultats sont partiels et que la passerelle renvoie le reste sous un NOUVEAU
  `batch_id` avec `edge_seq_from` = premier numéro non enregistré. Test ci-dessous.

### T021 : `edge_record_seq`

`edge_record_seq(p_gateway, p_edge_seq, p_origin_key, p_content, p_outcome, p_tx, p_reason)` → `void`. Compare `p_gateway` à
`app.gateway_id` (`42501`). Refuse (`CL013`) : passerelle `REVOKED` ; `STANDBY` ; ABSENCE de handover de CETTE passerelle pour son grand
livre, soit `TO_EDGE ACTIVE`, soit `TO_CENTRAL RELEASE_REQUESTED|RELEASING` (la vidange). Puis appelle `record_edge_seq`. Les erreurs du kit
sont conservées : `CL002` (autre contenu), `CL016` (numéro non suivant). Le numéro n'est jamais consommé sans résultat explicite. Une
`origin_key` déjà connue avec un autre numéro est refusée par l'unicité `(gateway_id, origin_key)`.

### T022 : Garde `EDGE_SYNC` de `post_transaction`

- Une écriture de source `EDGE_SYNC` est refusée quand `session_user` est le rôle de connexion `cashless_app`. On teste `session_user`
  parce que la fonction est `SECURITY DEFINER` (`current_user` y est le propriétaire).
- Forme (R-09) : **liste d'autorisation** préférée (`session_user` ∈ {propriétaire du schéma, `cashless_edge`}), parce qu'une liste de refus
  oublie le prochain rôle. Le propriétaire reste autorisé pour ne pas casser `tests_grand_livre_cashless.sql:118`, qui appelle
  `post_transaction` en `EDGE_SYNC` sous le propriétaire et que tu ne modifies pas. Si `cashless_edge` n'existe pas (base sans `0058`),
  la garde reste fermée. Choisis, justifie en en-tête, et si tu choisis la liste de refus, remonte-le (affaiblissement possible).
- Message et code d'erreur : réutilise le code existant le plus proche (`CL006` ou `42501`), et dis lequel dans le rapport. Aucun
  autre changement de comportement de `post_transaction`, aucun nouveau paramètre.
- Un `SET ROLE` ne change pas `session_user` : un test pgTAP par `SET ROLE` ne prouve rien. Tu peux utiliser `SET SESSION AUTHORIZATION`
  si le poste de test est superutilisateur ; sinon, le test à connexion réelle est celui de WP09 (T040). Écris-le dans le rapport.

## Tests attendus : T023, `tests_edge_sync.sql`

Gabarit `tests/tests_cash_sessions.sql` ; propriétaire seul ; prestataires A et B ; une passerelle `PRIMARY` avec handover actif.

- Idempotence : même lot rejoué (mêmes résultats), autre empreinte (`CL002`), second lot en vol (`CL010`), lot abandonné après 15 min puis
  reprise sous un nouveau `batch_id` avec numéros continus (A29) ; résultat rejoué à l'identique accepté, différent `CL002`.
- Ordre : `CL016` sur un saut, rejeu exact accepté (`replayed`), même numéro autre contenu `CL002` ; chaîne : après trois numéros,
  `last_chain_hash` égal à `chain_step` itéré depuis `edge_chain_genesis` (calcul indépendant dans le test, pas la fonction testée).
- `VOID` : écrit sans `transaction_id`, accepté ; `REJECTED` avec `transaction_id` refusé (contrainte conservée) ; mutation du registre refusée.
- `edge_record_seq` refuse : passerelle `REVOKED`, `STANDBY`, sans handover, handover d'une AUTRE passerelle, handover `FAILED`,
  `p_gateway` différent de `app.gateway_id`. Accepte la vidange (`RELEASING`) ; autre prestataire : `no_data_found`.
- Garde : `post_transaction` en `EDGE_SYNC` sous le propriétaire passe encore ; les cinq autres sources (`ONLINE`, `OFFLINE_SYNC`,
  `PSP_WEBHOOK`, `BATCH`, `BACKOFFICE`) ne changent pas de comportement ; sous `cashless_app` (si `SET SESSION AUTHORIZATION` possible) :
  refusée, et la même écriture en `ONLINE` passe.
- Tables : RLS forcée sur les deux nouvelles ; fonctions : `prosecdef`, `search_path`, non exécutables par `PUBLIC`.
- Chaque test doit échouer sur une implémentation fausse (garde absente, contrainte `VOID` oubliée, `REVOKED` accepté).
- Tu ne lances ni pgTAP ni `reset-db`. L'orchestrateur relance `tests_grand_livre_cashless.sql`, `tests_definer_search_path.sql`,
  `tests_offline_snapshots.sql` et les suites de paiement sans modification.

## Sécurité

- **À faire relire par une personne** : `post_transaction` modifiée (garde), `edge_record_seq`, la contrainte de registre remplacée.
- La garde ferme la source la plus puissante (seule à débiter sous `EDGE`) au code de l'API publique. Une garde qui échoue ouverte est
  un défaut bloquant : en cas de doute sur `session_user`, la fonction refuse.
- Le registre est immuable et la chaîne ne repart jamais de zéro : n'ajoute aucune voie de correction ni de purge.
- Règle 1 : tout écart qui affaiblit la sécurité (liste de refus au lieu d'autorisation, contrôle de handover omis, `VOID` sans
  contrainte) est soumis au porteur AVANT d'être codé.

## Definition of Done

- [ ] `0060_edge_sync_registry.sql` applicable ; en-tête (nom de la contrainte remplacée, forme de la garde, raison, codes d'erreur).
- [ ] Quatre fonctions de lot et `edge_record_seq` aux signatures figées ; `post_transaction` identique hors la garde (diff relu).
- [ ] `tests_edge_sync.sql` écrit ; le test du kit en `EDGE_SYNC` sous le propriétaire reste vert (preuve demandée à l'orchestrateur).
- [ ] Rapport : signatures réelles, contradictions (numéro de migration, `edge_sync_batch_finish` absent de A.1/A.4), choix de la
      garde, fichiers à relire, ce qui n'a pas été lancé.
- [ ] Aucun `.sql` généré modifié ; aucun commit ; le port 80 n'est pas touché.

## Ce que le relecteur doit casser

1. Appeler `post_transaction(... 'EDGE_SYNC' ...)` depuis une connexion réelle `cashless_app` : refus attendu (preuve en WP09).
2. Écrire un numéro `VOID` avec `transaction_id`, ou un `REJECTED` avec `transaction_id` : refusé.
3. Appeler `edge_record_seq` pour une passerelle `REVOKED`, `STANDBY`, ou sans handover actif : refus.
4. Ouvrir deux lots pour la même passerelle sans que le premier soit terminé ou abandonné.
5. Rejouer un `batch_id` avec un corps différent : `CL002` et non un résultat mémorisé.
6. Sauter un `edge_seq`, ou le rejouer avec un autre contenu.
7. Comparer `post_transaction` avant et après : un seul ajout, la garde.
8. Vérifier qu'un `edge_seq` consommé n'est jamais sans ligne de registre ni sans résultat de lot.
