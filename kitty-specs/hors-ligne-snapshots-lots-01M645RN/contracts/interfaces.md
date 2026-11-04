# Interfaces entre lots — mission 7

Fichier unique, écrit par l'orchestrateur avant les prompts (décision du 27/10/2026). Il **fige** les noms et
signatures que plusieurs lots partagent. Un lot qui a besoin d'un changement le signale dans son rapport ; il ne
renomme rien seul. Ordre de priorité : `research.md` R-30 > ce fichier > autres contrats quand ils divergent (et la
divergence est signalée). Toute fonction SQL ci-dessous : `SET search_path = public, pg_temp`, `REVOKE ALL … FROM
PUBLIC` dans la migration ; les `GRANT` sont posés par WP08 dans `post-roles.sql`. SECURITY DEFINER sauf mention
« INVOKER ». Tout argument « acteur » est un `uuid` de personne (`app_user.id`). Dates : heure de la base
(`clock_timestamp()`), jamais celle de l'appelant, sauf `p_at`/`p_occurred` explicites.

## 1. Migrations et propriétaires

Numérotation définitive ; elle fait foi sur les numéros indicatifs du plan, de `research.md` et de `data-model.md`
(0043 à 0048) :

| Migration | Lot | Contenu |
|---|---|---|
| `0043_offline_policy.sql` | WP02 | politique, historique DEFINER, risque, CHECK espèces |
| `0044_offline_snapshots.sql` | WP03 | tables de snapshot, brouillon, publication |
| `0045_offline_snapshot_keys.sql` | WP04 | enveloppes, lecture pour le terminal, clés de signature |
| `0046_offline_batches.sql` | WP05 | lots, registre, `RETRY`, résultats, import, trous |
| `0047_offline_anomalies.sql` | WP06 | colonnes d'anomalie, fonctions d'anomalie, `wallet_status_history` |
| `0048_offline_device_vendor.sql` | WP07 | accusés, statut daté, vendeur daté, configuration en vigueur, nom de station |
| `0049_rights_hardening.sql` | WP08 | ce qui ne peut pas aller dans `post-roles.sql` (ex. `ALTER DEFAULT PRIVILEGES` si posé en migration) ; `lock_device` (cycle 2, ci-dessous) |
| `0050_device_journal_import_cancel.sql` | WP20 | hors plan (décision du porteur du 03/11/2026) : `cancel_device_journal_import` |

Nouveaux SQLSTATE (réservés, traduits par WP01 dans `apps/api/src/errors/sqlstate-map.ts`) :

| Code | Sens | HTTP |
|---|---|---|
| `CL045` | portée de politique invalide (autre prestataire, `OPERATOR_CEILING` ≠ prestataire) | `404 NOT_FOUND` |
| `CL046` | version de politique attendue différente | `409 CONFLICT_STATE` |
| `CL047` | `cash_topup_offline` vrai refusé | `422 VALIDATION_FAILED` |
| `CL048` | brouillon de snapshot invalide (empreinte, en-tête, version déjà publiée) | `500` (bug du producteur, alarme) |
| `CL049` | version de snapshot non servie à ce terminal ou empreinte différente (accusé) | `409 SNAPSHOT_VERSION_UNKNOWN` |
| `CL050` | aucun snapshot disponible pour ce terminal (aucune version, enveloppe pas prête) | `409 CONFLICT_STATE` |
| `CL051` | terminal non éligible au snapshot (interdit, sans événement, téléphone personnel, aucune clé `ACTIVE`) | `403 OFFLINE_NOT_ALLOWED` |
| `CL052` | import : terminal non `REVOKED` | `409 CONFLICT_STATE` |
| `CL053` | import : empreinte des lots différente de la demande, ou déjà appliqué | `409 CONFLICT_STATE` |
| `CL054` | troisième clé de signature valide par signataire | `409 CONFLICT_STATE` |

