// Éléments communs aux trois opérations de guichet (WP22) : exécution dans UNE transaction
// (nonce, autorité, personne, idempotence, effet, file, audit de tolérance), lecture de l'état
// répliqué, validation des corps, refus propres à la passerelle.
//
// Ordre dans la transaction de l'opération : nonce et horloge de `created` (`consumeOrThrow`),
// autorité (`assertCanDebit`), personne (conditions R-20 refaites), idempotence (verrou puis
// consultation), règles de l'opération, entrée(s) de file, registre d'idempotence, audit de
// tolérance. Un refus lève AVANT toute écriture ou annule tout : rien ne survit à un échec.
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { Request } from 'express';
import {
  AuthorityRefusal,
  type AuthorityRow,
  type AuthorityService,
} from '../../authority/authority.service';
import type { GatewayClock } from '../../clock/gateway-clock';
import { GatewayTx, type TxClient } from '../../db/gateway-tx';
import { requestDevice, type AuthenticatedDevice } from '../../device-proofs/device-proofs.guard';
import type { NonceStore } from '../../device-proofs/nonce-store';
import { ProblemException } from '../../device-proofs/problem';
import { requestFingerprint, type IdempotencyService } from '../../device/idempotency.service';
import { deviceKey } from '../../device/device-key';
import type { EdgeQueue } from '../../queue/edge-queue';
import {
  requestStaff,
  type CashSessionRow,
  type StaffAuthorization,
  type StaffAuthorizer,
} from '../../staff/staff-token.guard';
import { writeToleranceAudit, type ToleranceRoute } from '../../staff/tolerance-audit';
import { failpoint } from '../../testing/failpoints';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// ---- erreurs ---------------------------------------------------------------------------------

export const validation = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 422, detail });
export const badRequest = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });
export const conflictState = (detail: string): ProblemException =>
  new ProblemException('CONFLICT_STATE', { detail });

/** `409 DEBIT_AUTHORITY_EDGE` rendu par la passerelle elle-même : sans `edge_base_url`, sans boucle. */
export const edgeRefusal = (authorityEpoch: number, detail: string): ProblemException =>
  new ProblemException('DEBIT_AUTHORITY_EDGE', {
    detail,
    extensions: { retryable: false, authority_epoch: authorityEpoch },
  });

/** États sans débit : mêmes codes que le contrat (`gateway-served-operations.md`, « Exclusion »). */
export function authorityProblem(refusal: AuthorityRefusal): ProblemException {
  switch (refusal.code) {
    case 'DEBIT_AUTHORITY_MOVING':
      return new ProblemException('DEBIT_AUTHORITY_MOVING', {
        extensions: { retryable: true, authority_epoch: refusal.authorityEpoch },
      });
    case 'STALE_AUTHORITY_EPOCH':
      return new ProblemException('STALE_AUTHORITY_EPOCH', {
        extensions: { retryable: false, authority_epoch: refusal.authorityEpoch },
      });
    default:
      return new ProblemException('CONFLICT_STATE', {
        detail: refusal.detail ?? 'GATEWAY_NOT_AUTHORITY',
        extensions: { retryable: false },
      });
  }
}

// ---- lecture de corps ------------------------------------------------------------------------

export function asObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw validation(`${what} : objet attendu`);
  }
  return value as Record<string, unknown>;
}

export function positiveAmount(value: unknown, what: string): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw validation(`${what} : entier strictement positif attendu`);
  }
  return BigInt(value);
}

export function uuidField(value: unknown, what: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw validation(`${what} : UUID attendu`);
  return value.toLowerCase();
}

export function timestampField(value: unknown, what: string): string {
  if (typeof value !== 'string' || !TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw validation(`${what} : horodatage RFC 3339 attendu`);
  }
  return value;
}

export interface TapReading {
  nfcUid: string;
  tokenHash: string;
  counter: number;
  keyIndex: number;
  originalitySignature: string | null;
  raw: Record<string, unknown>;
}

