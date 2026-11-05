# Interfaces entre lots, mission 8 (noms et signatures figés)

Ce fichier fige ce que plusieurs lots partagent. Il ne redit pas le raisonnement : `research.md` (R-xx) et `data-model.md`
l'expliquent. Un lot qui doit s'en écarter s'arrête et le signale à l'orchestrateur ; il ne change rien en silence.
Un changement qui affaiblit la sécurité va au porteur (règle 1 de `CLAUDE.md`). Types SQL exacts : ceux du schéma de référence
(`authority_epoch` et `edge_seq` selon `S:2491` et `S:2707`).

## 1. Migrations du central (numéros figés, remplacent les numéros indicatifs de `data-model.md`)

| Migration | Lot | Contenu |
|---|---|---|
| `0058_edge_gateway_admin.sql` | WP03 | rôles `cashless_edge` et `cashless_edgeadmin` ; colonnes `edge_gateway` ; déclencheur `revoked_at` et `REVOKED` terminal ; fonctions d'inscription, d'identification et de lien |
| `0059_edge_handover.sql` | WP04 | colonnes du handover ; `pg_notify` ; enveloppes d'accord, d'accusé, de rendu, d'échec, de lecture ; `begin_cash_close` |
| `0060_edge_sync_registry.sql` | WP05 | `edge_sync_batch`, `edge_sync_batch_result`, `VOID` au registre, `edge_record_seq`, garde `EDGE_SYNC` de `post_transaction` |
| `0061_edge_post_transaction.sql` | WP06 | `edge_post_transaction` et ses bornes ; réglages des plafonds de rejeu |
| `0062_edge_counter_ops.sql` | WP07 | `edge_activate_media`, `edge_take_deposit`, `edge_topup_cash` |
| `0063_edge_replication.sql` | WP08 | `edge_pwd_pack_key`, `edge_pwd_pack`, `edge_reference_change` et déclencheurs, `edge_device_seq_acked`, `edge_staff_token_audit`, `edge_replication_page`, `edge_record_staff_token_audit`, `deposit_edge_pwd_pack`, `mark_edge_gateways_silent` |

Toute fonction de ces migrations : `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC`. **Aucun
`GRANT` dans ces migrations** : ils arrivent par `post-roles.sql` en WP09 ; les suites pgTAP des lots WP03 à WP08 s'exécutent sous le
propriétaire. `roles.sql`, `post-roles.sql`, `tests_execute_grants.sql`, `tests_offline_rights.sql` appartiennent à WP09. Les `.sql`
générés de `packages/ledger-sql/` ne se modifient jamais.

## 2. Fonctions SQL (signatures figées)