`CL001` (incohérence), `CL002` (idempotence), `CL010`, `CL011`, `CL012`, `CL017`, `CL021` gardent leur sens existant.

## 2. Base — politique (WP02, 0043)

```sql
set_offline_policy(p_scope_type text, p_scope_id uuid, p_values jsonb, p_expected_version int, p_actor uuid)
  RETURNS offline_policy
-- p_values : {offline_enabled?, max_per_sale?, max_per_media_per_device?, max_total_per_device?,
--             max_snapshot_age_seconds?, cash_topup_offline?}  (clé absente ou null = hérite)
-- crée si absent (p_expected_version NULL), sinon version attendue (CL046) ; portée (CL045) ; espèces (CL047)
clear_offline_policy(p_scope_type text, p_scope_id uuid, p_expected_version int, p_actor uuid) RETURNS void
offline_policy_level(p_scope_type text, p_scope_id uuid) RETURNS offline_policy   -- STABLE, NULL si aucune
offline_max_exposure(p_event uuid)
  RETURNS TABLE (device_id uuid, serial text, max_total_per_device bigint, capped boolean)  -- STABLE
-- log_offline_policy() : CREATE OR REPLACE en SECURITY DEFINER (OP-N58), corps inchangé sinon
```

Contrainte : `offline_policy_cash_topup_off CHECK (cash_topup_offline IS NOT TRUE)` (lignes existantes remises à
`false` avant, et la migration le dit en commentaire).

## 3. Base — snapshots (WP03 : 0044 ; WP04 : 0045)

Tables (toutes `operator_id`, RLS forcée) : `offline_snapshot_draft`, `offline_snapshot_entry`,
`offline_snapshot_state`, `offline_snapshot_media_log`, `offline_snapshot_key` ; colonne
`offline_snapshot.content_key_wrapped bytea NOT NULL` (défaut vide interdit : migration de 0 ligne existante).

Forme d'une entrée (`entry jsonb`, clés exactes, toutes présentes, `null` permis) :
`token_hash` (hex), `nfc_uid` (hex), `key_index`, `originality_sig_sha256` (hex), `status`, `batch_event_id`,
`batch_status`, `wallet_status`, `spendable` (entier), `last_counter`, `pwd_pack_sha256` (hex ou null).