/** `TapInput` du contrat (lecture embarquée). `pack_verified` DOIT être vrai. */
export function parseTapInput(value: unknown): TapReading {
  const t = asObject(value, 'tap');
  if (typeof t.nfc_uid !== 'string' || !/^[0-9a-f]{14,20}$/i.test(t.nfc_uid)) {
    throw validation('tap.nfc_uid : UID hexadécimal attendu');
  }
  if (typeof t.token_hash !== 'string' || !HEX64.test(t.token_hash)) {
    throw validation('tap.token_hash : 64 caractères hexadécimaux attendus');
  }
  if (
    !Number.isInteger(t.counter) ||
    (t.counter as number) < 0 ||
    (t.counter as number) > 0xffffff
  ) {
    throw validation('tap.counter : entier de 0 à 16777215 attendu');
  }
  if (
    !Number.isInteger(t.key_index) ||
    (t.key_index as number) < 0 ||
    (t.key_index as number) > 65535
  ) {
    throw validation('tap.key_index : entier de 0 à 65535 attendu');
  }
  if (t.pack_verified !== true) throw validation('tap.pack_verified doit être vrai');
  timestampField(t.occurred_at, 'tap.occurred_at');
  const sig = t.originality_signature;
  if (sig !== undefined && (typeof sig !== 'string' || !HEX64.test(sig))) {
    throw validation('tap.originality_signature : 64 caractères hexadécimaux attendus');
  }
  return {
    nfcUid: t.nfc_uid.toLowerCase(),
    tokenHash: t.token_hash.toLowerCase(),
    counter: t.counter as number,
    keyIndex: t.key_index as number,
    originalitySignature: typeof sig === 'string' ? sig.toLowerCase() : null,
    raw: t,
  };
}

/** `Idempotency-Key` `<serial>:<seq>` : la série est celle du terminal authentifié. */
export function parseIdempotencyKey(
  req: Request,
  device: AuthenticatedDevice,
): { key: string; seq: number } {
  const key = req.header('idempotency-key');
  if (!key) throw new ProblemException('IDEMPOTENCY_KEY_REQUIRED');
  const match = /^(.+):([0-9]{1,15})$/.exec(key);
  if (!match || match[1] !== device.serial) {
    throw badRequest('Idempotency-Key : <série du terminal>:<numéro> attendu');
  }
  const seq = Number(match[2]);
  if (!Number.isSafeInteger(seq) || seq < 1) throw badRequest('Idempotency-Key : numéro invalide');
  // Clé canonique (décision 52) : `<serial>:<seq>` sur 4 chiffres au moins, la forme du central.
  return { key: deviceKey(device.serial, seq), seq };
}

// ---- état répliqué ---------------------------------------------------------------------------

export interface EventSettings {
  eventId: string;
  status: string;
  currency: string;
  activationModes: string[];
  walletLimits: Record<string, unknown>;
  /** `edge_terms` répliqué (décision 36) ; null : inconnu. */
  edgeTerms: Record<string, unknown> | null;
  tapReplayWindowSeconds: number;
}

export async function readEvent(tx: TxClient): Promise<EventSettings> {
  const { rows } = await tx.query<{
    status: string;
    currency: string;
    activation_modes: string[];
    wallet_limits: Record<string, unknown>;
    edge_terms: Record<string, unknown> | null;
    terminal_settings: Record<string, unknown>;
    event_id: string;
  }>(
    `SELECT s.status, s.currency, s.activation_modes, s.wallet_limits, s.edge_terms, s.terminal_settings,
            m.event_id
       FROM edge_event_setting s CROSS JOIN edge_meta m`,
  );
  const row = rows[0];
  if (!row) throw conflictState('EVENT_SETTINGS_UNKNOWN');
  const window = row.terminal_settings?.tap_replay_window_seconds;
  return {
    eventId: row.event_id,
    status: row.status,
    currency: row.currency.trim(),
    activationModes: row.activation_modes,
    walletLimits: row.wallet_limits ?? {},
    edgeTerms: row.edge_terms ?? null,
    tapReplayWindowSeconds: typeof window === 'number' && window > 0 ? window : 120,
  };
}

export function assertEventLive(event: EventSettings): void {
  if (event.status !== 'LIVE') throw new ProblemException('EVENT_CLOSING');
}

export interface MediaRow {
  token_hash: Buffer;
  media_id: string | null;
  wallet_id: string | null;
  status: string;
  batch_id: string | null;
  batch_status: string | null;
  uid: Buffer | null;
  counter_last: string;
  originality_sig_sha256: Buffer | null;
}

const MEDIA_COLUMNS = `token_hash, media_id, wallet_id, status, batch_id, batch_status, uid,
  counter_last, originality_sig_sha256`;

export async function mediaByTokenHash(tx: TxClient, tokenHashHex: string): Promise<MediaRow> {
  const { rows } = await tx.query<MediaRow>(
    `SELECT ${MEDIA_COLUMNS} FROM edge_media WHERE token_hash = $1`,
    [Buffer.from(tokenHashHex, 'hex')],
  );
  if (!rows[0]) throw new ProblemException('MEDIA_UNKNOWN');
  return rows[0];
}