```sql
-- WP03
identify_edge_gateway(p_cert_sha256 bytea)
  RETURNS TABLE (gateway_id uuid, operator_id uuid, event_id uuid, ledger_id uuid, role text, status text, lan_url text, public_key bytea)
touch_edge_gateway(p_gateway uuid) RETURNS void
register_edge_gateway(p_operator uuid, p_event uuid, p_serial text, p_role text, p_cert_sha256 bytea, p_public_key bytea,
                      p_agreement_public_key bytea, p_lan_url text, p_registered_by_label text) RETURNS uuid
revoke_edge_gateway(p_gateway uuid, p_reason text, p_label text) RETURNS void
rotate_edge_gateway_cert(p_gateway uuid, p_cert_sha256 bytea, p_label text) RETURNS void
swap_edge_gateway_roles(p_old_primary uuid, p_new_primary uuid, p_label text) RETURNS void
set_edge_gateway_role(p_gateway uuid, p_role text, p_label text) RETURNS void   -- non accordée seule

-- WP04
get_debit_authority(p_ledger uuid)
  RETURNS TABLE (ledger_id uuid, authority text, epoch bigint, edge_gateway_id uuid, lan_url text)
get_current_edge_handover(p_gateway uuid) RETURNS SETOF debit_authority_handover  -- une ligne au plus, priorité A13
edge_grant_authority(p_ledger uuid, p_gateway uuid, p_actor uuid) RETURNS debit_authority_handover -- enveloppe humaine
edge_ack_handover(p_gateway uuid, p_handover uuid, p_epoch bigint, p_replicated bigint) RETURNS debit_authority_handover
begin_edge_release(p_gateway uuid, p_handover uuid, p_epoch bigint, p_final_seq bigint, p_last_hash bytea, p_ops bigint) RETURNS debit_authority_handover
edge_complete_release(p_gateway uuid, p_handover uuid, p_epoch bigint, p_final_seq bigint, p_last_hash bytea, p_ops bigint) RETURNS debit_authority_handover
fail_edge_release(p_handover uuid, p_actor uuid) RETURNS debit_authority_handover
force_central_authority_approved(p_ledger uuid, p_approval uuid, p_reason text) RETURNS debit_authority_handover

-- WP05
edge_record_seq(p_gateway uuid, p_edge_seq bigint, p_origin_key text, p_content bytea, p_outcome text, p_tx uuid, p_reason text) RETURNS void
edge_sync_batch_begin(p_gateway uuid, p_batch uuid, p_epoch bigint, p_from bigint, p_to bigint, p_request_sha256 bytea)
  RETURNS TABLE (state text, already_done boolean)
edge_sync_batch_result(p_batch uuid, p_edge_seq bigint, p_outcome text, p_reason text, p_detail text, p_tx uuid, p_retryable boolean) RETURNS void
edge_sync_batch_finish(p_batch uuid, p_status text) RETURNS void

-- WP06
edge_post_transaction(p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text, p_content bytea, p_op jsonb, p_fee_lines jsonb)
  RETURNS TABLE (outcome text, transaction_id uuid, reason text, detail text, charged_to_wallet bigint, shortfall_amount bigint)

-- WP07 (mêmes retours que edge_post_transaction)
edge_activate_media(p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text, p_content bytea, p_op jsonb)
edge_take_deposit(p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text, p_content bytea, p_op jsonb)
edge_topup_cash(p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text, p_content bytea, p_op jsonb)

-- WP08
edge_replication_page(p_gateway uuid, p_after_posting bigint, p_after_change bigint, p_limit int) RETURNS jsonb
edge_record_staff_token_audit(p_gateway uuid, p_batch uuid, p_rows jsonb) RETURNS void
deposit_edge_pwd_pack(p_gateway uuid, p_media uuid, p_pack bytea, p_pack_sha256 bytea, p_media_version bigint) RETURNS void
deposit_edge_pwd_pack_key(p_gateway uuid, p_agreement_key_sha256 bytea, p_wrapped jsonb) RETURNS void
mark_edge_gateways_silent(p_threshold interval) RETURNS integer
```

Chaque enveloppe compare `p_gateway` à `current_setting('app.gateway_id')`, posé par la garde mTLS ; désaccord : `42501`.
`edge_post_transaction` et les fonctions de WP07 écrivent l'opération **et** appellent `record_edge_seq` dans la même transaction.

## 3. Rôles, connexions, processus

| Rôle | Variable | Processus | Point d'entrée |
|---|---|---|---|
| `cashless_edge` | `DATABASE_URL_EDGE`, `CASHLESS_EDGE_PASSWORD` | `edge` | `apps/api/src/main.edge.ts`, `processes/edge.module.ts`, script `start:edge` |
| `cashless_edgeadmin` | `DATABASE_URL_EDGEADMIN`, `CASHLESS_EDGEADMIN_PASSWORD` | outil | `tools/edge-admin/` |
| `edge_app` (base locale) | `GATEWAY_DATABASE_URL` | passerelle | `apps/gateway/src/main.ts`, script `start` |

Les routes humaines `POST` et `GET /ledgers/{id}/debit-authority` restent dans le processus public (`cashless_app`). Les routes `/edge/*` et le
`GET` en `edgeMtls` sont dans le processus `edge`.

## 4. Jetons d'injection et ports

