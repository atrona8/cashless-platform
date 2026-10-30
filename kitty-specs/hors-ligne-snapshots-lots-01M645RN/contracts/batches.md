# Contrat : lots, registre, trous, import

Sources : `sync_protocol.md` §3, §6, §7, §10, §11, §13 ; `openapi.yaml` (`submitOfflineBatch`,
`getOfflineBatchResult`, `waiveSeqGap`, `importDeviceJournal`) ; research R-10 à R-19.

## `POST /offline-batches` — contrôles d'entrée (avant tout traitement, dans l'ordre)

| # | Contrôle | Refus |
|---|---|---|
| 1 | corps ≤ 1 048 576 octets | `413 BATCH_TOO_LARGE` |
| 2 | JSON ; numéros ≤ 2^53−1 (texte source) | `400 VALIDATION_FAILED` |
| 3 | schéma ; 1 à 500 opérations ; `count = |ops| = seq_to − seq_from + 1` ; type ∈ `PURCHASE, REVERSAL, TOPUP_CASH, VOID, ONLINE_REF` | `400 VALIDATION_FAILED` (vide, type) ; `413` (> 500) |
| 4 | `Idempotency-Key = header.batch_id` ; série = jeton ; `ledger_id` = grand livre de l'événement du terminal ; `X-Authority-Epoch = header.authority_epoch` | `400 VALIDATION_FAILED` |
| 5 | époque du lot < époque courante | `409 STALE_AUTHORITY_EPOCH` |
| 6 | signature DER de `JCS(header)` par `device.public_key` | `400 BATCH_SIGNATURE_INVALID` (+ audit) |
| 7 | numéros continus | `400 SEQ_OUT_OF_ORDER` |
| 8 | `content_sha256` et `chain_hash` recalculés = déclarés ; chaîne `prev → last` | lot `REJECTED CHAIN_BROKEN`, `409 CHAIN_BROKEN`, anomalie |
| 9 | autorité `EDGE` / `MOVING` | `409 DEBIT_AUTHORITY_EDGE` / `DEBIT_AUTHORITY_MOVING` |
| 10 | `open_offline_batch` : borne `CL021`, lot en vol `CL010`, chaîne, trous | `409 SEQ_OUT_OF_RANGE`, `409 BATCH_IN_PROGRESS` (+ `Retry-After: 2`), `409 CHAIN_BROKEN` |

Terminal `SUSPENDED` admis ; `REVOKED` refusé par l'authentification (`403 DEVICE_REVOKED`). Pool des verrous de lot
plein → `503 SERVICE_UNAVAILABLE` + `Retry-After: 5`, lot non ouvert (R-30.7).

## Traitement d'une opération (une transaction chacune, ordre des numéros)

1. Clé `<série>:<numéro>` (4 chiffres au moins, jamais tronqué).
2. Registre : même empreinte → résultat mémorisé ; autre empreinte → `REJECTED IDEMPOTENCY_KEY_REUSED` +
   `IDEMPOTENCY_CONFLICT` (transaction propre ; la première ligne fait foi).