export async function mediaById(tx: TxClient, mediaId: string): Promise<MediaRow> {
  const { rows } = await tx.query<MediaRow>(
    `SELECT ${MEDIA_COLUMNS} FROM edge_media WHERE media_id = $1`,
    [mediaId],
  );
  if (!rows[0]) throw new ProblemException('MEDIA_UNKNOWN');
  return rows[0];
}

/** Bracelet inutilisable pour une recharge ou une caution : le code du contrat selon son statut. */
export function assertMediaActive(media: MediaRow): void {
  if (media.media_id === null) throw new ProblemException('MEDIA_STATE_INVALID');
  switch (media.status) {
    case 'ACTIVE':
      return;
    case 'SUSPENDED':
    case 'BLACKLISTED':
      throw new ProblemException('MEDIA_BLOCKED');
    case 'RELEASED':
      throw new ProblemException('MEDIA_RELEASED');
    case 'REPLACED':
      throw new ProblemException('MEDIA_REPLACED');
    case 'RETIRED':
    case 'DESTROYED':
      throw new ProblemException('MEDIA_RETIRED');
    default:
      throw new ProblemException('MEDIA_NOT_ACTIVATED');
  }
}

/** Lecture embarquée : UID et compteur contrôlés contre la copie du bracelet. */
export function assertTapMatchesMedia(tap: TapReading, media: MediaRow): void {
  if (media.uid !== null && media.uid.toString('hex') !== tap.nfcUid) {
    throw new ProblemException('MEDIA_UID_MISMATCH');
  }
  if (tap.counter < Number(media.counter_last)) throw new ProblemException('MEDIA_CLONE_SUSPECTED');
}

/** Résolution d'un `tap_id` local (R-18) ; le passage est consommé par l'opération qui le cite. */
export async function resolveTapId(
  tx: TxClient,
  tapId: unknown,
  device: AuthenticatedDevice,
  event: EventSettings,
  now: Date,
): Promise<{ tapId: number; tokenHash: string }> {
  if (!Number.isSafeInteger(tapId) || (tapId as number) < 1) throw validation('tap_id invalide');
  const { rows } = await tx.query<{
    token_hash: Buffer;
    device_id: string;
    result: string;
    consumed_by_edge_seq: string | null;
    created_at: Date;
  }>(
    `SELECT token_hash, device_id, result, consumed_by_edge_seq, created_at
       FROM edge_tap WHERE tap_id = $1 FOR UPDATE`,
    [tapId],
  );
  const row = rows[0];
  if (!row || row.device_id !== device.deviceId || row.result !== 'OK') {
    throw new ProblemException('TAP_UNUSABLE');
  }
  if (row.consumed_by_edge_seq !== null) throw new ProblemException('TAP_ALREADY_USED');
  if (now.getTime() - row.created_at.getTime() > event.tapReplayWindowSeconds * 1000) {
    throw new ProblemException('TAP_EXPIRED');
  }
  return { tapId: tapId as number, tokenHash: row.token_hash.toString('hex') };
}

export async function consumeTap(tx: TxClient, tapId: number, edgeSeq: number): Promise<void> {
  await tx.query(
    'UPDATE edge_tap SET consumed_by_edge_seq = $2 WHERE tap_id = $1 AND consumed_by_edge_seq IS NULL',
    [tapId, edgeSeq],
  );
}

/**
 * Session de caisse utilisable sur la passerelle : `OPEN`, `usable_on_edge` (ouverte et répliquée
 * AVANT la bascule), du terminal de la requête. Aucune exemption (C-005). `provided` : la session
 * citée par la requête, qui DOIT être celle-là.
 */
export function requireUsableSession(
  device: AuthenticatedDevice,
  session: CashSessionRow | null,
  provided: unknown,
): CashSessionRow {
  if (
    session === null ||
    session.device_id !== device.deviceId ||
    session.status !== 'OPEN' ||
    session.closed_at !== null ||
    !session.usable_on_edge
  ) {
    throw conflictState('NO_REPLICATED_CASH_SESSION');
  }
  if (provided !== undefined && provided !== null) {
    if (typeof provided !== 'string' || provided.toLowerCase() !== session.cash_session_id) {
      throw conflictState('CASH_SESSION_MISMATCH');
    }
  }
  return session;
}

// ---- exécution d'une opération de guichet ----------------------------------------------------