```sql
-- WP03 : source, brouillon, publication (rôles : content = cashless_snapcontent, signer = cashless_snapsign)
offline_snapshot_targets()                     -- content ; STABLE
  RETURNS TABLE (operator_id uuid, ledger_id uuid, event_id uuid, last_version bigint,
                 last_generated_at timestamptz, last_full_version bigint, eligible_devices int,
                 max_snapshot_age interval)     -- colonne ajoutée par WP03 (rapporté le 04/11/2026)
discard_open_offline_snapshot_drafts(p_ledger uuid) RETURNS int   -- content ; DEFINER ; brouillons OPEN|READY
                  -- orphelins du grand livre jetés (jamais PUBLISHED), nombre rendu (WP03 cycle 3, B1)
offline_snapshot_source(p_ledger uuid)         -- content ; STABLE ; état complet, retirés compris
  RETURNS TABLE (token_hash bytea, media_id uuid, entry jsonb, pwd_pack_enc bytea, pwd_pack_dek_id uuid,
                 key_index int, nfc_uid bytea, removed boolean)
offline_snapshot_source_delta(p_ledger uuid, p_since timestamptz)   -- content ; STABLE ; recouvrement 5 s
  RETURNS SETOF <même ligne que offline_snapshot_source>
save_offline_snapshot_draft(p_ledger uuid, p_kind text, p_header jsonb, p_content_key_wrapped bytea,
                            p_entries jsonb)  -- content ; p_entries = [{token_hash, entry, pwd_pack_enc, removed}]
  RETURNS bigint   -- id du brouillon ; réserve version = max(publiée, brouillons) + 1 sous verrou consultatif
append_offline_snapshot_draft_entries(p_draft bigint, p_entries jsonb) RETURNS int   -- content ; paquets ≤ 5 000
seal_offline_snapshot_draft(p_draft bigint) RETURNS void   -- content ; READY (plus d'ajout)
offline_snapshot_drafts_ready()                                         -- signer ; STABLE
  RETURNS TABLE (id bigint, operator_id uuid, ledger_id uuid, kind text, base_version bigint, version bigint,
                 header jsonb, created_at timestamptz)   -- jamais content_key_wrapped (recopiée par publish)
offline_snapshot_draft_content(p_draft bigint)                            -- signer ; STABLE
  RETURNS TABLE (token_hash bytea, entry jsonb, removed boolean)          -- jamais pwd_pack_enc
publish_offline_snapshot(p_draft bigint, p_key_id text, p_signature bytea)   -- signer
  RETURNS TABLE (ledger_id uuid, version bigint, kind text, generated_at timestamptz)   -- jamais la clé enveloppée
-- l'empreinte JCS est recalculée par le signataire (TypeScript, RFC 8785) avant la signature ; la base vérifie
-- l'en-tête contre le brouillon (kind, base, version, entries/removed comptés, époque, clé), version = max + 1 (CL048),
-- DELTA ⇒ base = version précédente, clé ACTIVE CENTRAL ; insère offline_snapshot, entry, media_log,
-- met à jour state ; brouillon PUBLISHED ; écrit elle-même l'audit SNAPSHOT_PUBLISHED (DM 01M667XBV66NBKA5DEFFXY15HM)
discard_offline_snapshot_draft(p_draft bigint, p_reason text) RETURNS void   -- signer et content (ADR-140)
purge_offline_snapshot_content(p_ledger uuid) RETURNS int   -- content ; avant l'avant-dernier FULL
offline_snapshot_state_hashes(p_ledger uuid)   -- content ; STABLE (ajout WP03)
  RETURNS TABLE (token_hash bytea, entry_sha256 bytea, removed boolean)
offline_snapshot_entry_sha256(p_entry jsonb) RETURNS bytea   -- content ; IMMUTABLE, INVOKER (ajout WP03)
```

```sql
-- WP04 : enveloppes, lecture pour le terminal, clés de signature
offline_snapshot_keys_to_wrap(p_limit int)     -- content ; STABLE
  RETURNS TABLE (ledger_id uuid, version bigint, device_id uuid, agreement_public_key bytea,
                 agreement_key_sha256 bytea, content_key_wrapped bytea)
-- terminaux ACTIVE de l'événement, clé d'accord courante, versions >= dernier FULL publié, sans enveloppe
wrap_offline_snapshot_key(p_ledger uuid, p_version bigint, p_device uuid, p_agreement_key_sha256 bytea,
                          p_envelope jsonb) RETURNS void   -- content ; refuse terminal non ACTIVE ou clé périmée
offline_snapshot_for_device(p_device uuid, p_since bigint)   -- cashless_app ; STABLE
  RETURNS TABLE (version bigint, latest_version bigint, header jsonb, signature bytea, entries jsonb,
                 envelope jsonb)
-- CL051 non éligible (détail dans le message : OFFLINE_DISABLED | NO_EVENT | PERSONAL_PHONE |
--   SNAPSHOTS_UNAVAILABLE | DEVICE_SUSPENDED) ; CL050 rien de prêt ; règles de choix : contracts/snapshots.md + R-30.5
rotate_snapshot_signing_key(p_new_key_id text, p_public_key bytea, p_kms_key_ref text, p_actor uuid)
  RETURNS void   -- cashless_keyadmin ; nouvelle ACTIVE, ancienne RETIRED, plus ancienne RETIRED -> REVOKED ; CL054
snapshot_public_keys(p_operator uuid)          -- cashless_app ; STABLE ; ≤ 2 clés ACTIVE|RETIRED du central
  RETURNS TABLE (key_id text, algorithm text, public_key bytea, not_after timestamptz)
```

