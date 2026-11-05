---
work_package_id: WP07
title: 'Base : opérations de guichet en EDGE_SYNC (migration 0062)'
dependencies: [WP06]
requirement_refs:
- FR-016
- FR-020
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T029, T030, T031, T032]
phase: Phase 2 - Base du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0062_edge_counter_ops.sql
create_intent: [packages/ledger-sql/migrations/0062_edge_counter_ops.sql, packages/ledger-sql/tests/tests_edge_counter_ops.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0062_edge_counter_ops.sql, packages/ledger-sql/tests/tests_edge_counter_ops.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 : Base, opérations de guichet en `EDGE_SYNC` (migration 0062)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis ensuite la fiche de contexte fournie par l'orchestrateur, ce prompt, puis seulement :

- `docs/passation-8/contexte-m8.md` : décisions 4 et 14 ;
- `contracts/interfaces.md` § 1 (ligne 0062), § 2 (bloc WP07, « mêmes retours que `edge_post_transaction` »), § 7 ;
- `data-model.md` A.4 bis, points 9, 10, 11 (et 1, 2 qui s'appliquent), A.6 invariants 3 et 7 ;
- `research.md` R-10 EN ENTIER (constat, décision, rejeu impossible, clé d'origine A10), R-11 (garde de caisse ADR-132) ;
- constats `A09`, `A10`, `A24` de `docs/passation-8/rapports/plan-adversarial.md` ; ADR-163 et OP-N108, OP-N107 (ADR-162) ;
- code : `schema_grand_livre_cashless.sql` l. 1110 (`preload_media`), l. 1336 (`activate_media`), l. 1596 (`take_deposit`), l. 1848
  (`wallet_topup_headroom`), l. 1880 (`refund_cash_due`) ; `migrations/0036_cash_sessions.sql` l. 177-211 (`cash_session_usable`,
  `cash_session_attach_own`), l. 500-529 (`posting_cash_desk_guard`), l. 640-657 (`take_deposit_for_session`) ;
  `migrations/0060_edge_sync_registry.sql` et `0061_edge_post_transaction.sql` (WP05, WP06 : `edge_record_seq`, construction des
  lignes, plafonds, anomalies) ; `docs/sync_protocol.md` §8 (cas 22) et §9.6 ; `packages/contracts/openapi.yaml` `EdgeSyncOperation`
  (l. 14416) et `edge_guichet`.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. En cas de désaccord entre `tasks.md`,
`interfaces.md` et `data-model.md`, `interfaces.md` fait foi.

## Objective

Rejouer au central les opérations de guichet décidées par la passerelle (activation de bracelet, caution en espèces, recharge
espèces) sans jamais perdre une trace : trois fonctions nouvelles en source `EDGE_SYNC` avec la clé d'origine du terminal, sans
toucher aux fonctions éprouvées `activate_media`, `take_deposit`, `take_deposit_for_session`. Une opération qui ne peut pas être
rejouée ouvre une anomalie portant le montant, jamais un rejet muet. Aucun `GRANT`.

## Branch Strategy

- Branche de planification et de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP07 --agent claude --mission passerelle-locale-01M6NM1S`
  (avec `LC_ALL=C LANG=C`).

## Périmètre et arbitrages

- Dans le lot : `0062_edge_counter_ops.sql`, suite pgTAP **sous le propriétaire**. Fonctions `SECURITY DEFINER`,
  `search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC` ; aucun `GRANT`. Les trois fonctions ont les mêmes arguments et les
  mêmes retours que `edge_post_transaction` : `(p_gateway, p_epoch, p_edge_seq, p_origin_key, p_content, p_op jsonb)` →
  `(outcome, transaction_id, reason, detail, charged_to_wallet, shortfall_amount)`. `research.md` R-10 en décrit d'autres
  (`origin_key, media, cash_session, ...`) : périmé, tout est dans `p_op`. Signale l'écart.
- Vérifications d'enveloppe IDENTIQUES à WP06 (reprends le même schéma, sans le dupliquer inutilement : une fonction interne partagée
  est permise si elle n'est accordée à personne ; sinon répète le bloc) : `p_gateway = app.gateway_id` (`42501`), passerelle non
  `REVOKED` et `PRIMARY`, handover de cette passerelle, époque, `origin_key` bien formée. Chaque fonction écrit l'opération ET
  appelle `edge_record_seq` dans la MÊME transaction.
- **Clé d'origine (A10)** : `activateMedia`, `takeDeposit`, `createCashTopup` utilisent comme `origin_key` l'`Idempotency-Key` du terminal
  `<serial>:<seq>`. Une requête qui produit deux opérations (activation avec caution) : la caution porte `<serial>:<seq>#deposit`.
  `edge_activate_media` cherche aussi la clé dans le registre d'idempotence de la route en ligne (`api_idempotency`) et rend `DUPLICATE`.
- Garde de caisse ADR-132 INCHANGÉE et sans exemption (C-005) : tout `posting` sur un compte `cash_desk` exige une session `OPEN`.
- `FROM_BALANCE` (caution prélevée sur le solde) : refusé en `EDGE_SYNC` (cohérent avec SP:752-758) ; la passerelle ne le sert pas.
- Aucune valeur d'énumération ajoutée (A11). Hors lot : édition du serveur (WP13/WP14), traitement de `ONLINE_REF` inconnue (WP14).

## Subtasks

### T029 : `edge_activate_media` (A24)

- Mêmes contrôles que `activate_media` (dont `activation_modes` de l'événement, `CL020`), puis écriture de `preload_media` en source
  `EDGE_SYNC` avec la clé d'origine et les métadonnées `origin_key`, `origin_occurred_at`, `origin_mode`. Le bracelet et l'événement viennent
  de la base (`edge_guichet.media_id`, événement du grand livre), le canal est `DESK`.
- **Activation anonyme** : le portefeuille NE DOIT PAS exister, il est créé par l'enveloppe ; **jamais rattaché à un portefeuille
  existant**. Un `wallet_id` existant n'est admis que pour une réactivation du MÊME bracelet de ce portefeuille (même `media_assignment`).
  Sinon `REJECTED` / `MALFORMED_OPERATION` (détail dans `detail`), anomalie portant le terminal et la clé d'origine.
- Rejeu d'un bracelet déjà actif : `DUPLICATE` si c'est la même clé d'origine ; sinon `REJECTED` / `EDGE_REPLAY_FAILED` (raison
  existante), `detail` = code, aucun `transaction_id` (le registre l'interdit), anomalie `EDGE_REPLAY_FAILED`.

### T030 : `edge_take_deposit`, repli `EDGE_REPLAY_FAILED`

- Mode `SEPARATE` en espèces seulement. **Le compte de caisse n'est pas lu dans la requête** : c'est le compte de caisse de la session
  `OPEN` du terminal d'origine (`device`, session). Un `cash_desk_account_id` différent dans `p_op` : `REJECTED` / `MALFORMED_OPERATION`.
  Clé d'idempotence = `origin_key` (`...#deposit` quand elle accompagne une activation) ; source `EDGE_SYNC`.
- **Rejeu impossible** (SP:738-753, FR-020) : `REJECTED` / `EDGE_REPLAY_FAILED`. L'écriture d'attente de SP:746-750 (débit de la caisse,
  crédit `SUSPENSE`, `metadata.replay_failed`) n'est écrite QUE si la session d'origine est encore `OPEN` ; sinon la garde de caisse la
  refuserait (`CL029`) et l'ensemble planterait. Dans ce cas : aucune écriture, anomalie portant le montant, le terminal et la clé
  d'origine, résolution à deux (`ANOMALY_RESOLUTION`), espèces comptées au comptage de fermeture comme écart expliqué par l'anomalie.
  Aucune perte silencieuse (« Contradictions » n° 6 de `research.md`).

### T031 : `edge_topup_cash` : deux parts, jamais rejetée pour un plafond

- Recharge espèces décidée par la passerelle, source `EDGE_SYNC`, session de caisse `OPEN` DE CE TERMINAL ET DE CE GRAND LIVRE,
  rattachement à `cash_session_tx` (`cash_session_attach_own`). Bracelet et portefeuille lus en base.
- **Au rejeu, jamais rejetée pour un plafond réglementaire** (A09, décision 14) : écrite en deux parts selon `wallet_topup_headroom`
  (portefeuille jusqu'à la marge, reste en `L-ESP-A-RENDRE`), `ACCEPTED` et anomalie `CASH_TOPUP_OVER_LIMIT` portant `media_id` et
  `amount` (protocole §8 cas 22, ADR-63), résolue par `refund_cash_due` (deux personnes au-delà de `cash_refund_single_max`).
  Aucune autre cause ne doit rejeter par plafond.
- Toute AUTRE cause résiduelle (session fermée par un chemin non couvert, bracelet retiré) : `REJECTED` / `EDGE_REPLAY_FAILED` et anomalie
  portant le montant, le terminal et la clé d'origine ; les ventes qui en dépendent sont déjà traitées comme un manque par l'enveloppe
  de WP06 (rognage sous verrou). La décision 4 du porteur couvre ce cas (R-23) : aucune perte silencieuse.
- **Dépassement temporaire d'un plafond réglementaire entre la recharge locale et le rejeu : à signaler au juriste** (OP-N108, ADR-163).
  N'écris AUCUNE logique qui masque ce dépassement ; il doit rester visible par l'anomalie.

## Tests attendus : T032, `tests_edge_counter_ops.sql`

Gabarit `tests/tests_cash_sessions.sql` ; propriétaire seul ; prestataires A et B ; un événement, une passerelle `PRIMARY` à handover
`ACTIVE`, un terminal de guichet avec session de caisse `OPEN`, bracelets personnalisés.

- Activation : anonyme (portefeuille créé), avec `wallet_id` existant d'un autre bracelet (refus), réactivation du même bracelet (admise),
  mode d'activation non autorisé (`CL020`), même requête envoyée au central puis rejouée (`DUPLICATE`), autre clé sur un bracelet actif
  (`EDGE_REPLAY_FAILED` et anomalie).
- Caution : espèces avec session `OPEN` (écriture de caisse présente, source `EDGE_SYNC`, clé `...#deposit`) ; compte de caisse forcé
  (refus) ; session fermée entre-temps (anomalie avec montant et terminal, aucune écriture, aucun `CL029` qui remonte) ; `FROM_BALANCE` refusé.
- Recharge : montant dans la marge (une part) ; au-delà (deux parts, `ACCEPTED`, anomalie `CASH_TOPUP_OVER_LIMIT`, résolue ensuite à deux) ;
  JAMAIS un rejet pour plafond ; session fermée (anomalie, numéro enregistré) ; bracelet d'un autre événement (refus).
- Garde ADR-132 : toute écriture sur la caisse sans session `OPEN` est refusée par la garde et non contournée par l'enveloppe.
- Chaque fonction : `p_gateway` différent de `app.gateway_id` (`42501`), passerelle `REVOKED` ou `STANDBY`, époque fausse (`CL015`),
  autre prestataire (`no_data_found`), `edge_record_seq` enregistré dans la même transaction (une erreur provoquée après l'écriture annule
  les deux), somme nulle, `search_path`, aucune exécution par `PUBLIC`.
- Chaque test doit échouer sur une implémentation fausse (compte de caisse repris de la requête, rejet pour plafond, anomalie sans montant).
- Tu ne lances ni pgTAP ni `reset-db`. L'orchestrateur relance les suites de caisses et de recharges.

## Sécurité

- **À faire relire par une personne** : `0062` entier (argent en espèces, création de portefeuille, garde de caisse).
- Écart accepté et nommé : dépassement temporaire de plafond (OP-N108, ADR-163, juriste) ; test de borne : l'anomalie
  `CASH_TOPUP_OVER_LIMIT` existe et porte le montant, la recharge n'est jamais rejetée pour un plafond.
- Écart accepté : passerelle perdue avant rejeu, pas de rejeu automatique des activations et cautions (OP-N107, ADR-162) : résultat
  `EDGE_REPLAY_FAILED` + anomalie, résolution à deux ; test qui échoue si une perte devient silencieuse.
- Ni le compte de caisse, ni le portefeuille, ni le grand livre ne viennent de la requête. Une activation ne rattache jamais un
  bracelet à un portefeuille existant d'un autre porteur (risque de détournement de solde).
- Règle 1 : tout écart qui affaiblit la sécurité (garde de caisse contournée, exemption) est soumis au porteur AVANT d'être codé.

## Definition of Done

- [ ] `0062_edge_counter_ops.sql` applicable ; en-tête (clés d'origine, garde de caisse, cas de repli).
- [ ] Trois fonctions aux signatures figées ; `REVOKE ALL ... FROM PUBLIC` ; aucun `GRANT` ; fonctions existantes non modifiées (diff vide).
- [ ] `tests_edge_counter_ops.sql` écrit, repli et deux parts compris.
- [ ] Rapport : signatures réelles, contradictions (arguments de R-10, écarts de numérotation), fichiers à relire, ce qui n'a pas été lancé.
- [ ] Aucun `.sql` généré modifié ; aucun commit ; le port 80 n'est pas touché.

## Ce que le relecteur doit casser

1. Une caution dont `cash_desk_account_id` n'est pas celui de la session du terminal : refusée.
2. Une recharge au-delà du plafond : acceptée en deux parts avec anomalie, jamais rejetée ; la somme des parts égale le montant.
3. Une activation avec un `wallet_id` appartenant à un autre bracelet.
4. Une caution après fermeture de la session de caisse : anomalie avec montant, aucune erreur `CL029` remontée.
5. Rejouer la même `origin_key` deux fois : `DUPLICATE`, une seule écriture.
6. Écrire sur la caisse sans session `OPEN` en passant par l'enveloppe : refusé.
7. Une erreur après l'écriture doit annuler aussi `edge_record_seq`.
8. `git diff` : `activate_media`, `take_deposit`, `take_deposit_for_session` intactes.