export interface CounterDeps {
  gatewayTx: GatewayTx;
  nonces: NonceStore;
  authority: AuthorityService;
  staff: StaffAuthorizer;
  idempotency: IdempotencyService;
  queue: EdgeQueue;
  clock: GatewayClock;
}

export interface OperationContext {
  tx: TxClient;
  deps: CounterDeps;
  device: AuthenticatedDevice;
  now: Date;
  key: string;
  seq: number;
  authority: AuthorityRow;
  staff: StaffAuthorization;
}

export interface OperationResult {
  status: number;
  body: unknown;
  /** Premier `edge_seq` écrit (celui de l'audit de tolérance) ; `null` : rien n'est entré en file. */
  edgeSeq: number | null;
}

export interface RunOptions {
  route: ToleranceRoute;
  req: Request;
  res: Response;
  body: unknown;
  /** Consultation de l'époque demandée (`X-Authority-Epoch`) : seulement quand la route la déclare. */
  epoch: number | null;
  citedSessionId?: string | null;
}

export function readEpochHeader(req: Request): number | null {
  const raw = req.header('x-authority-epoch');
  if (raw === undefined) return null;
  if (!/^\d{1,15}$/.test(raw)) throw badRequest('X-Authority-Epoch : entier attendu');
  return Number(raw);
}

export async function runCounterOperation(
  deps: CounterDeps,
  options: RunOptions,
  handler: (ctx: OperationContext) => Promise<OperationResult>,
): Promise<unknown> {
  const { req, res, route } = options;
  const device = requestDevice(req);
  const principal = requestStaff(req);
  const { key, seq } = parseIdempotencyKey(req, device);
  const fingerprint = requestFingerprint(req.method, req.path, device.deviceId, options.body);
  const outcome = await deps.gatewayTx.run(async (tx) => {
    await deps.nonces.consumeOrThrow(tx, device.deviceId, device.proof);
    const now = deps.clock.now();
    await (deps.clock as { touchFloor?: (t: TxClient) => Promise<void> }).touchFloor?.(tx);
    let authority: AuthorityRow;
    try {
      authority = await deps.authority.assertCanDebit(options.epoch, tx);
    } catch (error) {
      if (error instanceof AuthorityRefusal) throw authorityProblem(error);
      throw error;
    }
    const staff = await deps.staff.authorize(tx, principal, {
      device,
      route,
      citedSessionId: options.citedSessionId,
    });
    const found = await deps.idempotency.lookup(tx, device.deviceId, key, fingerprint);
    if (found.hit) {
      return { replayed: true, status: found.statusCode, body: found.response };
    }
    const result = await handler({ tx, deps, device, now, key, seq, authority, staff });
    await deps.idempotency.record(tx, {
      deviceId: device.deviceId,
      key,
      fingerprint,
      statusCode: result.status,
      response: result.body,
      edgeSeq: result.edgeSeq,
      at: now,
    });
    if (staff.tolerated !== null) {
      if (result.edgeSeq === null) throw new ProblemException('INTERNAL_ERROR');
      await writeToleranceAudit(tx, staff.tolerated, result.edgeSeq);
    }
    return { replayed: false, status: result.status, body: result.body };
  });
  // Point d'arrêt : tout est commité, rien n'est encore répondu.
  await failpoint('after-local-write-before-reply');
  if (outcome.replayed) res.setHeader('Idempotency-Replayed', 'true');
  res.status(outcome.status);
  return outcome.body;
}

export function localTransactionId(): string {
  return randomUUID();
}

export function toSafeNumber(value: bigint): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw new ProblemException('INTERNAL_ERROR');
  return Number(value);
}

/** Cherche une opération de guichet non rejetée du même type pour ce bracelet (anti double effet). */
export async function liveGuichetOperation(
  tx: TxClient,
  type: 'ACTIVATION' | 'DEPOSIT_CASH',
  mediaId: string,
): Promise<{ edgeSeq: number; originKey: string } | null> {
  const { rows } = await tx.query<{ edge_seq: string; origin_key: string }>(
    `SELECT edge_seq, origin_key FROM edge_op
      WHERE type = $1 AND operation -> 'edge_guichet' ->> 'media_id' = $2
        AND central_status NOT IN ('REJECTED', 'VOID')
      ORDER BY edge_seq LIMIT 1`,
    [type, mediaId],
  );
  return rows[0] ? { edgeSeq: Number(rows[0].edge_seq), originKey: rows[0].origin_key } : null;
}