## 4. Base — lots, registre, import (WP05, 0046)

Tables : `offline_batch_retry`, `offline_op_result`, `device_journal_import` ; `offline_batch.received_via` admet
`IMPORT` ; colonnes `offline_batch.size_bytes int`, `offline_batch.import_id uuid`.

```sql
open_offline_batch(..., p_size_bytes int DEFAULT NULL)   -- DROP + CREATE : signature de S:2183 plus un dernier
                          -- paramètre (écrit size_bytes), contrôles ajoutés :
                          -- débordement de seq_from + n − 1 (CL011), grand livre de l'événement du terminal (CL001)
complete_offline_batch(p_batch uuid, p_results jsonb) RETURNS offline_batch   -- remplacée : numéro sans ligne
                          -- de registre admis seulement s'il a une ligne offline_batch_retry du lot (ADR-139)
offline_batch_state(p_batch uuid)               -- STABLE
  RETURNS TABLE (status text, reject_reason text, device_id uuid, received_at timestamptz,
                 completed_at timestamptz, seq_from bigint, seq_to bigint, missing_seqs bigint[], results jsonb)
record_offline_retry(p_batch uuid, p_seq bigint, p_reason text) RETURNS void
record_offline_op_result(p_batch uuid, p_seq bigint, p_result jsonb) RETURNS void   -- idempotent (même jsonb)
offline_op_results(p_batch uuid) RETURNS TABLE (seq bigint, result jsonb)          -- STABLE
offline_batch_retries_open(p_device uuid) RETURNS SETOF bigint                     -- STABLE
check_seq_gap_waivable(p_device uuid, p_seq bigint) RETURNS void   -- STABLE ; CL012, CL010 ; sans effet
create_device_journal_import(p_device uuid, p_batches jsonb, p_batches_sha256 bytea, p_summary jsonb,
                             p_reason text, p_actor uuid) RETURNS uuid   -- CL052 ; ≤ 20 lots
begin_device_journal_import(p_import uuid, p_batches_sha256 bytea, p_approver uuid)
  RETURNS device_journal_import   -- PENDING|PROCESSING -> PROCESSING ; empreinte égale (CL053) ; idempotent
open_imported_batch(p_import uuid, p_batch uuid, p_seq_from bigint, p_prev_chain_hash bytea, p_op_hashes bytea[],
                    p_last_chain_hash bytea, p_signature bytea) RETURNS offline_batch
                  -- jumelle d'open_offline_batch pour un terminal REVOKED, canal IMPORT, mêmes contrôles de chaîne
finish_device_journal_import(p_import uuid, p_status text, p_result jsonb) RETURNS void   -- APPLIED | FAILED
cancel_device_journal_import(p_import uuid, p_actor uuid, p_reason text) RETURNS void
                  -- 0050 (WP20 cycle 2, décision du porteur du 03/11) ; cashless_app ; DEFINER, assert_tenant ;
                  -- p_reason REJECTED|EXPIRED|FAILED ; PENDING -> REJECTED (jamais FAILED : garde de 0046) ;
                  -- demande encore valable -> CL001 ; import non PENDING -> CL053 ; idempotente ; p_actor non contrôlé
device_journal_import_view(p_import uuid, p_with_batches boolean DEFAULT false) RETURNS device_journal_import
                  -- STABLE ; batches vidés sauf p_with_batches
device_journal_imports_processing() RETURNS TABLE (import_id uuid, operator_id uuid)
                  -- cashless_app ; DEFINER, STABLE ; imports PROCESSING de tous les prestataires, identifiants
                  -- seulement ; le travailleur traite ensuite chaque import sous RLS (DM 01M667Y1J4DT3HY96ZBCXXMXBT)
```