3. Clé déjà au journal (en ligne, passerelle) → registre `DUPLICATE` (transaction d'origine), `effect LEDGER_WRITTEN`.
4. `VOID` → registre `VOID`, `ACCEPTED`/`NONE` (clé existante : `DUPLICATE` + `VOID_CONFLICT`) ; `ONLINE_REF` non
   exécutée → registre `VOID` raison `ONLINE_NOT_EXECUTED`, `ACCEPTED`/`NONE` ; `TOPUP_CASH` → `REJECTED
   OFFLINE_NOT_ALLOWED` + `NON_COMPLIANT_OPERATION` portant le montant (R-02).
5. Conformité (`compliance.md`) sauf `CONFIRMED` dont la transaction en ligne existe ; `CONFIRMED` introuvable →
   `ONLINE_CONFIRMED_MISSING` puis conformité complète.
6. Période : `PERIOD_CLOSED` (+ `PERIOD_CLOSED_OPERATION`), `LEDGER_LOCKED`, `SYNC_DEADLINE_PASSED`
   (+ `LATE_OFFLINE_SYNC`, vente et annulation).
7. Horloge corrigée (`CLOCK_SKEW`, original dans `metadata.device_occurred_at`).
8. `register_tap(..., 'OFFLINE', online_tap_id, signature)` ; table de conflit (`compliance.md`).
9. Écriture `OFFLINE_SYNC` (`PURCHASE` : portefeuille `couvert`, `S-ATTENTE` `manque`, commerçant `amount`, frais sur
   `amount` ; `REVERSAL` : lignes opposées, `reduce_offline_shortfall`) ; `CL007` → `SAVEPOINT`, 3 reprises ; 4e →
   `REJECTED INSUFFICIENT_FUNDS_RETRY`, `retryable: true`, rien au registre, ligne `offline_batch_retry` écrite par
   `record_offline_retry` (porteur, R-30.11).
10. `consume_tap` ; `OFFLINE_SHORTFALL` si `manque > 0` ; `record_device_seq(..., 'BATCH', tx, raison, batch_id)` ;
    `record_offline_op_result` (résultat rendu) ; COMMIT. Statut du lot relu avant chaque opération (`ABANDONED` →
    arrêt, résultats inscrits rendus).

Puis `complete_offline_batch(batch, results)`.

## Réponse (`OfflineBatchResult`)

`batch_id, processed_at, results[{seq, status, reject_reason?, shortfall_reason?, shortfall_amount?, transaction_id?,
effect, retryable, detail?}], contiguous_acked_seq, missing_seqs, next_snapshot_version, abandoned, server_time`.
`retryable` vrai seulement pour `INSUFFICIENT_FUNDS_RETRY`.

## Reprise et lecture

- Traitement sous `pg_try_advisory_lock(hash(batch_id))` de session, connexion dédiée.
- Renvoi d'un lot `PROCESSING` : verrou libre → reprise à la première opération sans ligne ; verrou tenu → `409
  BATCH_IN_PROGRESS`, `Retry-After: 2`. Renvoi d'un lot `COMPLETED` → `200` résultats mémorisés,
  `Idempotency-Replayed: true`.
- `GET /offline-batches/{batch_id}` : `200` (terminé, ou `abandoned: true`), `202` + `Retry-After: 2`, `404`.
- Lot `PROCESSING` > 15 min : `REJECTED ABANDONED` à l'ouverture du suivant (existant).

## Trous

- Lot après un trou : traité ; `missing_seqs` ; `SEQ_GAP` (0) par numéro manquant ; clos quand le numéro arrive.
- `POST /devices/{device_id}/seq-gaps/{seq}/waive` (`SUPERVISOR`, motif ≥ 10) → `check_seq_gap_waivable` (`409
  SEQ_GAP_NOT_FOUND` `CL012`, `409 BATCH_IN_PROGRESS` `CL010`) → demande `WAIVE_SEQ_GAP` `202` ; approbation par un autre
  `SUPERVISOR` → `waive_seq_gap` (contrôles rejoués) : registre `WAIVED`, anomalie `RESOLVED`, curseur avancé, aucune
  écriture comptable.
- Trou ouvert > 24 h : alerte unique (travailleur `seq-gap-age`, alarme 2), rien d'automatique.

## Import du journal d'un terminal révoqué

`POST /devices/{device_id}/journal-imports {batches: OfflineBatch[] (≤ 20), reason ≥ 10}` (`SUPERVISOR`) :
terminal `REVOKED` sinon `409 CONFLICT_STATE` ; signatures, empreintes et chaîne vérifiées tout de suite (`400`
sinon) ; `device_journal_import` + demande `DEVICE_JOURNAL_IMPORT` portant `batches_sha256` et la synthèse (nombre
d'opérations, total, plage, opérations datées après la dernière présence serveur) → `202`. Approbation par un autre
`SUPERVISOR` : `PROCESSING`, empreinte, signatures et chaîne revérifiées, travailleur `journal-import` (canal
`IMPORT`, une opération par transaction, reprise à la première sans résultat, `409` si un lot du terminal est
`PROCESSING`) ; valideur = approbateur ; opération datée après la révocation → `REJECTED OFFLINE_NOT_ALLOWED` +
`NON_COMPLIANT_OPERATION` ; fin `APPLIED` (ou `FAILED`).
