// `reversePayment` (T095) : annulation, par le VENDEUR de la vente, d'une vente décidée par CETTE
// passerelle. Même ordre d'étapes que `PaymentsService.write` (une transaction, preuves,
// idempotence, autorité, contrôles, file, COMMIT).
//
// A08 : une annulation ne crée pas d'argent. Le montant est celui de la vente d'origine, jamais
// celui du corps ; le crédit rendu au portefeuille est exactement ce qui avait été prélevé (parts
// payée et offerte gardées dans `edge_idempotency.sale`, indépendantes de la purge des deltas) ;
// une vente ne s'annule qu'une fois (verrou par vente, puis recherche de l'annulation existante).
// Fenêtre : mesurée sur `GatewayClock` ; une horloge en arrière de l'heure d'enregistrement de la
// vente refuse aussi (jamais une fenêtre rallongée par un recul d'horloge).
// `X-Approval-Token` n'est PAS servi (interfaces.md § 12.10) : présenté, il est refusé
// `403 APPROVAL_INVALID` ; c'est un renforcement (aucun vérificateur d'approbation fabriqué).
import { Inject, Injectable } from '@nestjs/common';
import {
  AUTHORITY,
  AuthorityRefusal,
  type AuthorityService,
} from '../../authority/authority.service';
import { GATEWAY_CLOCK, type GatewayClock } from '../../clock/gateway-clock';
import { GatewayTx, type TxClient } from '../../db/gateway-tx';
import type { AuthenticatedDevice } from '../../device-proofs/device-proofs.guard';
import { NonceStore } from '../../device-proofs/nonce-store';
import { ProblemException } from '../../device-proofs/problem';
import { IdempotencyService, requestFingerprint } from '../../device/idempotency.service';
import { EDGE_QUEUE, type EdgeQueuePort } from '../../queue/edge-queue';
import { ReplicationService } from '../../replication/replication.service';
import { failpoint } from '../../testing/failpoints';
import type { SaleResponse } from './payments.service';
import {
  authorityProblem,
  dateTimeField,
  finalRefusal,
  invalid,
  isUuid,
  iso,
  newTransactionId,
  objectBody,
  parseAuthorityEpoch,
  parseIdempotencyKey,
  readEventSettings,
  resolveOperationTime,
  restoreRefusal,
  storeRefusal,
  type EventSettings,
  type StoredRefusal,
} from './sales-support';

const REASONS = ['INPUT_ERROR', 'CUSTOMER_CANCELLED', 'PRODUCT_UNAVAILABLE', 'DUPLICATE', 'OTHER'];

interface ReversalInput {
  occurredAt: Date;
  vendorSessionId: string | null;
}

export function parseReversal(raw: unknown): ReversalInput {
  const body = objectBody(raw);
  // La preuve du superviseur ne passe pas par le corps (openapi.yaml).
  if (body.supervisor_pin_proof !== undefined)
    throw invalid('supervisor_pin_proof : refusé dans le corps.', 422);
  if (typeof body.reason !== 'string' || !REASONS.includes(body.reason))
    throw invalid('reason : valeur hors énumération.');
  if (body.comment !== undefined && (typeof body.comment !== 'string' || body.comment.length > 500))
    throw invalid('comment : 500 caractères au plus.');
  const occurredAt = dateTimeField(body, 'occurred_at');
  if (body.vendor_session_id !== undefined && !isUuid(body.vendor_session_id))
    throw invalid('vendor_session_id : uuid attendu.');
  return { occurredAt, vendorSessionId: (body.vendor_session_id as string | undefined) ?? null };
}

interface SaleRow {
  device_id: string;
  idempotency_key: string;
  response: Record<string, unknown>;
  sale: { wallet_id: string; paid: string; promo: string; seq: number } | null;
  edge_seq: string;
  operation: Record<string, unknown>;
  recorded_at: Date;
  central_transaction_id: string | null;
}

@Injectable()
export class ReversalsService {
  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(AUTHORITY) private readonly authority: AuthorityService,
    @Inject(EDGE_QUEUE) private readonly queue: EdgeQueuePort,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(NonceStore) private readonly nonces: NonceStore,
    @Inject(ReplicationService) private readonly replication: ReplicationService,
  ) {}

  async reverse(
    device: AuthenticatedDevice,
    args: {
      transactionId: string;
      body: unknown;
      idempotencyKey: string | undefined;
      authorityEpoch: string | undefined;
      approvalToken: string | undefined;
    },
  ): Promise<SaleResponse> {
    if (!isUuid(args.transactionId)) throw new ProblemException('NOT_FOUND');
    const input = parseReversal(args.body);
    const { key, seq } = parseIdempotencyKey(args.idempotencyKey, device.serial);
    const epoch = parseAuthorityEpoch(args.authorityEpoch);
    // Aucun vérificateur d'approbation : un jeton présenté est refusé, rien n'est écrit.
    if (args.approvalToken !== undefined)
      throw new ProblemException('APPROVAL_INVALID', { status: 403 });
    const fingerprint = requestFingerprint(
      'POST',
      `/v1/payments/${args.transactionId.toLowerCase()}/reversal`,
      device.deviceId,
      args.body,
    );
    let outcome: { response: SaleResponse } | { refusal: ProblemException };
    try {
      outcome = await this.gatewayTx.run((tx) =>
        this.write(tx, device, {
          saleId: args.transactionId.toLowerCase(),
          input,
          key,
          seq,
          epoch,
          fingerprint,
        }),
      );
    } catch (error) {
      if (error instanceof AuthorityRefusal) {
        if (error.code === 'STALE_AUTHORITY_EPOCH' && epoch > error.authorityEpoch)
          await this.authority.observeEpoch(epoch, 'request').catch(() => undefined);
        throw authorityProblem(error);
      }
      throw error;
    }
    await failpoint('after-local-write-before-reply');
    if ('refusal' in outcome) throw outcome.refusal;
    return outcome.response;
  }

  private async write(
    tx: TxClient,
    device: AuthenticatedDevice,
    ctx: {
      saleId: string;
      input: ReversalInput;
      key: string;
      seq: number;
      epoch: number;
      fingerprint: Buffer;
    },
  ): Promise<{ response: SaleResponse } | { refusal: ProblemException }> {
    await this.nonces.consumeOrThrow(tx, device.deviceId, device.proof);
    const found = await this.idempotency.lookup(tx, device.deviceId, ctx.key, ctx.fingerprint);
    if (found.hit) {
      if (found.statusCode >= 400)
        return { refusal: restoreRefusal(found.response as StoredRefusal) };
      return {
        response: {
          status: found.statusCode,
          body: found.response as Record<string, unknown>,
          replayed: true,
        },
      };
    }
    await this.authority.assertCanDebit(ctx.epoch, tx);

    const now = this.clock.now();
    const time = resolveOperationTime(ctx.input.occurredAt, now);
    try {
      const settings = await readEventSettings(tx);
      if (!settings) throw new ProblemException('CONFLICT_STATE', { detail: 'EVENT_UNKNOWN' });
      return { response: await this.commit(tx, device, ctx, settings, time.occurredAt, now) };
    } catch (error) {
      if (!(error instanceof ProblemException)) throw error;
      const refusal = finalRefusal(error);
      const row = await this.queue.append(
        tx,
        {
          originKey: ctx.key,
          type: 'VOID',
          authorizedMode: 'EDGE_ONLINE',
          deviceSerial: device.serial,
          deviceId: device.deviceId,
          operation: {
            seq: ctx.seq,
            type: 'VOID',
            occurred_at: iso(time.occurredAt),
            void_reason: 'ONLINE_REJECTED',
          },
          occurredAt: time.occurredAt,
          recordedAt: now,
        },
        [],
      );
      await this.idempotency.record(tx, {
        deviceId: device.deviceId,
        key: ctx.key,
        fingerprint: ctx.fingerprint,
        statusCode: refusal.status,
        response: storeRefusal(refusal),
        edgeSeq: row.edgeSeq,
        at: now,
      });
      return { refusal };
    }
  }

  private async commit(
    tx: TxClient,
    device: AuthenticatedDevice,
    ctx: {
      saleId: string;
      input: ReversalInput;
      key: string;
      seq: number;
      fingerprint: Buffer;
    },
    settings: EventSettings,
    occurredAt: Date,
    now: Date,
  ): Promise<SaleResponse> {
    if (settings.status !== 'LIVE') throw new ProblemException('EVENT_CLOSING');
    // Session de vendeur de CE terminal (la vente est annulée par son vendeur).
    const sessionId = ctx.input.vendorSessionId;
    if (sessionId === null) throw new ProblemException('VENDOR_SESSION_INVALID');
    const vendor = await tx.query<{ vendor_id: string; display_name: string }>(
      `SELECT v.vendor_id, v.display_name
         FROM edge_vendor_session s JOIN edge_vendor v ON v.vendor_id = s.vendor_id
        WHERE s.vendor_session_id = $1 AND s.device_id = $2 AND s.closed_at IS NULL
          AND s.expires_at > $3 AND v.status = 'ACTIVE' AND NOT v.blocked`,
      [sessionId, device.deviceId, now],
    );
    if (!vendor.rows[0]) throw new ProblemException('VENDOR_SESSION_INVALID');

    // Une annulation à la fois par vente, puis lecture de la vente.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 22))', [ctx.saleId]);
    const { rows } = await tx.query<SaleRow>(
      `SELECT i.device_id, i.idempotency_key, i.response, i.sale, o.edge_seq, o.operation,
              o.recorded_at, o.central_transaction_id
         FROM edge_idempotency i JOIN edge_op o ON o.edge_seq = i.edge_seq
        WHERE i.status_code = 201 AND i.response ->> 'transaction_id' = $1`,
      [ctx.saleId],
    );
    const sale = rows[0];
    if (!sale) throw new ProblemException('NOT_FOUND');
    if (
      sale.response.type !== 'PURCHASE' ||
      sale.device_id !== device.deviceId ||
      sale.sale === null ||
      (sale.response.vendor as { vendor_id?: string } | undefined)?.vendor_id !==
        vendor.rows[0].vendor_id
    )
      throw new ProblemException('REVERSAL_NOT_ALLOWED');
    const reversed = await tx.query(
      `SELECT 1 FROM edge_idempotency WHERE status_code = 201 AND response ->> 'reverses_id' = $1`,
      [ctx.saleId],
    );
    if (reversed.rowCount !== 0) throw new ProblemException('ALREADY_REVERSED');
    const elapsedMs = now.getTime() - sale.recorded_at.getTime();
    if (elapsedMs < 0 || elapsedMs > settings.reversalWindowMinutes * 60_000)
      throw new ProblemException('REVERSAL_WINDOW_EXPIRED');

    // Jamais plus que la vente d'origine.
    const paid = BigInt(sale.sale.paid);
    const promo = BigInt(sale.sale.promo);
    const amount = BigInt(sale.response.amount as number);
    if (paid < 0n || promo < 0n || paid + promo !== amount)
      throw new ProblemException('REVERSAL_NOT_ALLOWED');

    const op: Record<string, unknown> = {
      seq: ctx.seq,
      type: 'REVERSAL',
      occurred_at: iso(occurredAt),
      amount: Number(amount),
      currency: settings.currency,
      // Le central rejoue la vente d'origine par son numéro, ou par son identifiant quand elle y
      // est déjà écrite.
      ...(sale.central_transaction_id === null
        ? { reverses_seq: sale.sale.seq }
        : { reverses_transaction_id: sale.central_transaction_id }),
      // Preuve du bracelet : la lecture de la vente annulée (aucune nouvelle lecture n'existe).
      tap: sale.operation.tap,
      vendor_session_id: sessionId,
      edge_decision: { status: 'ACCEPTED', charged_to_wallet: Number(amount), shortfall_amount: 0 },
    };
    const row = await this.queue.append(
      tx,
      {
        originKey: ctx.key,
        type: 'REVERSAL',
        authorizedMode: 'EDGE_ONLINE',
        deviceSerial: device.serial,
        deviceId: device.deviceId,
        operation: op,
        occurredAt,
        recordedAt: now,
      },
      [{ walletId: sale.sale.wallet_id, paidDelta: paid, promoDelta: promo }],
    );
    const balance = await this.replication.effectiveBalance(tx, sale.sale.wallet_id);
    const body: Record<string, unknown> = {
      transaction_id: newTransactionId(),
      idempotency_key: ctx.key,
      type: 'REVERSAL',
      status: 'SUCCEEDED',
      reverses_id: ctx.saleId,
      amount: Number(amount),
      currency: settings.currency,
      occurred_at: iso(occurredAt),
      recorded_at: iso(now),
      media_id: sale.response.media_id ?? null,
      wallet_id: sale.sale.wallet_id,
      balance_after: {
        spendable: Number(balance.paid + balance.promo),
        paid: Number(balance.paid),
        promo: Number(balance.promo),
      },
      vendor: { vendor_id: vendor.rows[0].vendor_id, display_name: vendor.rows[0].display_name },
      channel: sale.response.channel,
    };
    await this.idempotency.record(tx, {
      deviceId: device.deviceId,
      key: ctx.key,
      fingerprint: ctx.fingerprint,
      statusCode: 201,
      response: body,
      edgeSeq: row.edgeSeq,
      at: now,
    });
    return { status: 201, body, replayed: false };
  }
}