Résultat d'opération (`offline_op_result.result`, et `results[]` de la réponse) : forme EXACTE de
`OfflineOperationResult` dans `openapi.yaml` (corrigée par WP01 ; le contrat prime sur cette liste indicative :
`seq`, `status`, `reject_reason?`, `shortfall_reason?`, `shortfall_amount?`, `transaction_id?`, `effect`,
`retryable`, `detail?`), sérialisée par JCS côté API avant écriture (comparaison octet pour octet au rejeu).

## 5. Base — anomalies et portefeuille (WP06, 0047)

Colonnes `anomaly.loss_bearer text NULL CHECK IN ('OPERATOR','ORGANIZER','MERCHANT')`, `anomaly.detail jsonb`,
`anomaly.batch_id uuid` ; table `wallet_status_history` + déclencheur + ligne de départ.

```sql
open_offline_anomaly(p_ledger uuid, p_kind text, p_device uuid, p_media uuid, p_seq bigint, p_tx uuid,
                     p_amount bigint, p_loss_bearer text, p_detail jsonb, p_batch uuid) RETURNS uuid
-- types permis : OFFLINE_SHORTFALL, SEQ_GAP, CHAIN_BROKEN, CLOCK_SKEW, SIGNATURE_MISMATCH, NON_COMPLIANT_OPERATION,
-- PERIOD_CLOSED_OPERATION, LATE_OFFLINE_SYNC, IDEMPOTENCY_CONFLICT, VOID_CONFLICT, ONLINE_CONFIRMED_MISSING
-- (CLOCK_SKEW aussi pour le chemin en ligne) ; idempotente par (kind, device, seq, tx) ; rend l'id
reduce_offline_shortfall(p_original_tx uuid, p_amount bigint, p_reversal_tx uuid) RETURNS void
mark_seq_gap_alerted(p_anomaly uuid) RETURNS void            -- signer
offline_seq_gaps_to_alert(p_older_than interval) RETURNS TABLE (anomaly_id uuid, operator_id uuid,
                     device_id uuid, seq bigint, created_at timestamptz)   -- signer ; STABLE ; jamais alertées
offline_retries_to_alert(p_older_than interval) RETURNS TABLE (operator_id uuid, device_id uuid, batch_id uuid,
                     seq bigint, created_at timestamptz)                    -- signer ; STABLE ; jamais alertées
mark_offline_retry_alerted(p_batch uuid, p_seq bigint) RETURNS void   -- signer ; pose offline_batch_retry.alerted_at
                     -- (colonne créée par WP05 en 0046) ; ADR-140
offline_block_time(p_media uuid, p_wallet uuid, p_before timestamptz) RETURNS timestamptz  -- STABLE ;
                     -- pour le bracelet, son lot et le portefeuille : début du blocage en vigueur à p_before ;
                     -- rend la PLUS ANCIENNE de ces dates (DM 01M667YQ5GEVNHMJ3MHGJBJ220) ; '-infinity' si
                     -- bloqué sans date connue (traité « bloqué avant ») ; NULL si jamais bloqué
```

## 6. Base — terminal, vendeur, configuration datés (WP07, 0048)

Table `offline_snapshot_ack (device_id, version) PK, operator_id, ledger_id, acked_at`.

