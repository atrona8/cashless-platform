---
work_package_id: WP19
title: "Traitement des opérations d'un lot : registre, conformité, conflit, écriture, CL007"
dependencies: [WP06, WP07, WP16, WP17, WP18]
requirement_refs:
- FR-015
- FR-018
- FR-019
- FR-021
- FR-023
- FR-024
- FR-026
- FR-028
- NFR-011
- NFR-014
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots.
  During /spec-kitty.implement this WP may branch from a dependency-specific base, but
  completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human
  explicitly redirects the landing branch.
subtasks: [T077, T078, T079, T080, T081, T082]
phase: Phase 3 - API
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/offline/processing/
create_intent: [apps/api/src/offline/processing/offline-operation.processor.ts, apps/api/src/offline/processing/compliance-input.reader.ts, apps/api/src/offline/processing/offline-sale.writer.ts, apps/api/src/offline/processing/offline-reversal.writer.ts, apps/api/src/offline/processing/offline-processing.module.ts, apps/api/test/integration/offline/processing.spec.ts, apps/api/test/integration/offline/processing-conflicts.spec.ts, apps/api/test/integration/offline/processing-retry.spec.ts, apps/api/test/unit/ledger/offline-spend.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/offline/processing/**, apps/api/src/ledger/types.ts, apps/api/src/ledger/ledger-engine.service.ts, apps/api/src/ledger/builders/festival/purchase.ts, apps/api/src/ledger/money/spend.ts, apps/api/src/media/taps/tap.service.ts, apps/api/test/integration/offline/processing*.spec.ts, apps/api/test/unit/ledger/offline-spend.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP19 – Traitement des opérations

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite la fiche de contexte
d'implémentation de l'orchestrateur, ce prompt, puis seulement : `spec.md` (FR-015 à FR-028, FR-033,
NFR-011, NFR-012, NFR-014), `research.md` **R-30** en entier (surtout R-30.1, R-30.3, R-30.4,
R-30.7, R-30.11, R-30.13), `contracts/batches.md` § « Traitement d'une opération »,
`contracts/compliance.md` (tout), `contracts/interfaces.md` § 4, § 5, § 6, § 8, § 9, § 10,
`docs/sync_protocol.md` §7 (conflits, temps), `kitty-specs/.../data-model.md` (`offline_op_result`,
`offline_batch_retry`). Lis aussi le code des lots déjà fusionnés : `offline/rules/*` (WP17),
`offline/batches/*` (WP18, appelant), `offline/anomalies/anomaly-writer.ts` et
`payments/device-seq-registry.ts` (WP16). Priorité des sources : SPECIFICATION §0.3 ; contradiction
signalée, jamais tranchée en silence. Les `.sql` générés ne bougent pas.

## Objective

Écrire `OfflineOperationProcessor.process(ctx, op)` : le traitement d'UNE opération d'un lot, dans sa
propre transaction, du registre jusqu'au résultat mémorisé. Il applique l'ordre de `batches.md`
(registre, doublons, opérations sans effet, espèces rejetées, conformité, période, horloge, passage,
conflit, écriture, `CL007`, résultat). Il retouche le moteur d'écritures pour couvrir une part et en
reporter une autre au compte d'attente. La transaction 22 du scénario sort identique, au centime.

## Périmètre et arbitrages

- Dans le lot : tout `offline/processing/`, les retouches du moteur (`coveredCap`, `shortfall`) et de
  `TapService` (`registerOffline`), les tests d'intégration du processeur.
- Hors lot : la boucle sur les opérations, le pool de verrous, `open_offline_batch`,
  `complete_offline_batch` (WP18) ; les règles pures (WP17) ; la levée de trou et l'import (WP20).
  Le processeur ne lit ni ne change le statut du lot : WP18 le relit avant chaque appel.
- **Interface figée** (`interfaces.md` § 8) : `process(ctx: BatchContext, op: ParsedOperation):
  Promise<OperationResult>`. L'objet ouvre lui-même sa transaction (`TenantTx.run`, une par appel,
  exemple `media/taps/tap.service.ts:156`). Types importés de `offline/batches/batch.types.ts`
  (WP18, `interfaces.md` § 8) : ne les redéclare pas ; un champ manquant se signale au rapport.
  `OperationResult` = `OfflineOperationResult` régénéré par WP01 (`packages/contracts/src`).
- **Décision du porteur** : `TOPUP_CASH` d'un lot est rejeté PAR OPÉRATION (`REJECTED`,
  `OFFLINE_NOT_ALLOWED`), rien d'écrit (ni portefeuille ni caisse), anomalie
  `NON_COMPLIANT_OPERATION` portant le montant, le reste du lot continue. La garde de caisse
  n'est pas touchée (R-02, FR-028).
- **Décision du porteur** (R-30.11, ADR-139) : le quatrième `CL007` rend `REJECTED
  INSUFFICIENT_FUNDS_RETRY`, `retryable: true`, RIEN au registre, mais la trace `RETRY` par
  `record_offline_retry` dans la même transaction. Sans cette trace, la clôture du lot refuse.
- **R-30.1** : `CONFIRMED` n'exempte de conformité que si la transaction en ligne existe au journal
  (clé `<série>:<numéro>` ou `online_transaction_id` du même terminal). Sinon
  `ONLINE_CONFIRMED_MISSING` PUIS conformité complète. La période s'applique toujours.
- **R-30.3** : `recorded_at` = `offline_batch.received_at` du lot (`ctx`), pour toutes ses opérations.
- Canal `IMPORT` (appelé par WP20) : `ctx.receivedVia` vaut `'IMPORT'` (`importId` posé) ; le terminal est alors
  `REVOKED` (accepté : pas d'`assert_device_active`), `recorded_at` = heure d'approbation, valideur =
  approbateur. Une opération datée après `device_revoked_at` : `REJECTED OFFLINE_NOT_ALLOWED`.
- Routes en ligne (`payments.service.ts`, `reversal.service.ts`) : non modifiées ici (WP16 a déjà
  repris `CLOCK_SKEW`). `registerEmbedded` garde son comportement exact (ses tests restent verts).

## Subtasks

### T077 — Registre, doublons, opérations sans effet, espèces rejetées, `CONFIRMED`

- **Fichier** : `offline-operation.processor.ts`. Première instruction : prendre le terminal `FOR
  UPDATE` (même requête que `payments/payments.service.ts:230-246`, `lockTerminal`), puis le reste,
  dans l'ordre de verrous du chemin en ligne : terminal, bracelet (`register_tap`), portefeuille.
  Jamais l'inverse (interblocage avec les routes en ligne).
- **Clé** : `deviceKey(serial, op.seq)` (`idempotency/device-key.ts`, WP16). **Empreinte** :
  `contentSha256(chainedContent(op.raw))` : mêmes octets que le chemin en ligne.
- **Registre** : `registry.lookup(client, deviceId, seq)` AVANT toute écriture (sous le verrou).
  Ligne présente, même empreinte : rendre le résultat mémorisé (`offline_op_results`, relu par
  `ctx.batchId`) ; s'il manque (opération faite en ligne, passerelle), le reconstruire du registre
  (`DUPLICATE` + `transaction_id`, effet `LEDGER_WRITTEN`). Autre empreinte (`CL002` de `record`) :
  `REJECTED IDEMPOTENCY_KEY_REUSED` + anomalie `IDEMPOTENCY_CONFLICT`, dans une transaction à part
  qui est validée ; la première ligne du registre fait foi, rien d'autre n'est écrit.
- **Doublon au journal** : clé déjà au journal (`readExisting`,
  `ledger/ledger-engine.service.ts:442-455`) mais pas au registre : `record(..., 'DUPLICATE',
  transactionId d'origine)`, effet `LEDGER_WRITTEN`, aucune écriture.
- **`VOID`** : registre `VOID`, résultat `ACCEPTED`/`NONE` ; si la clé existe au journal :
  `DUPLICATE` + anomalie `VOID_CONFLICT`. **`ONLINE_REF`** non exécutée : registre `VOID`, raison
  `ONLINE_NOT_EXECUTED`, `ACCEPTED`/`NONE`. **`ONLINE_REF` `CONFIRMED`** : voir R-30.1 ci-dessus.
- **`TOPUP_CASH`** : aucun appel au moteur ni à `register_tap`. Registre `REJECTED`
  (`OFFLINE_NOT_ALLOWED`), anomalie `NON_COMPLIANT_OPERATION` avec `amount = op.amount` et
  `lossBearer(provided_by)`. Le résultat dit `effect: NONE`.
- **Critère** : rejeu d'un lot entier = mêmes résultats, aucune seconde écriture ; deux fois la même
  clé avec deux contenus : une seule transaction au journal.

### T078 — Conformité, période, anomalies

- **Fichier** : `compliance-input.reader.ts` : construit `ComplianceInput` (type de WP17) par les
  fonctions de base, sans logique de règle (les règles sont pures, WP17). Lectures :
  `device_status_at` et `device_revoked_at`, `offline_config_in_force(device, config_id, at, tol)`,
  `offline_snapshot_meta(ledger, version, device)`, `offline_snapshot_ack_floor(device, at - tol)`,
  `offline_media_state_at(ledger, token_hash, version)`, `offline_device_exposure(device, media, seq,
  reference, tol)`, `assert_vendor_session_at` (`CL032` devient le détail `VENDOR_SESSION`), devise du
  portefeuille, `pack_verified` du corps, cible d'annulation. Heure : `resolveOfflineTime(...)` (WP17).
- **Ordre** (`compliance.md` § Conformité) : premier échec en `reject_reason`, les autres dans
  `detail`. Refus : `REJECTED`, rien d'écrit, registre `REJECTED` avec la raison, anomalie
  `NON_COMPLIANT_OPERATION` (montant, `lossBearer(provided_by)`).
- **Période** (toute opération, `CONFIRMED` comprise) : `checkPeriod` ; refus `REJECTED` + anomalie
  `PERIOD_CLOSED_OPERATION` ou `LATE_OFFLINE_SYNC`. Lire `ledger.locked_until`, statut du grand livre
  et de l'événement sous le même contexte que le portefeuille.
- **Horloge** : `skew` non `NONE` : anomalie `CLOCK_SKEW` (via `openAnomaly`, montant 0), original
  dans `metadata.device_occurred_at`. Inversions de dates du lot : `detectInversions` est calculé
  par WP18 sur le lot ; ici seulement l'ouverture de `CLOCK_SKEW` pour le numéro cité par `ctx`.
- **Exposition** : R-30.3 ; le cumul vient de `offline_device_exposure`, jamais d'une somme en
  mémoire. Test : lot de 500 ventes datées `réception + 119 s`, plafond par terminal tenu.
- **Critère** : un test par raison de rejet (dix), et un cas `CONFIRMED` introuvable avec les deux
  anomalies.

### T079 — `registerOffline`, table de conflit, moteur, `OFFLINE_SHORTFALL`, `consume_tap`

- **`media/taps/tap.service.ts`** : ajouter `registerOffline(client, device, tap, onlineTapId:
  string | null): Promise<{result: TapResult; tapId: string | null}>`. Appelle `register_tap(...,
  'OFFLINE', NULL, onlineTapId, signature)` (`schema_grand_livre_cashless.sql:964-966` : `p_mode`,
  `p_tx`, `p_online_tap`, `p_signature`). Pas de `assert_device_active` (le terminal peut être
  `SUSPENDED` : ses lots sont traités ; son statut daté est jugé par la conformité). Ne lève jamais
  sur un résultat non `OK` : l'appelant applique la table de conflit.
- **Table de conflit** : `conflictOutcome(...)` (WP17) avec `blockTime` de `offline_block_time(media,
  wallet, before)` (`'-infinity'` = `'UNKNOWN'`). Rien ne se code en dur ici.
  `REJECT` : `REJECTED MEDIA_NOT_IN_SNAPSHOT` ou `MEDIA_WRONG_EVENT`, anomalie non conforme.
  `WRITE` : `covered` et `shortfall`. Pas d'`assert_wallet_payable` : un portefeuille bloqué
  donne un manque entier (`WALLET_BLOCKED`), pas un refus.
- **Moteur** (`ledger/types.ts`, `builders/festival/purchase.ts`, `money/spend.ts`,
  `ledger-engine.service.ts`) : `PurchasePayload.coveredCap?: bigint` ; `spendSplit` reçoit
  `coveredCap` (mode `OFFLINE` seulement : `covered = min(amount, soldes, coveredCap)`, jamais
  négatif, jamais de plafond en `ONLINE`) ; `EngineResult.shortfall?: bigint` rempli pour une vente
  `OFFLINE_SYNC` (somme des lignes `SUSPENSE`, `ledger-engine.service.ts:104-170`). Aucun
  comportement en ligne ne change (suites `engine` et `builders` vertes sans retouche).
  `coveredCap` entre dans l'empreinte de commande (`commandFingerprint`) : vérifie-le.
- **Écriture** (`offline-sale.writer.ts`) : `engine.execute` en `OFFLINE_SYNC`, clé = `deviceKey`,
  `occurredAt` = heure corrigée, `metadata` avec `device_occurred_at`, `vendor_session_id`, `batch_id`.
  Puis lignes (`record_sale_lines`), attribution datée (T080), `consume_tap(tapId, tx)`
  (`tap.service.ts:71`), `openAnomaly('OFFLINE_SHORTFALL')` si `shortfall > 0n` (montant, transaction,
  `lossBearer`), `registry.record(..., 'BATCH', tx, raison, batchId)`.
- **Critère** : la transaction 22 du scénario (`scenario_reference.json`, rejouée par
  `test/scenario/replay.spec.ts`) : `L-WAL-W04-P +6000`, `S-ATTENTE +3000`, `L-MCH-FOOD −9000`,
  `+1080`, `L-ORG-COM −915`, `L-ORG-TVA −165`. Chaque ligne de la table `compliance.md` a un test.

### T080 — Annulation hors ligne, session de vendeur datée

- **Fichier** : `offline-reversal.writer.ts`. Cible par `reverses_seq` (clé `<série>:<seq>` du MÊME
  terminal) ou `reverses_transaction_id` ; absente, d'un autre terminal ou déjà annulée : `REJECTED`
  `REVERSAL_TARGET_NOT_FOUND` ou `ALREADY_REVERSED` (conformité n° 10). Le terminal ne peut pas
  annuler la vente d'un autre.
- **Écriture** : moteur `REVERSAL`, source `OFFLINE_SYNC`, lignes opposées de la vente visée, part
  `S-ATTENTE` comprise (`builders/festival/reversal.ts` contre-passe tout, sans recalcul). Puis
  `reduce_offline_shortfall(original_tx, part_en_attente, reversal_tx)` par `AnomalyWriter`
  (`reduceShortfall`), idempotent.
- **Vendeur daté** : `record_sale_attribution_at(tx, session, canal, acteur, occurred_corrigé)`
  (WP07, signature de `record_sale_attribution` + `p_at`, modèle d'appel
  `reversals/reversal.service.ts:216`). Session absente ou expirée à cette heure : refus déjà fait
  par la conformité (n° 2), pas ici.
- **Critère** : vente avec manque puis annulation : anomalie réduite à 0, soldes revenus ; annulation
  rejouée : `DUPLICATE` ; cible d'un autre terminal : `REJECTED`, rien d'écrit.

### T081 — `CL007` : `SAVEPOINT`, trois reprises, trace `RETRY`, résultat écrit

- **But** : un solde qui bouge entre la lecture et l'écriture (`CL007`, `errors/sqlstate-map.ts:17`)
  ne perd pas la vente. Autour du seul `engine.execute` : `SAVEPOINT offline_sale` (modèle
  `topups/psp/psp-payment-processor.ts:242-316`). Sur `CL007` : `ROLLBACK TO SAVEPOINT`, relire les
  soldes, recalculer `conflictOutcome`, recommencer. Une tentative plus trois reprises ; le quatrième
  `CL007` arrête.
- **Quatrième `CL007`** : `ROLLBACK TO SAVEPOINT` ; `record_offline_retry(batch, seq, 'INSUFFICIENT_FUNDS')`
  dans cette même transaction ; AUCUN `record_device_seq` ; résultat `REJECTED`
  `INSUFFICIENT_FUNDS_RETRY`, `retryable: true`, `effect: NONE`. Le passage `register_tap` du terminal
  n'est pas consommé. La trace est close par WP05 quand le numéro reçoit un résultat final.
- **Résultat** : à la fin de chaque issue (écrite, rejetée, doublon, réessayable),
  `record_offline_op_result(batch, seq, jsonb)` dans la même transaction que l'écriture : sérialisé
  par JCS (`canonicalize`), identique octet pour octet au rejeu ; une forme différente au rejeu est
  une erreur de programmation. `COMMIT` ensuite. Tout ou rien (NFR-011).
- **Autres erreurs SQL** : celles qui sont des refus métier connus deviennent `REJECTED` avec un
  code stable ; toute autre remonte (WP18 gère la reprise, jamais un résultat inventé).
- **Critère** : test de concurrence : une dépense concurrente fait échouer 1 à 3 fois, la vente passe ;
  quatre fois, trace `RETRY` présente, registre sans ligne, passage non consommé.

### T082 — Tests d'intégration du processeur

- `processing.spec.ts` : registre et doublons (T077), conformité et période (T078), écriture et
  annulation (T079, T080), résultat écrit et rejeu. `processing-conflicts.spec.ts` : chaque ligne
  de la table de conflit, `blockTime` inconnu, blocage avant et après, copie, UID, signature,
  portefeuille bloqué, transaction 22. `processing-retry.spec.ts` : `CL007` (T081).
- `offline-spend.spec.ts` (unitaire) : `coveredCap` borne la part couverte, zéro, plus grand que le
  montant, jamais en `ONLINE` ; reste `uncovered = amount - covered`.
- Utilise `TestTerminal` (WP18) pour fabriquer les lots ; base de lot `cashless_wp19`.

## Sécurité

- Écart qui affaiblit la sécurité : au porteur AVANT de coder (règle 1). Cas probables ici : un
  `SELECT` direct dont `cashless_app` n'a pas le droit (passer par la fonction de WP06/WP07 ou
  signaler) ; un `INSERT INTO anomaly` direct ; un contrôle de conformité sauté pour faire passer un
  test. Aucun droit demandé en silence.
- Points sensibles : l'exposition (R-30.3) est le plafond d'argent du terminal ; `CONFIRMED`
  introuvable ne doit JAMAIS exempter ; `TOPUP_CASH` ne doit toucher ni portefeuille ni caisse
  (NFR-014) ; le terminal ne cite que SES numéros et SES ventes ; un seul `register_tap` par
  opération (une lecture ne sert qu'à une écriture, `CL022`).
- Aucun secret n'entre dans `detail` ni dans les anomalies (pas de mot de passe de bracelet, de
  jeton, de signature).
- Fichiers à faire relire par une personne : aucun ; mais la retouche du moteur
  (`ledger-engine.service.ts`, `spend.ts`) touche tout l'argent : le relecteur lit chaque ligne
  modifiée.

## Tests

- Commandes : `npm test -w @cashless/api -- unit/ledger unit/builders integration/engine
  integration/offline/processing`. En plus, non-régression : `integration/payments`,
  `integration/reversals`, `integration/media`, `scenario`. Le lot ne lance pas Jest sur
  `cashless_test` : base de lot `cashless_wp19` (fiche d'implémentation) ; l'orchestrateur relance
  en série.
- Chaque test d'argent compare des montants `bigint` exacts, jamais des `Number`.

## Ce que le relecteur doit casser

1. Rejouer deux fois le même lot et un lot dont une opération change de contenu : un seul débit,
   `IDEMPOTENCY_KEY_REUSED` + `IDEMPOTENCY_CONFLICT` pour l'intrus.
2. `ONLINE_REF` `CONFIRMED` dont la transaction n'existe pas : conformité complète appliquée, une
   violation (montant au-dessus du plafond) rejette quand même.
3. `TOPUP_CASH` de 50 000 dans un lot de 3 : rejeté, les deux autres passent, aucun mouvement de
   caisse, une anomalie de 50 000.
4. Vente à `occurred_at` −100 s du blocage du bracelet : couverte ; à +100 s : manque entier ;
   `blockTime` inconnu : manque entier.
5. Quatre `CL007` d'affilée : registre sans ligne, trace `RETRY`, `retryable: true` ; la clôture du
   lot sans trace est refusée par la base.
6. Annulation d'une vente d'un autre terminal, ou deux fois : `REJECTED`, rien d'écrit.
7. Deux lots concurrents de deux terminaux sur le même portefeuille : pas d'interblocage, aucun solde
   négatif.
8. Coupe le processus après l'écriture, avant le résultat : au rejeu, ni double écriture ni résultat
   manquant (tout ou rien).

## Definition of Done

- [ ] Ordre de `batches.md` respecté ; une transaction par opération ; résultat écrit dedans.
- [ ] `TOPUP_CASH` rejeté par opération ; `CONFIRMED` selon R-30.1 ; trace `RETRY` au quatrième `CL007`.
- [ ] Moteur retouché (`coveredCap`, `shortfall`) sans changer un test en ligne ; transaction 22 exacte.
- [ ] Une anomalie par cause, par `AnomalyWriter` seulement ; aucun `INSERT INTO anomaly`.
- [ ] Suites d'intégration et unitaires écrites, non-régression verte sur la base de lot.
- [ ] Rapport : types déclarés ici ou chez WP18, droits manquants, contradictions, retouches hors carte.

## Branch Strategy

Planification et fusion sur `feat/hors-ligne-snapshots-lots`. Dépendances : WP06, WP07, WP16, WP17,
WP18. Worktree attribué par lane (`lanes.json`). Commande : `spec-kitty agent action implement WP19
--agent claude --mission hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
