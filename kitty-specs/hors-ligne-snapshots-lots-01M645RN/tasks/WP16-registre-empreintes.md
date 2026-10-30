---
work_package_id: WP16
title: Registre des numéros, empreinte des opérations, numéros sûrs, écrivain d'anomalies
dependencies: [WP06, WP08]
requirement_refs:
- FR-016
- FR-017
- FR-033
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots.
  During /spec-kitty.implement this WP may branch from a dependency-specific base, but
  completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human
  explicitly redirects the landing branch.
subtasks: [T064, T065, T066, T067]
phase: Phase 3 - API
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/payments/
create_intent: [apps/api/src/payments/chained-content.ts, apps/api/src/offline/anomalies/anomaly-writer.ts, apps/api/test/unit/payments/chained-content.spec.ts, apps/api/test/unit/idempotency/device-key-offline.spec.ts, apps/api/test/fixtures/offline-vectors/gen_vectors.py, apps/api/test/fixtures/offline-vectors/vectors.json]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/payments/chained-content.ts, apps/api/src/payments/device-seq-registry.ts, apps/api/src/payments/payments.service.ts, apps/api/src/idempotency/device-key.ts, apps/api/src/topups/cash/cash-topup.service.ts, apps/api/src/reversals/reversal.dto.ts, apps/api/src/offline/anomalies/**, apps/api/test/unit/payments/device-seq-registry.spec.ts, apps/api/test/unit/payments/chained-content.spec.ts, apps/api/test/unit/idempotency/device-key-offline.spec.ts, apps/api/test/fixtures/offline-vectors/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP16 – Registre, empreintes, numéros, anomalies

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite la fiche de contexte
d'implémentation de l'orchestrateur, ce prompt, puis seulement : `spec.md` (FR-016, FR-017, FR-033,
FR-036, NFR-001, NFR-011), `research.md` R-13, R-14, R-17 et R-30.1, `contracts/interfaces.md` § 5
(`open_offline_anomaly`, `reduce_offline_shortfall`) et § 8 (tableau des éléments partagés),
`docs/sync_protocol.md` §3.2 et §3.3 (champs chaînés, chaîne). Priorité des sources : SPECIFICATION
§0.3 ; contradiction signalée (ADR-128 : 7 champs, contre §3.3 : 11 champs, appliqué §3.3, R-13).
Les `.sql` générés ne bougent pas.

## Objective

Poser les briques que le traitement des lots (WP18, WP19) et les chemins en ligne partagent : une
seule fonction d'empreinte pour toutes les routes, un numéro d'opération que `Number` ne peut plus
arrondir, un registre qui sait enregistrer sur tous les canaux et se relire, un écrivain d'anomalies
qui passe par la fonction de la base. Les vecteurs 5b ne changent pas d'un octet.

## Périmètre et arbitrages

- Dans le lot : `chainedContent`, `deviceKey` et `MAX_DEVICE_SEQ`, `DeviceSeqRegistry.record/lookup`,
  `AnomalyWriter`, les vecteurs. Les trois fabriques d'empreinte en ligne (`purchaseContent`,
  `topupContent`, `reversalContent`) deviennent des appels de `chainedContent`.
- Hors lot : `device-config.service.ts` (lignes 243-248, `Number(...)` de la configuration) est à
  WP15 ; `waiveSeqGap` et ses chemins `{seq}` sont à WP20 ; le traitement est à WP19.
- `payment-requests/payment-request.service.ts:452,464` et `devices/enrollment/enrollment.service.ts:204`
  gardent `Number(seq)` : exact une fois `MAX_DEVICE_SEQ` abaissé à 2^53−1. Ne les touche pas ;
  signale-les dans le rapport.
- Retouche hors carte autorisée UNE FOIS, avec une ligne de rapport : `test/unit/device-route/
  device-key.spec.ts:42-46` (la borne `9223372036854775807` devient `9007199254740991`).
- Décision R-14 : `MAX_DEVICE_SEQ` est abaissé aussi sur le chemin en ligne (JCS ne représente pas
  exactement un entier plus grand). `payments-refusals.spec.ts:518` (`…808`) reste un `422`.

## Subtasks

### T064 — `chainedContent`, vecteurs de lot, vecteurs 5b inchangés

- **Fichier** : `payments/chained-content.ts`. `chainedContent(op: Record<string, unknown>):
  Record<string, unknown>` choisit les champs chaînés de §3.3 : `seq, type, occurred_at, amount,
  currency, tap, lines, reverses_seq, reverses_transaction_id, online_operation, void_reason`.
  Absents ou `undefined` : omis. Valeurs prises TELLES QUELLES (chaînes, objets `tap` et `lines`
  entiers, propriétés inconnues comprises) : aucune normalisation. Jamais un champ d'état
  (`online_status`, `online_transaction_id`, `online_tap_id`, `snapshot_version`, `config_id`,
  `local_available_before`, `clock`, `état_local`) ni `tap_id`, `customer_qr_token`, `vendor_session_id`.
- `seq` : accepté en `bigint` ou en nombre ; converti en nombre JSON seulement s'il est un entier
  sûr (`<= 2^53−1`), sinon `Error` (programmation : la couche d'entrée a déjà refusé).
- **Appels** : `purchaseContent` (`device-seq-registry.ts:51-57`, qui lit `PURCHASE_FIELDS` ligne 33),
  `topupContent` (`topups/cash/cash-topup.service.ts:74-84`) et `reversalContent`
  (`reversals/reversal.dto.ts:84-93`) construisent leur objet (type fixé par la route, `seq` de la
  clé, champs du corps tels que reçus) puis `contentSha256(chainedContent(obj))`. `contentSha256`
  reste dans `device-seq-registry.ts:39-44`.
- **Vecteurs** : `test/fixtures/offline-vectors/gen_vectors.py` (bibliothèque standard seule : `json`
  avec `sort_keys=True`, `separators=(',', ':')`, `ensure_ascii=False`, `hashlib`) écrit
  `vectors.json`. Le script n'est PAS exécuté par Jest ; ses résultats sont committés. Contenu :
  les vecteurs 5b recopiés (`device-seq-registry.spec.ts:30-36` : `VECTOR_TAP`, `VECTOR_KEYPAD`, et
  les autres du fichier), puis les nouveaux : vente de lot avec lignes, annulation par `reverses_seq`,
  annulation par `reverses_transaction_id`, `VOID` avec `void_reason`, `ONLINE_REF` avec
  `online_operation`, numéro `4294967296` et `9007199254740991`, et la chaîne : `chain_hash(0) =
  SHA-256("CASHLESS/CHAIN/v1" ‖ 16 octets de l'UUID du terminal)`, puis trois maillons
  `SHA-256(chain_hash(n−1) ‖ content_sha256(n))`. WP18 relit ces vecteurs de chaîne.
- **Critère** : les anciens vecteurs 5b passent sans modification de valeur ; les nouveaux sont
  recalculés par Python, jamais par le code testé ; un champ d'état ajouté à l'objet ne change pas
  l'empreinte (test).

### T065 — `deviceKey`, `MAX_DEVICE_SEQ = 2^53−1`, `Number(seq)` retirés

- **`idempotency/device-key.ts`** : `export const MAX_DEVICE_SEQ = 2n ** 53n - 1n` (ligne 14) ;
  `deviceKey(serial: string, seq: bigint): string` = `serial` + `:` + `seq` en décimal complété à
  gauche de zéros jusqu'à 4 chiffres, jamais tronqué (`87` -> `0087`, `12345` -> `12345`). `seq < 1n`
  ou `> MAX_DEVICE_SEQ` : `Error`. `parseDeviceKey` (lignes 20-29) refuse `> MAX_DEVICE_SEQ` en
  `422 VALIDATION_FAILED` comme avant, et reste l'inverse exact de `deviceKey` (test aller-retour).
- **`Number(seq)`** : `device-seq-registry.ts:60-62` (`seqNumber`) et les trois fabriques passent
  par `chainedContent` (point unique de conversion contrôlée). Plus aucun `Number(seq)` dans les cinq
  fichiers de ton lot (test : lecture du texte des fichiers, motif `Number\((args\.)?seq`).
- **Cas limites** : `seq` 4 chiffres exactement (`1000`) ; `serial` contenant `:` (la regex
  `^(.+):([0-9]{4,})$` du fichier ligne 12 prend le DERNIER `:`) ; `0` et négatifs refusés.
- **Critère** : `device-key-offline.spec.ts` : aller-retour sur 0087, 12345, 2^53−1 ; refus de 2^53.

### T066 — `DeviceSeqRegistry.record` et `lookup`

- **But** : un registre utilisable par les lots (canaux `BATCH` et `IMPORT`-via-`BATCH`, voir ci-dessous)
  sans casser `accept`/`reject` (`device-seq-registry.ts:78-117`, utilisés par `payments.service.ts:
  217-222,309-314` et les autres routes en ligne).
- **`record(client, {deviceId, seq: bigint, content: Buffer, outcome, reason?, transactionId?,
  batchId?}, channel): Promise<RegistryRow>`** : appelle `record_device_seq($1..$8)`
  (`schema_grand_livre_cashless.sql:2040-2041` : `p_device, p_seq, p_content, p_outcome, p_channel,
  p_tx, p_reason, p_batch`) avec `seq` en TEXTE. `RegistryRow = {replayed, outcome, reason,
  transactionId, contiguousAckedSeq}` (`contiguousAckedSeq` en `bigint`). Ne lève PAS quand
  `replayed` est vrai (contrairement à `accept`, lignes 83-92) : l'appelant décide. `CL002` (autre
  contenu) et `CL021` (hors plage) remontent tels quels.
- **`lookup(client, deviceId, seq): Promise<RegistryRow | null>`** : lecture du registre et de
  `contiguous_acked_seq` du terminal, sans effet, pour que le processeur (WP19) lise AVANT d'écrire,
  sous le verrou du terminal. Passe par une fonction de lecture existante ou par `SELECT` sous RLS si
  `cashless_app` a ce droit ; sinon signale-le (ne demande pas un droit en silence : règle 1).
- **Canal** : `SeqChannel` (ligne 30) reste `'ONLINE' | 'BATCH' | 'EDGE'` ; un import utilise `BATCH`
  avec `batchId` du lot importé (`offline_batch.received_via = 'IMPORT'` le distingue). Si la base
  veut un canal `IMPORT`, c'est une contradiction à signaler, pas à coder.
- `accept` et `reject` deviennent de fines enveloppes de `record` (mêmes effets, mêmes erreurs) ;
  leurs tests existants restent verts sans changement.
- **Critère** : tests à faux client (`TxClient` qui capture le SQL et les paramètres) : `seq` passé
  en texte, ordre des paramètres, `replayed` rendu sans exception, `lookup` absent -> `null`.

### T067 — `AnomalyWriter` ; `CLOCK_SKEW` en ligne par la fonction

- **Fichier** : `offline/anomalies/anomaly-writer.ts`. Exporte la fonction `openAnomaly(client,
  input)` ET la classe `@Injectable() AnomalyWriter` qui la délègue (PaymentsService l'appelle comme
  fonction : pas de retouche de `payments.module.ts`, qui n'est pas dans ta carte).
  `AnomalyInput = {ledgerId, kind, deviceId?, mediaId?, seq?: bigint, transactionId?, amount: bigint
  (défaut 0n), lossBearer?, detail?, batchId?}`. `open` appelle `open_offline_anomaly(p_ledger, p_kind,
  p_device, p_media, p_seq, p_tx, p_amount, p_loss_bearer, p_detail, p_batch)` (`interfaces.md` § 5),
  rend l'identifiant `bigint`, idempotent par la base ; `seq` et `amount` en texte. `kind` : union
  fermée des onze types de § 5 (l'API n'en invente pas). `reduceShortfall(client, originalTx, amount,
  reversalTx)` appelle `reduce_offline_shortfall`.
- **`payments.service.ts:185-190`** : l'`INSERT INTO anomaly … 'CLOCK_SKEW'` direct est remplacé par
  `openAnomaly(client, {ledgerId: terminal.ledger_id, kind: 'CLOCK_SKEW', deviceId, transactionId,
  amount: 0n})`. Même moment (après le moteur, avant les lignes), même transaction, même effet
  observable. C'est ce qui permet à WP08 de retirer l'`INSERT` direct à `cashless_app` (R-17).
- **Critère** : la suite existante `test/integration/payments/` reste verte (cas `CLOCK_SKEW`) ;
  test unitaire de l'écrivain à faux client.

## Sécurité

- Écart qui affaiblit la sécurité : au porteur AVANT de coder (règle 1). Ici : ne demande aucun droit
  `SELECT`/`EXECUTE` nouveau en silence ; si `lookup` en a besoin, dis-le dans le rapport.
- Points sensibles : l'empreinte est le contrôle d'idempotence de tout l'argent hors ligne — un champ
  d'état dedans casserait la reconnaissance des doublons, un champ chaîné omis laisserait passer un
  numéro falsifié (sonde FR-036 de WP21) ; aucune conversion `Number` d'un numéro non borné ;
  l'écrivain d'anomalies n'accepte ni `INSERT` direct ni type libre.
- Fichiers à faire relire par une personne : aucun ; mais `chained-content.ts` et les vecteurs sont
  la référence de toute la mission : le relecteur recalcule un vecteur à la main.

## Tests

- `chained-content.spec.ts` (vecteurs `vectors.json`, champs d'état ignorés, `seq` > 2^53 refusé),
  `device-seq-registry.spec.ts` (étendu : vecteurs 5b intacts, `record`, `lookup`),
  `device-key-offline.spec.ts`. Pas de base requise ; en plus, lance `test/integration/payments` et
  `reversals`, `topups` pour la non-régression (base de lot `cashless_wp16`).
- Commande : `npm test -w @cashless/api -- unit/payments unit/idempotency unit/device-route`.

## Ce que le relecteur doit casser

1. Ajouter `snapshot_version` ou `config_id` à une opération : l'empreinte doit rester la même.
2. Une vente de lot et la même vente en ligne (mêmes champs chaînés) : même empreinte au bit près.
3. `deviceKey(serial, 9007199254740992n)` : refus ; `parseDeviceKey` de la même clé : `422`.
4. Opération avec une propriété inconnue dans `tap` : l'empreinte la prend en compte (pas de retrait).
5. `record` rejoué avec un contenu différent : `CL002` remonte, aucune ligne modifiée.
6. `seq` de 17 chiffres envoyé comme nombre : jamais arrondi silencieusement avant l'empreinte.
7. Plus aucun `INSERT INTO anomaly` dans `apps/api/src` hors tests d'amorçage (grep).
8. Les vecteurs ont été calculés par Python : change un octet du code, un vecteur doit rougir.

## Definition of Done

- [ ] `chainedContent` unique, les trois fabriques en ligne l'appellent, vecteurs 5b inchangés.
- [ ] `deviceKey`, `MAX_DEVICE_SEQ = 2^53−1`, aucun `Number(seq)` dans les fichiers du lot.
- [ ] `record`, `lookup`, `AnomalyWriter` écrits et testés ; `accept`/`reject` conservés.
- [ ] Plus d'`INSERT INTO anomaly` dans `apps/api/src` ; suites en ligne non régressées.
- [ ] Rapport : retouche de `device-key.spec.ts`, `Number(seq)` restants hors carte, contradictions.

## Branch Strategy

Planification et fusion sur `feat/hors-ligne-snapshots-lots`. Dépendances : WP06, WP08. Worktree
attribué par lane (`lanes.json`). Commande : `spec-kitty agent action implement WP16 --agent claude
--mission hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