```sql
ack_offline_snapshot(p_device uuid, p_version bigint, p_content_sha256 bytea) RETURNS void   -- CL049 ; max
offline_snapshot_ack_floor(p_device uuid, p_before timestamptz) RETURNS bigint   -- STABLE ; 0 si aucun
offline_snapshot_meta(p_ledger uuid, p_version bigint, p_device uuid)   -- STABLE ; aucune ligne si inconnue
  RETURNS TABLE (generated_at timestamptz, valid_until timestamptz, published_at timestamptz,
                 wrapped_for_device boolean)   -- enveloppe existante pour p_device
offline_media_state_at(p_ledger uuid, p_token_hash bytea, p_version bigint)   -- STABLE
  RETURNS TABLE (in_snapshot boolean, media_status text, batch_status text, batch_event_id uuid,
                 wallet_status text)
offline_config_in_force(p_device uuid, p_config_id bigint, p_at timestamptz, p_tol interval)  -- STABLE
  RETURNS jsonb   -- politique si config_id = dernière servie avec served_at ≤ p_at + p_tol ; sinon NULL
device_status_at(p_device uuid, p_at timestamptz) RETURNS text   -- STABLE ; depuis device_status_history
device_revoked_at(p_device uuid) RETURNS timestamptz             -- STABLE
assert_vendor_session_at(p_device uuid, p_session uuid, p_at timestamptz) RETURNS uuid   -- vendor_id ; CL032
record_sale_attribution_at(<signature de record_sale_attribution (0033)>, p_at timestamptz) RETURNS void
set_device_station_name(p_device uuid, p_name text, p_actor uuid) RETURNS void
offline_device_exposure(p_device uuid, p_media uuid, p_seq bigint, p_reference timestamptz, p_tol interval)
  RETURNS TABLE (per_media bigint, per_device bigint)   -- STABLE ; règle R-30.3 (avant l'opération p_seq)
```

## 7. Droits (WP08)

Rôles nouveaux créés dans `post-roles.sql` : `cashless_snapcontent`, `cashless_snapsign`, `cashless_maint`
(LOGIN, NOINHERIT, NOBYPASSRLS, `TEMPORARY` retiré, délais propres). Accords exacts : `contracts/database-rights.md`
corrigé par R-30.12, plus les fonctions de ce fichier selon le rôle indiqué en commentaire (« content », « signer »,
`cashless_app` par défaut pour le reste). Fichier commun de tests : `packages/ledger-sql/tests/_grants_for_tests.sql`
(inclus par `\ir` après `post-roles.sql` dans les 41 suites concernées).

`lock_device(p_device uuid, p_mode text) RETURNS boolean` (0049, WP08 cycle 2) : DEFINER, `cashless_app` ; prend le
verrou de ligne du terminal (`'UPDATE'` ou `'NO KEY UPDATE'`) à la place de l'API, qui n'a plus d'`UPDATE` sur
`device` (OP-N69) ; faux si le terminal n'est pas au prestataire courant. Rapporté le 04/11/2026.

## 8. API — ports et modules partagés

