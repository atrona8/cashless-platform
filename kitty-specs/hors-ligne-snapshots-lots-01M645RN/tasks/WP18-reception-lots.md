---
work_package_id: WP18
title: "Réception des lots : contrôleur, contrôles d'entrée, boucle, reprise, lecture, terminal de test"
dependencies: [WP01, WP05, WP08, WP16]
requirement_refs:
- FR-013
- FR-014
- FR-029
- FR-030
- NFR-013
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots.
  During /spec-kitty.implement this WP may branch from a dependency-specific base, but
  completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human
  explicitly redirects the landing branch.
subtasks: [T072, T073, T074, T075, T076]
phase: Phase 3 - API
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/offline/batches/
create_intent: [apps/api/src/offline/batches/offline-batches.module.ts, apps/api/src/offline/batches/offline-batches.controller.ts, apps/api/src/offline/batches/offline-batches.service.ts, apps/api/src/offline/batches/batch.types.ts, apps/api/src/offline/batches/raw-json.ts, apps/api/src/offline/batches/batch-intake.ts, apps/api/src/offline/batches/batch-chain.ts, apps/api/src/offline/batches/batch-lock-pool.ts, apps/api/src/offline/batches/batch-runner.ts, apps/api/test/integration/offline/batches-raw-json.spec.ts, apps/api/test/integration/offline/batches-intake.spec.ts, apps/api/test/integration/offline/batches-run.spec.ts, apps/api/test/integration/offline/batches-resume.spec.ts, apps/api/test/integration/offline/batches-get.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/offline/batches/**, apps/api/test/support/test-terminal.ts, apps/api/test/integration/offline/batches*.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP18 – Réception des lots

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite la fiche de contexte
d'implémentation de l'orchestrateur, ce prompt, puis seulement : `spec.md` (FR-013 à FR-016, FR-029,
FR-030, FR-043, NFR-001, NFR-002, NFR-011, NFR-013), `research.md` R-10, R-11, R-14 et **R-30.7
(fait foi)**, `contracts/batches.md` (sections « contrôles d'entrée », « Reprise et lecture », «
Réponse »), `contracts/interfaces.md` § 4 (`open_offline_batch`, `complete_offline_batch`,
`offline_batch_state`, `offline_op_results`), § 8 (tableau des éléments partagés, configuration) et
§ 10, `docs/sync_protocol.md` §3.3 et §6. Priorité des sources : SPECIFICATION §0.3 ; contradiction
signalée (voir « Périmètre »). Les `.sql` générés ne bougent pas.

## Objective

Recevoir un lot signé du terminal, le refuser proprement ou l'ouvrir, puis le dérouler opération par
opération en appelant le processeur de WP19 par l'interface figée, reprendre un lot interrompu sans
rien écrire deux fois, le clore, et rendre son résultat. Ce lot ne calcule aucune règle d'argent :
il garde la porte, tient les verrous, enchaîne les transactions et fabrique le terminal de test qui
sert à tout prouver. Aucune recharge espèces hors ligne : `TOPUP_CASH` entre, le processeur le
rejette.

## Périmètre et arbitrages

- Dans le lot : `POST /offline-batches` (`submitOfflineBatch`) et `GET /offline-batches/{batch_id}`
  (`getOfflineBatchResult`), module `offline/batches/`, lecture JSON brute, contrôles 1 à 9 de
  `batches.md`, appel de `open_offline_batch`, boucle et reprise, `complete_offline_batch`, audit,
  et `TestTerminal` (signature de lot, chaîne, constructeur de journal).
- Hors lot : le traitement d'une opération (WP19, `offline-operation.processor.ts`) ; `waiveSeqGap`,
  import de journal (WP20) ; les fonctions SQL (WP05, WP06) ; `chainedContent`, `deviceKey`,
  `record` (WP16, que tu appelles sans les modifier).
- **Interface du processeur** (figée, `interfaces.md` § 8) : `process(ctx: BatchContext, op:
  ParsedOperation): Promise<OperationResult>`. Les types `BatchContext`, `ParsedOperation`,
  `OperationResult` : forme figée en `interfaces.md` § 8 (« Types du processeur ») ; tu les
  écris dans `batch.types.ts` (WP19 et WP20 les importent). `receivedVia` vaut `'DEVICE'` ici ;
  `'IMPORT'` (avec `importId`) est posé par WP20. `ParsedOperation` : `seq: bigint`,
  `raw` (objet reçu, intact), `type`, `contentSha256: Buffer`. `OperationResult` : forme
  `OfflineOperationResult` du contrat. Signale dans le rapport tout champ que WP19 réclame en plus
  (ne le devine pas). Le processeur est injecté par un jeton (`OFFLINE_OPERATION_PROCESSOR`) ; sans
  WP19, un faux de test le remplace, JAMAIS en production (règle 2 : un module qui trouve le faux
  hors test refuse de démarrer, test à l'appui).
- **Ordre des contrôles** : `batches.md` place l'époque (5) avant la signature (6) ; R-10 place la
  signature avant la continuité et l'époque dans le contrôle 3. Appliqué : `batches.md` (contrat,
  plus récent). Signalé. De même `complete_offline_batch` est « migration 0045 » dans R-11 et 0046
  dans `interfaces.md` § 4 : sans conséquence pour le code, signalé.
- **Corps JSON** : la limite par défaut d'Express (100 ko) refuse un lot de 500 opérations avant ton
  contrôleur. Décision de l'orchestrateur (30/10/2026) : la limite **globale reste 100 ko** ; seule la
  route `POST /offline-batches` lit son corps brut avec sa propre limite (1 048 576 octets, contrôle 1 :
  `413 BATCH_TOO_LARGE`), montée avant l'analyseur global dans `processes/bootstrap.ts` (WP09) et
  `test/support/app.ts`. Retouche hors carte, une ligne de rapport. Test : une autre route refuse
  toujours un corps de 200 ko.
- Verrous : `db/session-lock.ts` (`SessionLock.tryAcquire(namespace, id)`, `LOCK_BUSY`) est le seul
  moyen d'avoir un verrou consultatif de session (seul `db/` touche `pg`, test d'architecture). Tu
  l'utilises avec un pool DÉDIÉ : fabrique `new SessionLock({...config, poolSize:
  config.offlineBatchPoolSize})` (clé `OFFLINE_BATCH_POOL_SIZE`, 20, retouche hors carte de
  `config.ts`). Sa connexion s'attend 10 s : tu bornes l'attente à 1 s (`Promise.race`), et une
  poignée obtenue après coup est relâchée aussitôt.

## Subtasks

### T072 — Contrôleur `POST /offline-batches`, corps brut, `raw-json.ts`

- **Fichiers** : `offline-batches.controller.ts`, `offline-batches.module.ts`, `raw-json.ts`.
  `@Controller('offline-batches')`, `@DeviceAuth({ allowSuspended: true })` (un terminal suspendu
  envoie encore ses lots ; `REVOKED` est refusé par la garde, `403 DEVICE_REVOKED`, modèle
  `heartbeat.controller.ts:28`). PAS de `@Idempotent` : le rejeu se lit dans l'état du lot (R-10,
  R-11), pas dans la table d'idempotence.
- **Contrôle 1** : taille de `req.rawBody` (`rawBody: true` déjà posé, `bootstrap.ts:108`) ; `>
  1_048_576` octets -> `413 BATCH_TOO_LARGE` AVANT tout `JSON.parse`.
- **Contrôle 2** : `parseWithSafeIntegers(text: string, seqFields: string[]): unknown`
  (`interfaces.md` § 8) : `JSON.parse` avec `reviver` et `context.source` (Node 22) ; pour une clé
  de `seqFields` (`seq`, `seq_from`, `seq_to`, `reverses_seq`), un littéral entier `> 2^53−1` ->
  `ProblemException ('VALIDATION_FAILED', {status: 400, detail})` avec un pointeur JSON
  (`/operations/3/seq`), jamais la valeur. Fractionnaire, exposant (`1e3`) ou négatif sur ces champs
  : même refus. JSON invalide : `400`.
- **Module** : `OfflineBatchesModule` (importe `DbModule`, `AuditModule`, le module des paiements
  pour le registre ; fournit `OFFLINE_OPERATION_PROCESSOR`). `app.module.ts` : import du module
  (retouche hors carte).
- **Critère** : `batches-raw-json.spec.ts` (sans base) : 9007199254740991 passe, 9007199254740992
  refusé, 17 chiffres refusé avec pointeur, `reverses_seq` aussi ; lot de 1 048 577 octets -> `413`.

### T073 — Contrôles d'entrée 3 à 9 (`batch-intake.ts`, `batch-chain.ts`)

- Dans l'ordre exact de `batches.md` (contrôles 3 à 9) ; le premier refus gagne. Aucun accès base
  avant d'avoir fini ceux qui n'en ont pas besoin (3, 7 sauf lecture du terminal).
  - **3** schéma : 1 à 500 opérations (`413` au-delà de 500, `400` vide), `count = |ops| = seq_to −
    seq_from + 1`, type dans `PURCHASE, REVERSAL, TOPUP_CASH, VOID, ONLINE_REF` (`400` sinon).
  - **4** `Idempotency-Key` = `header.batch_id` ; `header.device_serial` = série du jeton ;
    `header.ledger_id` = grand livre de l'événement du terminal ; `X-Authority-Epoch` =
    `header.authority_epoch` (`400`).
  - **5** époque du lot `<` époque courante -> `409 STALE_AUTHORITY_EPOCH` (avec l'époque courante,
    comme `assertAuthorityEpoch`, `payments/operation-time.ts:33`) ; supérieure -> `400`.
  - **6** signature ECDSA P-256 DER de `JCS(header)` (bibliothèque `canonicalize`, comme
    `device-seq-registry.ts:22`) par `device.public_key` (SPKI, `createPublicKey`, modèle
    `refresh.service.ts:121`) -> `400 BATCH_SIGNATURE_INVALID` + audit `OFFLINE_BATCH_REFUSED`. DER
    strict : une signature P1363 (64 octets) est refusée.
  - **7** numéros continus d'une opération à la suivante, premier = `seq_from` -> `400
    SEQ_OUT_OF_ORDER`.
  - **8** (`batch-chain.ts`) : pour chaque opération, `content_sha256` recalculé par `contentSha256
    (chainedContent(op))` (WP16) ; `chain_hash(n) = SHA-256(chain_hash(n−1) ‖ content_sha256(n))`,
    départ `prev_chain_hash` ; chaque `chain_hash` déclaré par l'opération et `last_chain_hash`
    doivent égaler le recalcul. Écart -> lot `REJECTED CHAIN_BROKEN`, `409 CHAIN_BROKEN`, anomalie
    `CHAIN_BROKEN`. Pour que la ligne du lot et l'anomalie existent, passe QUAND MÊME les empreintes
    RECALCULÉES à `open_offline_batch` (qui constate l'écart, écrit le lot et l'anomalie,
    `schema…sql:2238`) puis réponds `409`. Ne persiste rien par ailleurs.
  - **9** autorité de débit `EDGE` -> `409 DEBIT_AUTHORITY_EDGE`, `MOVING` -> `409
    DEBIT_AUTHORITY_MOVING`.
- **Cas limites** : `TOPUP_CASH` accepté ici ; en-tête `X-Authority-Epoch` absent -> `422` comme les
  autres routes de débit ; `occurred_at` invalide -> `400` (pas `500`) ; un contrôle qui lève ne
  laisse aucune ligne.
- **Critère** : `batches-intake.spec.ts` : un cas par contrôle, dans l'ordre (lot cumulant deux
  défauts : le premier du tableau est rapporté) ; empreinte altérée -> `409 CHAIN_BROKEN`, ligne
  `REJECTED`, anomalie.

### T074 — Pool, `open_offline_batch`, boucle sur le processeur, reprise, clôture
(`batch-runner.ts`)

- **Contrôle 10** : `open_offline_batch` (signature de `schema…sql:2183`) dans une transaction
  courte, avec `p_via = 'CENTRAL'`. `CL021` -> `409 SEQ_OUT_OF_RANGE` ; `CL010` -> `409
  BATCH_IN_PROGRESS` + `Retry-After: 2` ; `CL011` -> `413` ; `CL002` (même `batch_id`, autre
  contenu) -> `409` ; lot rendu `REJECTED CHAIN_BROKEN` -> `409 CHAIN_BROKEN`. Le lot ouvert expose
  `missing_seqs` (trous : traité quand même, FR-031).
- **Verrou** (R-30.7) : `tryAcquire('offline-batch', batchId)` sur le pool dédié AVANT d'ouvrir ;
  `LOCK_BUSY` -> `409 BATCH_IN_PROGRESS` + `Retry-After: 2` ; pool plein après 1 s -> `503
  SERVICE_UNAVAILABLE` + `Retry-After: 5`, lot NON ouvert. Relâchement dans `finally`, toujours. Une
  seule poignée par lot.
- **Boucle** : pour chaque opération dans l'ordre des numéros : relis le statut du lot
  (`offline_batch_state`) ; `ABANDONED` -> arrêt, résultats déjà inscrits rendus, `abandoned: true`.
  Sinon une opération = un appel de `processor.process(ctx, op)` (WP19 ouvre sa propre transaction
  `TenantTx`, ne la partage pas). Une exception inattendue du processeur arrête le lot (statut
  `PROCESSING`, `500`) : rien n'est inventé.
- **Reprise** : renvoi d'un `batch_id` : lot `COMPLETED` -> `200`, résultats mémorisés
  (`offline_op_results`), `Idempotency-Replayed: true` ; lot `PROCESSING` et verrou obtenu ->
  reprise à la première opération sans ligne `offline_op_result` ; verrou tenu -> `409
  BATCH_IN_PROGRESS`. Lot `REJECTED CHAIN_BROKEN` rejoué : même `409`. Mêmes octets rendus que la
  première réponse (NFR-002) : les résultats viennent des lignes inscrites, sérialisés par JCS.
- **Clôture** : `complete_offline_batch(batch, results)` avec les résultats ; un numéro
  `INSUFFICIENT_FUNDS_RETRY` y figure avec `retryable = true` (ADR-139) ; réponse
  `OfflineBatchResult` (`batches.md` § Réponse) : `contiguous_acked_seq`, `missing_seqs`,
  `next_snapshot_version` (dernière version du grand livre + 1 si une écriture du lot n'y est pas
  encore reflétée, R-11), `abandoned`, `server_time`.
- **Critère** : `batches-run.spec.ts` (processeur factice) : 500 opérations dans l'ordre ;
  `batches-resume.spec.ts` : coupure au milieu (processeur qui lève à l'opération 250) puis renvoi :
  250 appels de plus, jamais 500, mêmes octets ; 2 envois concurrents du même lot : un seul traite ;
  pool plein -> `503`.

### T075 — `GET /offline-batches/{batch_id}`, audit

- **Lecture** (`offline-batches.service.ts`) : `offline_batch_state` + `offline_op_results` sous
  `TenantTx` ; lot du terminal authentifié seulement. `200` terminé ou abandonné (`abandoned: true`)
  ; `202` + `Retry-After: 2` en cours ; `404` neutre pour un lot inconnu OU d'un autre terminal
  (aucune distinction, aucun détail).
- **Audit** (`audit.service.ts` : `OFFLINE_BATCH_RECEIVED`, `OFFLINE_BATCH_REFUSED`, retouche hors
  carte, une ligne chacune) : une ligne par lot reçu et par refus (code, `batch_id`, terminal), sans
  donnée personnelle ni montant. Refus d'avant ouverture (400/409/413) audité aussi, dans une
  transaction à part qui ne masque pas le refus.
- **Critère** : `batches-get.spec.ts` : `200`, `202`, `404` (autre terminal), audit présent pour la
  signature invalide et la chaîne rompue.

### T076 — `TestTerminal` : `signBatch`, `chainHash`, constructeur de journal ; tests de réception

- **Fichier** : `test/support/test-terminal.ts` (existant, 611 lignes ; ajoute, ne change rien
  d'existant). `chainGenesis(deviceId)` = SHA-256(`CASHLESS/CHAIN/v1` ‖ 16 octets de l'UUID) ;
  `chainHash(prev, content)` ; `buildJournal(ops, {fromSeq, prev})` qui calcule `content_sha256` PAR
  LA BIBLIOTHÈQUE DE TEST (les vecteurs `offline-vectors/vectors.json` de WP16, pas
  `chainedContent`) ; `signBatch(header)` : ECDSA P-256 DER de `JCS(header)` avec
  `this.signing.privateKey` (`crypto.sign`, `dsaEncoding: 'der'`) ; `submitBatch(...)` qui prépare
  la requête avec `prepare` + `seqKey` inchangés.
- Options de sabotage utilisables par les autres lots : signature d'un autre en-tête, empreinte
  altérée, numéro sauté, époque périmée.
- **Critère** : un lot construit par `TestTerminal` est accepté ; la chaîne s'accorde avec
  `vectors.json`.

## Sécurité

- Écart qui affaiblit la sécurité : au porteur AVANT de coder (règle 1). Ici : retirer ou différer
  un contrôle d'entrée, accepter une signature P1363, tolérer un grand livre ou une série
  différente, partager la transaction de deux opérations, un faux processeur qui survit en
  production.
- Points sensibles : la signature n'engage que l'en-tête, donc les empreintes sont TOUJOURS
  recalculées par le serveur (contrôle 8) ; aucune valeur reçue dans un message d'erreur ; `404`
  neutre ; verrou relâché dans tous les cas ; aucune connexion `pg` hors `db/` ; un lot ne lit
  jamais le résultat d'un autre terminal.
- Fichiers à faire relire par une personne : `batch-intake.ts` (vérification de signature et de
  chaîne) ; `batch-runner.ts` (verrou, reprise, double traitement) : l'agent qui les écrit ne vaut
  pas relecture.

## Tests

- `batches-raw-json.spec.ts` (sans base), `batches-intake.spec.ts`, `batches-run.spec.ts`,
  `batches-resume.spec.ts`, `batches-get.spec.ts` (base de lot `cashless_wp18`, voir la fiche
  d'implémentation ; l'orchestrateur relance en série). Non-régression :
  `test/integration/payments`, `test/unit/architecture.spec.ts`.
- Commande : `npm test -w @cashless/api -- integration/offline/batches unit/architecture`.

## Ce que le relecteur doit casser

1. Altérer un octet de `tap` dans une opération sans toucher l'en-tête : la signature passe, le
   contrôle 8 doit refuser (`409 CHAIN_BROKEN`, ligne du lot `REJECTED`).
2. Signature IEEE P1363 (64 octets) du bon en-tête : `400 BATCH_SIGNATURE_INVALID`.
3. Numéro `9007199254740993` dans `seq_to` ou `reverses_seq` : `400` avec pointeur, aucune ligne
   écrite.
4. 100 envois concurrents du même lot : une seule exécution, les autres `409 BATCH_IN_PROGRESS` ou
   `200` rejoué ; 50 lots de 50 terminaux avec `OFFLINE_BATCH_POOL_SIZE` à 5 : `503` + `Retry-After:
   5`, pas de blocage.
5. Tuer le traitement à l'opération 250 sur 500 puis renvoyer : aucune double écriture, mêmes
   octets.
6. Lot d'un terminal lu avec le jeton d'un autre : `404`, jamais `403`.
7. Époque périmée, `EDGE`, `MOVING`, série ou grand livre différents : chacun son code, le premier
   du tableau gagne.
8. Retirer le `finally` du verrou : un lot qui lève bloque le suivant (le test doit le voir).

## Definition of Done

- [ ] Contrôles 1 à 10 dans l'ordre de `batches.md`, un test par refus.
- [ ] Boucle sur l'interface figée, reprise sans double traitement, `ABANDONED` géré, clôture par
  `complete_offline_batch`.
- [ ] Pool dédié, `503` + `Retry-After: 5`, verrou toujours relâché.
- [ ] `GET` en `200`/`202`/`404` ; audit des lots reçus et refusés.
- [ ] `TestTerminal` étendu sans casser les suites existantes.
- [ ] Rapport : retouches hors carte (`bootstrap.ts`, `app.ts`, `config.ts`, `audit.service.ts`,
  `app.module.ts`), types écrits pour WP19, contradictions d'ordre et de numéro de migration.

## Branch Strategy

Planification et fusion sur `feat/hors-ligne-snapshots-lots`. Dépendances : WP01, WP05, WP08, WP16.
Worktree attribué par lane (`lanes.json`). Commande : `spec-kitty agent action implement WP18
--agent claude --mission hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks

