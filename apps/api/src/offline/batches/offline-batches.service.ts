// Réception d'un lot hors ligne et lecture de son résultat (mission 7, lot WP18 ; FR-013, FR-014, FR-029, FR-030,
// NFR-013 ; contracts/batches.md). Dix contrôles d'entrée dans l'ordre du contrat, puis verrou de lot (pool dédié),
// ouverture, boucle sur le processeur, clôture. Un refus d'avant ouverture (400, 409, 413) est audité dans une
// transaction à part qui ne masque jamais le refus.
import { Inject, Injectable } from '@nestjs/common';
import { AuditService, type AuditAction, type AuditContext } from '../../audit/audit.service';
import { LOCK_BUSY } from '../../db/session-lock';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import type { DeviceContext } from '../../device-identity/device-identity.port';
import { ProblemException } from '../../errors/problem';
import { resolveProblem } from '../../errors/problem.filter';
import { BatchLockPool, POOL_FULL } from './batch-lock-pool';
import {
  checkAuthority,
  checkBindings,
  checkContinuity,
  checkEpoch,
  checkSignature,
  parseBatchShape,
} from './batch-intake';
import { verifyChain } from './batch-chain';
import { BatchRunner, inProgress } from './batch-runner';
import {
  MAX_BATCH_BYTES,
  OFFLINE_BATCH_LOCK,
  SEQ_FIELDS,
  type BatchOpening,
  type OfflineBatchResult,
  type ParsedBatch,
  type ParsedOperation,
} from './batch.types';
import { parseWithSafeIntegers } from './raw-json';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TerminalRow {
  serial: string;
  public_key: Buffer | null;
  ledger_id: string | null;
  authority_epoch: number | null;
  debit_authority: string | null;
  moving: boolean;
}

export interface SubmitArgs {
  device: DeviceContext;
  /** Octets bruts du corps (posés par `batch-body.ts`). */
  rawBody: Buffer | undefined;
  tooLarge: boolean;
  idempotencyKey: string | undefined;
  epochHeader: string | undefined;
  audit: AuditContext;
}

export interface SubmitOutcome {
  body: OfflineBatchResult;
  /** Lot déjà traité jusqu'au bout (`COMPLETED` ou abandonné) : rendu tel quel, `Idempotency-Replayed: true`. */
  replayed: boolean;
}

export type ReadOutcome =
  | { kind: 'DONE'; body: OfflineBatchResult }
  | { kind: 'PROCESSING' }
  | { kind: 'UNKNOWN' };

/** Identifiant du lot pour l'audit, même si le schéma est faux (jamais une valeur non uuid). */
function batchIdHint(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const header = (parsed as { header?: unknown }).header;
  if (typeof header !== 'object' || header === null) return null;
  const id = (header as { batch_id?: unknown }).batch_id;
  return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
}

@Injectable()
export class OfflineBatchesService {
  constructor(
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    private readonly runner: BatchRunner,
    @Inject(OFFLINE_BATCH_LOCK) private readonly locks: BatchLockPool,
  ) {}

  async submit(args: SubmitArgs): Promise<SubmitOutcome> {
    const { device } = args;
    let batchId: string | null = null;
    try {
      // 1. Taille, avant tout JSON.parse.
      if (args.tooLarge || (args.rawBody !== undefined && args.rawBody.length > MAX_BATCH_BYTES))
        throw new ProblemException('BATCH_TOO_LARGE', { status: 413 });
      if (args.rawBody === undefined || args.rawBody.length === 0)
        throw new ProblemException('VALIDATION_FAILED', {
          status: 400,
          detail: 'Corps du lot absent.',
        });
      // 2. JSON, numéros lus sur le texte source.
      const parsed = parseWithSafeIntegers(args.rawBody.toString('utf8'), SEQ_FIELDS);
      batchId = batchIdHint(parsed);
      // 3. Schéma.
      const batch = parseBatchShape(parsed);
      batchId = batch.header.batchId;
      const terminal = await this.readTerminal(device);
      // 4 à 7, dans l'ordre du contrat.
      checkBindings(batch, {
        idempotencyKey: args.idempotencyKey,
        epochHeader: args.epochHeader,
        serial: terminal.serial,
        ledgerId: terminal.ledger_id,
      });
      checkEpoch(batch, terminal.authority_epoch ?? 0);
      checkSignature(batch, terminal.public_key);
      checkContinuity(batch);
      // 8. Chaîne recalculée par le serveur.
      const chain = verifyChain(batch);
      if (!chain.consistent) {
        await this.recordBroken(device, batch, terminal, chain, args.rawBody.length);
        throw new ProblemException('CHAIN_BROKEN');
      }
      // 9. Autorité de débit.
      checkAuthority(terminal.debit_authority, terminal.moving);
      // 10. Verrou, ouverture, boucle, clôture.
      const operations: ParsedOperation[] = batch.operations.map((op, i) => ({
        seq: op.seq,
        raw: op.raw,
        type: op.type,
        contentSha256: chain.opHashes[i]!,
      }));
      return await this.process(args, batch, terminal, chain.opHashes, operations);
    } catch (error) {
      await this.auditRefusal(args, batchId, error);
      throw error;
    }
  }

  private async process(
    args: SubmitArgs,
    batch: ParsedBatch,
    terminal: TerminalRow,
    opHashes: Buffer[],
    operations: ParsedOperation[],
  ): Promise<SubmitOutcome> {
    const { device } = args;
    const { header } = batch;
    const lock = await this.locks.acquire(header.batchId);
    if (lock === LOCK_BUSY) throw inProgress();
    if (lock === POOL_FULL)
      throw new ProblemException('SERVICE_UNAVAILABLE', { headers: { 'Retry-After': '5' } });
    try {
      const opened = await this.runner.open(
        device.operatorId,
        {
          batchId: header.batchId,
          deviceId: device.deviceId,
          ledgerId: terminal.ledger_id!,
          seqFrom: header.seqFrom,
          prevChainHash: header.prevChainHash,
          opHashes,
          lastChainHash: header.lastChainHash,
          signature: Buffer.from(batch.signature, 'base64'),
          sizeBytes: args.rawBody!.length,
        },
        (client) =>
          this.record(client, args, 'OFFLINE_BATCH_RECEIVED', header.batchId, {
            device_id: device.deviceId,
            count: operations.length,
            seq_from: Number(header.seqFrom),
            seq_to: Number(header.seqTo),
          }),
      );
      if (opened.status === 'REJECTED' && opened.rejectReason === 'CHAIN_BROKEN')
        throw new ProblemException('CHAIN_BROKEN');
      if (opened.status === 'REJECTED' || opened.status === 'COMPLETED') {
        const body = await this.runner.response(
          device.operatorId,
          header.batchId,
          opened.status === 'REJECTED',
        );
        if (!body) throw new ProblemException('NOT_FOUND');
        return { body, replayed: true };
      }
      const ctx: BatchOpening = {
        batchId: header.batchId,
        deviceId: device.deviceId,
        operatorId: device.operatorId,
        ledgerId: terminal.ledger_id!,
        serial: terminal.serial,
        receivedAt: opened.receivedAt,
        receivedVia: 'DEVICE',
        importId: null,
        authorityEpoch: header.authorityEpoch,
      };
      const { abandoned } = await this.runner.run(ctx, operations);
      if (!abandoned) await this.runner.complete(device.operatorId, header.batchId);
      const body = await this.runner.response(device.operatorId, header.batchId, abandoned);
      if (!body) throw new ProblemException('NOT_FOUND');
      return { body, replayed: false };
    } finally {
      await lock.release();
    }
  }

  /**
   * Contrôle 8, lot incohérent : les empreintes RECALCULÉES sont quand même passées à `open_offline_batch`, qui
   * constate l'écart, écrit le lot `REJECTED CHAIN_BROKEN` et l'anomalie. Rien d'autre n'est persisté ; toute erreur
   * de cette ouverture est sans objet (le refus `409 CHAIN_BROKEN` est rendu dans tous les cas).
   */
  private async recordBroken(
    device: DeviceContext,
    batch: ParsedBatch,
    terminal: TerminalRow,
    chain: ReturnType<typeof verifyChain>,
    sizeBytes: number,
  ): Promise<void> {
    try {
      await this.runner.open(device.operatorId, {
        batchId: batch.header.batchId,
        deviceId: device.deviceId,
        ledgerId: terminal.ledger_id!,
        seqFrom: batch.header.seqFrom,
        prevChainHash: batch.header.prevChainHash,
        opHashes: chain.opHashes,
        lastChainHash: chain.lastForOpen,
        signature: Buffer.from(batch.signature, 'base64'),
        sizeBytes,
      });
    } catch {
      // Sans objet : voir ci-dessus.
    }
  }

  /** Terminal tel que la base le connaît : série, clé publique, grand livre de son événement, autorité de débit. */
  private async readTerminal(device: DeviceContext): Promise<TerminalRow> {
    const row = await this.tx.run(device.operatorId, async (client) => {
      const { rows } = await client.query<TerminalRow>(
        `SELECT d.serial, d.public_key, l.id AS ledger_id, l.authority_epoch, l.debit_authority,
                COALESCE((SELECT true FROM debit_authority_handover h
                           WHERE h.ledger_id = l.id AND h.direction = 'TO_CENTRAL'
                             AND h.status IN ('RELEASE_REQUESTED', 'RELEASING') LIMIT 1), false)
                  AS moving
           FROM device d
           LEFT JOIN event e ON e.id = d.event_id
           LEFT JOIN ledger l ON l.scope_type = 'EVENT' AND l.scope_id = e.id AND l.currency = e.currency
          WHERE d.id = $1`,
        [device.deviceId],
      );
      return rows[0] ?? null;
    });
    if (!row) throw new ProblemException('NOT_FOUND');
    return row;
  }

  /** `GET /offline-batches/{batch_id}` : lot du terminal authentifié seulement (`404` neutre sinon). */
  async read(device: DeviceContext, rawBatchId: string): Promise<ReadOutcome> {
    if (!UUID.test(rawBatchId)) return { kind: 'UNKNOWN' };
    const batchId = rawBatchId.toLowerCase();
    const state = await this.runner.readState(device.operatorId, batchId);
    if (!state || state.deviceId !== device.deviceId) return { kind: 'UNKNOWN' };
    if (state.status === 'PROCESSING') return { kind: 'PROCESSING' };
    if (state.status === 'REJECTED' && state.rejectReason !== 'ABANDONED')
      return { kind: 'UNKNOWN' };
    const body = await this.runner.response(
      device.operatorId,
      batchId,
      state.status === 'REJECTED',
    );
    return body ? { kind: 'DONE', body } : { kind: 'UNKNOWN' };
  }

  // ---------------------------------------------------------------------------------------------------- audit

  private record(
    client: TxClient,
    args: Pick<SubmitArgs, 'device' | 'audit'>,
    action: AuditAction,
    batchId: string | null,
    after: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(client, {
      ...args.audit,
      operatorId: args.device.operatorId,
      action,
      objectType: 'OFFLINE_BATCH',
      objectId: batchId ?? undefined,
      after,
    });
  }

  /** Refus 4xx d'avant ouverture : ligne `OFFLINE_BATCH_REFUSED`, transaction à part, jamais d'exception. */
  private async auditRefusal(
    args: SubmitArgs,
    batchId: string | null,
    error: unknown,
  ): Promise<void> {
    try {
      const problem = resolveProblem(error);
      if (problem.status < 400 || problem.status >= 500) return;
      await this.tx.run(args.device.operatorId, (client) =>
        this.record(client, args, 'OFFLINE_BATCH_REFUSED', batchId, {
          code: problem.code,
          status: problem.status,
          device_id: args.device.deviceId,
        }),
      );
    } catch {
      // Un échec d'audit ne masque jamais le refus.
    }
  }
}