| Élément | Fichier | Lot | Forme |
|---|---|---|---|
| `SignPort`, jeton `SIGN_PORT`, capacité `'sign'`, `KmsKeyKind` `'ECC_NIST_P256'` | `apps/api/src/kms/kms.ports.ts` | WP09 | `sign(kmsKeyRef: string, message: Uint8Array): Promise<Buffer>` (DER) ; `publicKey(kmsKeyRef: string): Promise<Buffer>` (SPKI DER) |
| Faux | `apps/api/src/kms/fake-kms.ts` | WP09 | clé P-256 déterministe (graine + référence) ; `isFake = true` |
| Enveloppe de snapshot | `packages/tag-format/src/device-envelope.ts` | WP12 | `snapshotKeyAad(ledgerId, version: bigint, deviceId): Buffer` ; `snapshotPwdAad(ledgerId, version: bigint, tokenHash, nfcUid): Buffer` |
| Empreinte d'opération | `apps/api/src/payments/chained-content.ts` (nouveau) | WP16 | `chainedContent(op: Record<string, unknown>): Record<string, unknown>` ; `contentSha256` reste dans `device-seq-registry.ts` |
| Clé d'opération | `apps/api/src/idempotency/device-key.ts` | WP16 | `deviceKey(serial: string, seq: bigint): string` ; `MAX_DEVICE_SEQ = 2n ** 53n - 1n` |
| Registre | `apps/api/src/payments/device-seq-registry.ts` | WP16 | `record(client, {deviceId, seq: bigint, content: Buffer, outcome, reason?, transactionId?, batchId?}, channel): Promise<RegistryRow>` ; `RegistryRow = {replayed, outcome, reason, transactionId, contiguousAckedSeq}` ; `lookup(client, deviceId, seq): Promise<RegistryRow \| null>` |
| Écrivain d'anomalies | `apps/api/src/offline/anomalies/anomaly-writer.ts` | WP16 | `open(client, AnomalyInput): Promise<string>` (uuid, `anomaly.id`) ; `reduceShortfall(client, originalTx, amount, reversalTx)` |
| Lecture JSON brute | `apps/api/src/offline/batches/raw-json.ts` | WP18 | `parseWithSafeIntegers(text: string, seqFields: string[]): unknown` (refus `> 2^53−1`, pointeur) |
| Règles pures | `apps/api/src/offline/rules/*.ts` | WP17 | voir § 9 |
| Processeur | `apps/api/src/offline/processing/offline-operation.processor.ts` | WP19 | `process(ctx: BatchContext, op: ParsedOperation): Promise<OperationResult>` |
| Types du processeur | `apps/api/src/offline/batches/batch.types.ts` | WP18 (WP19, WP20 importent) | `BatchContext = {batchId, deviceId, operatorId, ledgerId, serial, receivedAt, receivedVia: 'DEVICE' \| 'IMPORT', importId: string \| null, authorityEpoch}` ; `ParsedOperation = {seq: bigint, raw, type, contentSha256: Buffer}` ; `OperationResult` = `OfflineOperationResult` du contrat (WP01) ; jeton `OFFLINE_OPERATION_PROCESSOR` |
| Moteur | `apps/api/src/ledger/types.ts` | WP19 | `PurchasePayload.coveredCap?: bigint` ; `EngineResult.shortfall?: bigint` |
| Passage hors ligne | `apps/api/src/media/taps/tap.service.ts` | WP19 | `registerOffline(client, device, tap, onlineTapId: string \| null): Promise<{result, tapId}>` |
| Audit | `apps/api/src/audit/audit.service.ts` | chaque lot | valeurs ajoutées en fin d'union (une ligne chacune) : `OFFLINE_POLICY_SET`, `OFFLINE_POLICY_CLEARED`, `OFFLINE_BATCH_RECEIVED`, `OFFLINE_BATCH_REFUSED`, `SEQ_GAP_WAIVE_REQUESTED`, `SEQ_GAP_WAIVED`, `DEVICE_JOURNAL_IMPORT_REQUESTED`, `DEVICE_JOURNAL_IMPORTED`, `SNAPSHOT_PUBLISHED` |