| Jeton | Interface | Fichier | Faux |
|---|---|---|---|
| `EDGE_CA` | `EdgeCaPort { caCertPem(): string; issue(csrPem: string, serial: string): Promise<string> }` | `apps/api/src/edge/edge-ca.port.ts` | `fake-edge-ca.ts`, `isFake = true` |
| `HARDWARE_KEYSTORE` | `HardwareKeystore { sign(use: KeyUse, data: Buffer): Promise<Buffer>; agree(peerPublic: Buffer): Promise<Buffer>; publicKey(use: KeyUse): Promise<Buffer>; destroy(use: KeyUse): Promise<void> }`, `KeyUse = 'snapshot' \| 'token' \| 'batch' \| 'agreement'` | `apps/gateway/src/key-store/hardware-keystore.port.ts` | `fake-hardware-keystore.ts`, `isFake = true` |
| `GATEWAY_CLOCK` | `GatewayClock { now(): Date; observeCentral(date: Date): Promise<void>; skewAlert(): boolean }` | `apps/gateway/src/clock/gateway-clock.ts` | aucun |
| `AUTHORITY` | `AuthorityService { state(): Promise<AuthorityRow>; assertCanDebit(requestEpoch: number \| null): Promise<AuthorityRow> }` (dans la transaction de l'opération) | `apps/gateway/src/authority/authority.service.ts` | aucun |
| `EDGE_QUEUE` | `EdgeQueue { append(tx, op: EdgeOpInput, deltas: WalletDelta[]): Promise<EdgeOpRow> }` | `apps/gateway/src/queue/edge-queue.ts` | aucun |

`apps/gateway/src/db/gateway-tx.ts` : `GatewayTx.run<T>(fn: (tx) => Promise<T>)`, une transaction `READ COMMITTED` locale ; un seul pool (test d'architecture).

## 5. Code partagé, `@cashless/shared-rules` (`packages/shared-rules/src/index.ts`)

Déplacé de l'API sans changement de comportement (WP02) : `ledger/money/*`, `chainedContent`, `CHAINED_FIELDS`, `offline/rules/*`, partie pure de `batch-chain.ts`.

Nouveau (WP02), noms figés :

```ts
export function edgeContent(op: EdgeSyncOperationLike): object;              // R-12
export function edgeContentSha256(op: EdgeSyncOperationLike): Buffer;
export function edgeChainGenesis(gatewayId: string): Buffer;
export function chainStep(prev: Buffer, content: Buffer): Buffer;
export function batchSigningPayload(batch: EdgeSyncBatchLike): Buffer;       // JCS sans `signature`, R-13
export function nodeEnv(value: string | undefined): NodeEnv;                 // même énumération que config.ts
export function effectiveBalance(central: { paid: bigint; promo: bigint },
  deltas: { paid: bigint; promo: bigint }[]): { paid: bigint; promo: bigint };
```

Vecteurs : `apps/api/test/fixtures/edge-vectors/gen_edge_vectors.py` et `vectors.json`, indépendants du code testé (cas (a) à (j) de R-12).

## 6. Contrat (WP01 seul touche `openapi.yaml`)

Ajouts exacts : `contracts/replication-page-additions.yaml`. Référence : commit `d2a7c538`, SHA-256 épinglée dans
`contracts/contract-stability-check.md`. Outil : `tools/contract-stability/check.mjs`, sortie `0` admis, `2` refus, `1` panne.
Aucune valeur d'énumération ajoutée : `MALFORMED_OPERATION`, `INSUFFICIENT_FUNDS`, `INSUFFICIENT_FUNDS_RETRY`, `REVERSAL_TARGET_NOT_FOUND`
(A11). Toute autre différence fait échouer la CI.

## 7. Correspondance des erreurs

| SQLSTATE ou état | Réponse | Où |
|---|---|---|
| `CL006` central sous `EDGE` | `409 DEBIT_AUTHORITY_EDGE` avec `edge_base_url` et `authority_epoch`, selon l'exemple du contrat | WP11 (tous chemins de débit, via la correspondance existante) |
| `CL013` | `409 HANDOVER_INVALID_STATE` (handover étranger ou inconnu compris) | WP12 |
| `CL014` | `409 EDGE_NOT_CAUGHT_UP` avec `missing_edge_seqs` | WP12 |
| `CL015` | `409 STALE_AUTHORITY_EPOCH` | WP12, WP13 |
| `CL016` | `409 SEQ_OUT_OF_ORDER` | WP13 |
| `CL017` | `409 CHAIN_BROKEN`, alerte | WP12, WP13 |
| signature de lot invalide | `400 BATCH_SIGNATURE_INVALID`, lot non traité | WP13 |
| `begin_cash_close` sous `EDGE` | `409 CONFLICT_STATE` | WP04 (SQL), WP11 (message) |
| passerelle `ACTIVE`, opération indisponible | `409 DEBIT_AUTHORITY_EDGE`, `retryable: false`, sans `edge_base_url`, avec l'époque | WP21 |
| passerelle `RELEASING` | `409 DEBIT_AUTHORITY_MOVING` | WP21 |
| passerelle `STALE` | `409 STALE_AUTHORITY_EPOCH` | WP21 |
| passerelle `ARMED`, `STANDBY` | `409 CONFLICT_STATE` | WP21 |

Noms de l'audit central : `EDGE_GATEWAY_REGISTERED`, `EDGE_GATEWAY_REVOKED`, `EDGE_GATEWAY_ROLE_CHANGED`, `EDGE_CERT_ROTATED`, `EDGE_AUTHORITY_GRANTED`,
`EDGE_AUTHORITY_RELEASED`, `EDGE_AUTHORITY_FORCED`, `EDGE_STAFF_TOKEN_TOLERATED`. Alertes : `EDGE_REGISTERED`, `EDGE_CHAIN_BROKEN`, `EDGE_RELEASE_STUCK`, `EDGE_SILENT`, `EDGE_REPLAY_CEILING`.

## 8. Configuration

Central (`apps/api/src/config/config.ts`, clés ajoutées par WP10) : `DATABASE_URL_EDGE`, `EDGE_TLS_CERT_FILE`, `EDGE_TLS_KEY_FILE`, `EDGE_CA_CERT_FILE`, `EDGE_LISTEN_PORT`,
`EDGE_PACK_DELAY_SECONDS` (défaut 1800 ; `0` refusé en production), `EDGE_REPLAY_MAX_PER_SALE` (défaut 50000), `EDGE_REPLAY_MAX_PER_TERMINAL_HOUR` (défaut 500000).
Les plafonds sont passés à `edge_post_transaction` depuis une table de réglage de plateforme (WP06), pas depuis `offline_policy`.

Passerelle (`apps/gateway/src/config/config.ts`, WP16) : `NODE_ENV`, `GATEWAY_DATABASE_URL`, `GATEWAY_CENTRAL_URL`, `GATEWAY_LISTEN_PORT`, `GATEWAY_TLS_CERT_FILE`, `GATEWAY_TLS_KEY_FILE`,
`GATEWAY_DEVICE_CA_FILE`, `GATEWAY_CENTRAL_CLIENT_CERT_FILE`, `GATEWAY_CENTRAL_CLIENT_KEY_FILE`, `GATEWAY_REQUEST_AUTHORITY`, `GATEWAY_ENROLLMENT_FILE`, `HARDWARE_KEYSTORE`, `EDGE_FAILPOINT`, `EDGE_ALLOW_FAILPOINTS`.

Garde de démarrage (`apps/gateway/src/processes/startup-guard.ts`, WP16) : en production, refuse `HARDWARE_KEYSTORE=fake`, un `EDGE_CA` factice, un vérificateur d'identité de test, `EDGE_FAILPOINT`, `EDGE_ALLOW_FAILPOINTS`, `CORS_ALLOW_ALL`, l'écoute sans TLS, une `@authority` à joker, un secret de test, `fsync`, `full_page_writes` ou `synchronous_commit` désactivés. Chaque refus est prouvé par un démarrage réel. Les lots suivants ajoutent ici leur faux éventuel.

## 9. Passerelle : tables locales

`apps/gateway/migrations/edge-0001_*.sql` (WP16, toutes les tables de `data-model.md` B, en une seule série pour éviter des lanes concurrentes). Les lots suivants n'ajoutent une migration `edge-00NN` qu'en cas de besoin, signalé.

## 10. Passerelle : fonctions figées entre lots

```ts
// WP17 authority.service.ts
AuthorityService.onHandover(h: HandoverView): Promise<void>;      // machine à états B.8
AuthorityService.observeEpoch(epoch: number, source: 'central' | 'request'): Promise<void>; // A12
// WP18 replication/replication.service.ts
ReplicationService.pullOnce(): Promise<{ hasMore: boolean }>;
ReplicationService.catchUpTo(watermark: bigint): Promise<void>;
ReplicationService.effectiveBalance(tx, walletId: string): Promise<{ paid: bigint; promo: bigint }>;
// WP19 device-proofs/device-proofs.guard.ts
class DeviceProofsGuard implements CanActivate;                    // trois preuves, pose req.device
// WP20 queue/edge-queue.ts, queue/drain.service.ts
EdgeQueue.append(tx, op, deltas);  DrainService.runOnce(): Promise<{ sent: number; empty: boolean }>;
// WP22 staff/staff-token.guard.ts
class StaffTokenGuard implements CanActivate;                      // R-20, sept conditions dans l'ordre
```

Points d'arrêt (`apps/gateway/src/testing/failpoints.ts`, WP16) : `before-local-write`, `after-local-write-before-reply`, `during-drain-after-send-before-result`, `after-releasing-persisted`, `kill-local-database`.

## 11. Fichiers sans propriétaire unique, retouchés hors carte avec une ligne dans le rapport

`apps/api/src/audit/audit.service.ts` (valeurs d'`AuditAction`), `apps/api/src/config/config.ts` (clés du § 8), `apps/api/package.json` (scripts `start:*`), `apps/api/jest.config.cjs` (liste `SKIP_LATENCY`), `apps/api/src/app.module.ts`, `apps/api/src/processes/bootstrap.ts` (écouteur `edge`), `package.json` (workspaces).

## 12. Arbitrages de l'orchestrateur après la rédaction des lots (font foi sur tout prompt, `research.md` et `data-model.md`)

1. **Numéros de migration** : § 1 fait foi. Les numéros de `research.md` et `data-model.md` sont indicatifs.
2. **Journal de référence** : la TABLE `edge_reference_change` est créée en `0058` (WP03), vide ; ses déclencheurs restent en `0063` (WP08). WP04 la lit donc réellement : aucune table temporaire ni SQL dynamique. WP08 dépend aussi de WP05 (lecture de `edge_sync_batch`).
3. **Clé de snapshot de la passerelle** : `register_edge_gateway` garde ses neuf paramètres. Ajout WP03 : `edge_register_snapshot_key(p_gateway uuid, p_key_id text, p_public_key bytea, p_label text) RETURNS void` (`owner = 'EDGE'`), accordée à `cashless_edgeadmin` seul, appelée par l'outil (WP15).
4. **Réglages de plateforme** : table `edge_platform_setting(key text PK, value bigint NOT NULL CHECK (value > 0), updated_at, updated_by_label)`, créée en `0061` (WP06), exception nommée à la règle `operator_id` (réglage global, aucune donnée de prestataire), lue par `edge_post_transaction` et `edge_replication_page` sans paramètre. Clés et défauts : `replay_max_per_sale` 50000, `replay_max_per_terminal_hour` 500000, `pack_delay_seconds` 1800. Écriture : `set_edge_setting(p_key text, p_value bigint, p_label text) RETURNS void`, auditée, accordée à `cashless_edgeadmin` seul. Les clés de configuration `EDGE_PACK_DELAY_SECONDS` et `EDGE_REPLAY_MAX_*` du § 8 sont **retirées** : un processus compromis ne doit pas pouvoir les changer. En développement et en test, les suites posent une valeur par `set_edge_setting`.
5. **Fonctions ajoutées** : `edge_gateways_awaiting_pack(p_limit int) RETURNS TABLE (gateway_id uuid, event_id uuid, agreement_public_key bytea)` (WP08, à `cashless_tagkeys`) ; `edge_stuck_handovers(p_older interval) RETURNS SETOF debit_authority_handover` (WP04, au rôle de maintenance). WP09 accorde aussi `edge_sync_batch_finish` à `cashless_edge`, `deposit_edge_pwd_pack_key` à `cashless_tagkeys`, et vérifie les droits de `request_edge_release` et `fail_edge_grant`. `edge_grant_authority` est l'enveloppe accordée à `cashless_app` ; la S12 brute `grant_edge_authority` reste fermée.
6. **Lecture `edgeMtls` de `getDebitAuthority`** : dans WP10. `getCurrentEdgeHandover` sans handover répond `200` avec `handover: null`.
7. **Alerte** : ligne d'audit plus `pg_notify('edge_alert', json)`. Aucun canal externe dans cette mission.
8. **Outil de stabilité** : `tools/contract-stability/check.mjs` ; script racine `check:stability`. CI branchée par WP25 ; `.github/CODEOWNERS` et `check-baseline-decision.mjs` appartiennent à WP25.
9. **Noms** : § 3 et § 8 font foi sur `quickstart.md` (`edge_app`, `GATEWAY_LISTEN_PORT`, `EDGE_LISTEN_PORT`). Migrations de la passerelle : `apps/gateway/migrations/`. Bases de test : préfixe `cashless_m8_`. Variables ajoutées à la passerelle, développement seulement sauf la première et refusées en production : `GATEWAY_IDENTITY_JWKS_URL` (toujours permise, `https` en production), `EDGE_CA=fake`, `GATEWAY_IDENTITY_VERIFIER=test`. Port local d'ordres signés : `GATEWAY_ADMIN_PORT`, boucle locale seulement.
10. **Annulation sur la passerelle** : seul le vendeur de la vente annule ; `X-Approval-Token` n'est pas servi. Renforcement, à consigner.
11. **NFR-005** : la mesure de référence est celle de WP25. `edge_identity_key` appartient à WP22. WP15 dépend de WP10 (`EdgeCaPort`). WP15 fixe le format des fichiers de demande et d'enrôlement dans `tools/edge-admin/FORMATS.md`, que WP16 et WP24 lisent.
12. **Retrait de l'écriture de `cashless_app` sur `edge_gateway`** : en WP09. La fenêtre entre les lots n'existe que sur la branche, jamais en `main`.

13. **Ordres locaux à deux personnes (décision du porteur du 05/11/2026)** : levée de `STALE` et purge manuelle exigent deux signatures par deux clés nominatives distinctes de responsables du site (clé personnelle sur support distinct). Seules les parties publiques vont sur la passerelle, par le fichier d'enrôlement de WP15. Un ordre vaut 10 minutes, porte un nonce, ne sert qu'une fois et est audité. Une clé perdue se remplace seulement avec le lien du central. Format et vérification : `apps/gateway/src/authority/site-order.ts` (WP17), réutilisé par WP24.

Fichiers ajoutés au § 11 : `packages/ledger-sql/src/migrate.ts`, `apps/api/test/support/db.ts`, `package-lock.json`, `apps/gateway/src/processes/gateway.module.ts`, `apps/gateway/package.json`, `apps/api/src/errors/**`, `apps/api/src/processes/tag-keys.module.ts`, `apps/api/src/processes/maintenance.module.ts`, `apps/api/src/media/lifecycle/deposit.service.ts`, `apps/api/src/media/lifecycle/release.service.ts`, `apps/api/src/offline/batches/batch-intake.ts`, `apps/api/src/offline/processing/offline-operation.processor.ts`, `docs/08-pile-logicielle.md`, `.github/workflows/ledger-tests.yml` (variables d'environnement seulement, hors WP25), `docs/POINTS_OUVERTS.md`, `docs/DECISIONS_ADR.md`, `PRD.md`, `PROMPTS-A-ENVOYER.md` (WP25).
