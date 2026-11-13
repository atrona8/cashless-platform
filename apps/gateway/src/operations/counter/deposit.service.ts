// `takeDeposit` en espèces sur la passerelle (FR-016, ADR-52).
//
//  - `FROM_BALANCE` (aucun `payment`) ou `payment.method` autre que `CASH` : `409
//    DEBIT_AUTHORITY_EDGE`, `retryable: false`, sans numéro consommé ;
//  - session de caisse `OPEN` DU TERMINAL (`usable_on_edge`) et `cash_session_id` concordant, sinon
//    `409 CONFLICT_STATE` ; le compte de caisse est celui de la session, jamais de la requête ;
//  - idempotent si la caution est déjà `HELD` (état local ou entrée de file non rejetée) ;
//  - file : `DEPOSIT_CASH` / `EDGE_ONLINE`, `edge_guichet` (`media_id`, `deposit_amount`,
//    `cash_desk_account_id`), clé d'origine = `Idempotency-Key`.
// Le montant et l'état de la caution viennent de `edge_terms` répliqué (décision 36, voir
// `deposit-terms.ts`) : inconnus, le chemin refuse (`DEPOSIT_TERMS_UNKNOWN`).
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUTHORITY, AuthorityService } from '../../authority/authority.service';
import { GATEWAY_CLOCK, type GatewayClock } from '../../clock/gateway-clock';
import { GatewayTx } from '../../db/gateway-tx';
import { NonceStore } from '../../device-proofs/nonce-store';
import { ProblemException } from '../../device-proofs/problem';
import { IdempotencyService } from '../../device/idempotency.service';
import { EDGE_QUEUE, EdgeQueue } from '../../queue/edge-queue';
import { StaffAuthorizer } from '../../staff/staff-token.guard';
import {
  asObject,
  assertEventLive,
  assertMediaActive,
  assertTapMatchesMedia,
  conflictState,
  consumeTap,
  edgeRefusal,
  liveGuichetOperation,
  localTransactionId,
  mediaById,
  parseTapInput,
  readEvent,
  requireUsableSession,
  resolveTapId,
  runCounterOperation,
  toSafeNumber,
  uuidField,
  validation,
  type CounterDeps,
  type OperationContext,
  type OperationResult,
} from './counter-common';
import { DEPOSIT_TERMS, replicatedDepositTerms, type DepositTermsPort } from './deposit-terms';

@Injectable()
export class DepositService {
  private readonly deps: CounterDeps;
  private readonly terms: DepositTermsPort;

  constructor(
    @Inject(GatewayTx) gatewayTx: GatewayTx,
    @Inject(NonceStore) nonces: NonceStore,
    @Inject(AUTHORITY) authority: AuthorityService,
    @Inject(StaffAuthorizer) staff: StaffAuthorizer,
    @Inject(IdempotencyService) idempotency: IdempotencyService,
    @Inject(EDGE_QUEUE) queue: EdgeQueue,
    @Inject(GATEWAY_CLOCK) clock: GatewayClock,
    @Optional() @Inject(DEPOSIT_TERMS) terms?: DepositTermsPort,
  ) {
    this.deps = { gatewayTx, nonces, authority, staff, idempotency, queue, clock };
    this.terms = terms ?? replicatedDepositTerms;
  }

  async take(req: Request, res: Response, mediaIdParam: string, body: unknown): Promise<unknown> {
    const mediaId = uuidField(mediaIdParam, 'media_id');
    const input = asObject(body ?? {}, 'corps');
    return runCounterOperation(
      this.deps,
      {
        route: 'takeDeposit',
        req,
        res,
        body,
        epoch: null,
        citedSessionId: typeof input.cash_session_id === 'string' ? input.cash_session_id : null,
      },
      (ctx) => this.apply(ctx, mediaId, input),
    );
  }

  private async apply(
    ctx: OperationContext,
    mediaIdParam: string,
    input: Record<string, unknown>,
  ): Promise<OperationResult> {
    const { tx, device, now } = ctx;
    const event = await readEvent(tx);
    assertEventLive(event);
    const media = await mediaById(tx, mediaIdParam);
    const mediaId = media.media_id!;

    // Mode de paiement : seul `SEPARATE` en espèces est servi pendant EDGE.
    const payment = input.payment === undefined ? null : asObject(input.payment, 'payment');
    if (payment === null || payment.method !== 'CASH') {
      throw edgeRefusal(ctx.authority.epoch, 'DEPOSIT_NOT_CASH');
    }

    // Lecture du bracelet, si la requête en porte une.
    let tapId: number | null = null;
    const hasId = input.tap_id !== undefined && input.tap_id !== null;
    const hasTap = input.tap !== undefined && input.tap !== null;
    if (hasId && hasTap) throw validation('tap_id et tap sont exclusifs');
    if (hasTap) {
      const reading = parseTapInput(input.tap);
      if (reading.tokenHash !== media.token_hash.toString('hex')) {
        throw new ProblemException('TAP_UNUSABLE');
      }
      assertTapMatchesMedia(reading, media);
    } else if (hasId) {
      const resolved = await resolveTapId(tx, input.tap_id, device, event, now);
      if (resolved.tokenHash !== media.token_hash.toString('hex')) {
        throw new ProblemException('TAP_UNUSABLE');
      }
      tapId = resolved.tapId;
    }
    assertMediaActive(media);

    const terms = await this.terms.lookup(tx, {
      mediaId,
      batchId: media.batch_id,
      mediaStatus: media.status,
    });
    if (terms === null) throw conflictState('DEPOSIT_TERMS_UNKNOWN');

    // Déjà encaissée : l'état courant, sans nouvelle entrée en file (idempotent).
    const live = await liveGuichetOperation(tx, 'DEPOSIT_CASH', mediaId);
    if (terms.depositStatus === 'HELD' || live !== null) {
      return {
        status: 200,
        edgeSeq: null,
        body: {
          status: 'HELD',
          amount: toSafeNumber(terms.depositAmount),
          mode: 'SEPARATE',
          transaction_id: null,
          cash_session_id: null,
        },
      };
    }
    if (terms.depositAmount <= 0n || terms.depositStatus !== 'DUE') {
      throw conflictState('NO_DEPOSIT_DUE');
    }
    const session = requireUsableSession(device, ctx.staff.session, input.cash_session_id);
    if (session.cash_account_id === null) throw conflictState('CASH_SESSION_WITHOUT_ACCOUNT');

    const row = await ctx.deps.queue.append(
      tx,
      {
        originKey: ctx.key,
        type: 'DEPOSIT_CASH',
        authorizedMode: 'EDGE_ONLINE',
        deviceSerial: device.serial,
        deviceId: device.deviceId,
        operation: {
          seq: ctx.seq,
          type: 'DEPOSIT_CASH',
          occurred_at: now.toISOString(),
          amount: toSafeNumber(terms.depositAmount),
          currency: event.currency,
          edge_guichet: {
            media_id: mediaId,
            event_id: event.eventId,
            channel: 'DESK',
            deposit_amount: toSafeNumber(terms.depositAmount),
            cash_desk_account_id: session.cash_account_id,
          },
        },
        occurredAt: now,
        recordedAt: now,
      },
      [],
    );
    if (tapId !== null) await consumeTap(tx, tapId, row.edgeSeq);
    return {
      status: 200,
      edgeSeq: row.edgeSeq,
      body: {
        status: 'HELD',
        amount: toSafeNumber(terms.depositAmount),
        mode: 'SEPARATE',
        transaction_id: localTransactionId(),
        cash_session_id: session.cash_session_id,
      },
    };
  }
}