Configuration (`apps/api/src/config/config.ts`, motif `tagUrl` : vide accepté hors du processus qui s'en sert) :
`DATABASE_URL_SNAPCONTENT` (WP11), `DATABASE_URL_SNAPSIGN` (WP13), `DATABASE_URL_MAINT` (WP10),
`OFFLINE_BATCH_POOL_SIZE` (20, WP18), `SNAPSHOT_POLL_SECONDS` (1), `SNAPSHOT_FULL_EVERY_SECONDS` (3 600),
`SNAPSHOT_SIGNING_KEY_REF` (WP13). `config.ts` n'a pas de propriétaire unique : chaque lot ajoute ses clés par une
retouche hors carte (ligne de rapport), l'orchestrateur fusionne.

## 9. Règles pures (WP17) — signatures

```ts
// apps/api/src/offline/rules/offline-time.ts
resolveOfflineTime(occurredAt: string, recordedAt: Date, snapshotGeneratedAt: Date | null, tolMs: number)
  : { corrected: Date; skew: 'NONE' | 'FUTURE' | 'BEFORE_SNAPSHOT' }
detectInversions(ops: {seq: bigint; occurredAt: Date}[], tolMs: number): bigint[]
// apps/api/src/offline/rules/conflict-outcome.ts
conflictOutcome(i: {tapResult: TapResult; amount: bigint; spendable: bigint; walletStatus: string;
  blockTime: Date | null | 'UNKNOWN'; occurredAt: Date; snapshotGeneratedAt: Date; tolMs: number})
  : {kind: 'WRITE'; covered: bigint; shortfall: bigint; shortfallReason?: ShortfallReason}
  | {kind: 'REJECT'; reason: 'MEDIA_NOT_IN_SNAPSHOT' | 'MEDIA_WRONG_EVENT'}
// apps/api/src/offline/rules/compliance.ts
checkCompliance(i: ComplianceInput): {ok: true} | {ok: false; reason: OfflineRejectReason; detail: string[]}
// apps/api/src/offline/rules/period.ts
checkPeriod(i: {occurredAt: Date; lockedUntil: Date | null; ledgerStatus: string; eventStatus: string;
  type: OperationType}): {ok: true} | {ok: false; reason: 'PERIOD_CLOSED' | 'LEDGER_LOCKED' |
  'SYNC_DEADLINE_PASSED'; anomaly: 'PERIOD_CLOSED_OPERATION' | 'LATE_OFFLINE_SYNC'}
// apps/api/src/offline/rules/loss-bearer.ts
lossBearer(providedBy: 'PLATFORM' | 'OPERATOR' | 'ORGANIZER' | 'MERCHANT'): 'OPERATOR' | 'ORGANIZER' | 'MERCHANT'
```

`ComplianceInput` regroupe ce que le processeur lit en base (devise, statut daté, politique en vigueur, cumuls,
méta du snapshot, plancher d'accusé, état du bracelet à la version, `pack_verified`, cible d'annulation) ; les
fonctions pures ne lisent jamais la base.

## 10. Routes (contrat, WP01 ; servies par)

| `operationId` | Lot |
|---|---|
| `getOfflineCeiling`, `setOfflineCeiling`, `get/set{Organizer,Event,Device}OfflinePolicy`, `getEventOfflineRisk` | WP14 |
| `getOfflineSnapshot`, `ackOfflineSnapshot` | WP15 (module `offline/snapshots/`, sans port de clé) |
| `submitOfflineBatch`, `getOfflineBatchResult` | WP18 (réception) + WP19 (traitement) |
| `waiveSeqGap`, `importDeviceJournal` (+ approbation `DEVICE_JOURNAL_IMPORT`), `getDeviceJournalImport` (ajout du
30/10 : `GET /devices/{device_id}/journal-imports/{import_id}`, `SUPERVISOR`/`ORGANIZER_ADMIN`, `404` neutre hors
prestataire, rend `DeviceJournalImportResult` par `device_journal_import_view`) | WP20 |
| `getDeviceConfig` (`snapshot_keys`, `offline_enabled` faux sans clé), battement de cœur (`latest_snapshot_version`, `sync_requested`) | WP15 |

## 11. Processus

| Processus | Entrée | Module | Rôle de base | Ports | Lot |
|---|---|---|---|---|---|
| `snapshot-content` | `apps/api/src/main.snapshot-content.ts` | `processes/snapshot-content.module.ts` | `cashless_snapcontent` | `DecryptPort`, `DataKeyPort` | WP11, WP12 |
| `snapshot-signer` | `apps/api/src/main.snapshot-signer.ts` | `processes/snapshot-signer.module.ts` | `cashless_snapsign` | `SignPort` | WP13 |
| `maintenance` | `apps/api/src/main.maintenance.ts` | `processes/maintenance.module.ts` | `cashless_maint` | aucun | WP10 |

Chaque processus : `runWorkers` de `processes/bootstrap.ts`, `--once` / `--list`, `assertProcessIsSafe`, script
`start:<nom>` dans `apps/api/package.json` (retouche hors carte, ligne de rapport). Alarmes : 2 = constat métier
(trou ou `RETRY` de plus de 24 h), 3 = KMS / signature indisponible.
