// `activateMedia` sur la passerelle (FR-016, ADR-52, A10, A24).
//
//  - `Idempotency-Key` `<série>:<numéro>` = clé d'origine (A10). Le contrat ne déclare pas
//    `X-Authority-Epoch` ici (note 1) : la passerelle contrôle seule son état `ACTIVE`.
//  - canal `DESK` seulement, présent dans `event.activation_modes` (`422 ACTIVATION_MODE_NOT_ALLOWED`) ;
//  - frais d'activation sur solde, caution `FROM_BALANCE` ou autre moyen que les espèces :
//    `409 DEBIT_AUTHORITY_EDGE`, `retryable: false`, sans `edge_base_url`, sans numéro consommé ;
//  - portefeuille anonyme : identifiant GÉNÉRÉ ici, vérifié absent localement (A24) ; un
//    `wallet_id` fourni n'est admis que pour la réactivation du MÊME bracelet ;
//  - file : `ACTIVATION`, puis `DEPOSIT_CASH` (clé `<série>:<numéro>#deposit`) à sa suite, deux
//    numéros consécutifs dans la MÊME transaction ; caution en espèces : session `OPEN` du terminal.
// Les conditions de la caution viennent de `edge_terms` répliqué (décision 36, voir
// `deposit-terms.ts`) : inconnues, le chemin refuse (`DEPOSIT_TERMS_UNKNOWN`).
import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUTHORITY, AuthorityService } from '../../authority/authority.service';
import { GATEWAY_CLOCK, type GatewayClock } from '../../clock/gateway-clock';
import { GatewayTx, type TxClient } from '../../db/gateway-tx';
import { NonceStore } from '../../device-proofs/nonce-store';
import { ProblemException } from '../../device-proofs/problem';
import { IdempotencyService } from '../../device/idempotency.service';
import { EDGE_QUEUE, EdgeQueue } from '../../queue/edge-queue';
import { readEffectiveBalance } from '../../replication/effective-balance';
import { StaffAuthorizer } from '../../staff/staff-token.guard';
import {
  asObject,
  assertEventLive,
  conflictState,
  edgeRefusal,
  liveGuichetOperation,
  localTransactionId,
  mediaByTokenHash,
  parseTapInput,
  readEvent,
  requireUsableSession,
  runCounterOperation,
  timestampField,
  toSafeNumber,
  uuidField,
  validation,
  assertTapMatchesMedia,
  type CounterDeps,
  type MediaRow,
  type OperationContext,
  type OperationResult,
} from './counter-common';
import { DEPOSIT_TERMS, replicatedDepositTerms, type DepositTermsPort } from './deposit-terms';

const ACTIVATABLE = new Set(['PERSONALIZED', 'ISSUED']);

/** Refus d'un bracelet qui ne peut pas être activé, avec le code du contrat. */
function assertActivatable(media: MediaRow, reactivationWallet: string | null): void {
  if (media.media_id === null) throw new ProblemException('MEDIA_STATE_INVALID');
  if (media.status === 'ACTIVE') {
    // Réactivation du même bracelet de ce portefeuille : seule exception.
    if (reactivationWallet !== null && media.wallet_id === reactivationWallet) return;
    throw new ProblemException('MEDIA_STATE_INVALID');
  }
  if (ACTIVATABLE.has(media.status)) {
    if (media.wallet_id !== null) throw new ProblemException('MEDIA_STATE_INVALID');
    return;
  }
  switch (media.status) {
    case 'SUSPENDED':
    case 'BLACKLISTED':
      throw new ProblemException('MEDIA_BLOCKED');
    case 'RELEASED':
      throw new ProblemException('MEDIA_RELEASED');
    case 'REPLACED':
      throw new ProblemException('MEDIA_REPLACED');
    default:
      throw new ProblemException('MEDIA_RETIRED');
  }
}

/** Signature d'originalité : comparée à l'empreinte de la personnalisation (ADR-59). */
function assertOriginality(media: MediaRow, signature: string | null): void {
  if (media.originality_sig_sha256 === null) return;
  if (signature === null) throw new ProblemException('MEDIA_SIGNATURE_MISSING');
  const digest = createHash('sha256').update(Buffer.from(signature, 'hex')).digest();
  if (!digest.equals(media.originality_sig_sha256)) {
    throw new ProblemException('MEDIA_SIGNATURE_MISMATCH');
  }
}

@Injectable()
export class MediaActivationService {
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

  async activate(req: Request, res: Response, body: unknown): Promise<unknown> {
    const input = asObject(body, 'corps');
    return runCounterOperation(
      this.deps,
      { route: 'activateMedia', req, res, body, epoch: null },
      (ctx) => this.apply(ctx, input),
    );
  }

  private async newWalletId(tx: TxClient): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = randomUUID();
      if (!(await this.walletKnown(tx, candidate))) return candidate;
    }
    throw new ProblemException('INTERNAL_ERROR');
  }

  private async walletKnown(tx: TxClient, walletId: string): Promise<boolean> {
    const { rowCount } = await tx.query(
      `SELECT 1 FROM edge_wallet WHERE wallet_id = $1
       UNION ALL SELECT 1 FROM edge_wallet_state WHERE wallet_id = $1
       UNION ALL SELECT 1 FROM edge_media WHERE wallet_id = $1
       UNION ALL SELECT 1 FROM edge_op WHERE operation -> 'edge_guichet' ->> 'wallet_id' = $1::text
       LIMIT 1`,
      [walletId],
    );
    return (rowCount ?? 0) > 0;
  }

  private async apply(
    ctx: OperationContext,
    input: Record<string, unknown>,
  ): Promise<OperationResult> {
    const { tx, device, now } = ctx;
    if (input.tap === undefined || input.tap === null)
      throw validation('tap : lecture obligatoire');
    const tap = parseTapInput(input.tap);
    if (input.channel !== 'DESK' && input.channel !== 'FIRST_TOPUP') {
      throw validation('channel : DESK ou FIRST_TOPUP attendu');
    }
    const occurredRaw = timestampField(input.occurred_at, 'occurred_at');
    const requestedWallet =
      input.wallet_id === undefined || input.wallet_id === null
        ? null
        : uuidField(input.wallet_id, 'wallet_id');
    if (input.customer_id !== undefined && input.customer_id !== null) {
      // Le rattachement à un compte client n'a pas de champ dans `edge_guichet` : non servi ici.
      throw validation('customer_id : activation nominative non servie par la passerelle');
    }
    const payment = input.deposit_payment;
    let method: string | null = null;
    if (payment !== undefined && payment !== null) {
      const movement = asObject(payment, 'deposit_payment');
      if (typeof movement.method !== 'string') throw validation('deposit_payment.method attendu');
      method = movement.method;
    }

    const event = await readEvent(tx);
    assertEventLive(event);
    // Seul le canal DESK est servi (`edge_guichet.channel = DESK`).
    if (input.channel !== 'DESK' || !event.activationModes.includes('DESK')) {
      throw new ProblemException('ACTIVATION_MODE_NOT_ALLOWED');
    }

    const media = await mediaByTokenHash(tx, tap.tokenHash);
    assertTapMatchesMedia(tap, media);
    assertOriginality(media, tap.originalitySignature);
    assertActivatable(media, requestedWallet);
    if (media.batch_status !== 'ACTIVE') throw new ProblemException('MEDIA_BATCH_INACTIVE');
    const mediaId = media.media_id!;
    if (await liveGuichetOperation(tx, 'ACTIVATION', mediaId)) {
      throw new ProblemException('MEDIA_STATE_INVALID');
    }

    // Conditions de caution et de frais (lacune de réplication : inconnues -> refus).
    const terms = await this.terms.lookup(tx, {
      mediaId,
      batchId: media.batch_id,
      mediaStatus: media.status,
    });
    if (terms === null) throw conflictState('DEPOSIT_TERMS_UNKNOWN');
    if (terms.activationFeeFromBalance > 0n) {
      throw edgeRefusal(ctx.authority.epoch, 'ACTIVATION_FEE_FROM_BALANCE');
    }
    const deposit = terms.depositAmount;
    if (deposit > 0n && method !== 'CASH') {
      // Caution sur solde (aucun moyen fourni) ou autre moyen que les espèces.
      throw edgeRefusal(ctx.authority.epoch, 'DEPOSIT_NOT_CASH');
    }
    if (deposit === 0n && method !== null)
      throw validation('deposit_payment : aucune caution prévue');
    const session =
      deposit > 0n ? requireUsableSession(device, ctx.staff.session, undefined) : null;
    if (session !== null && session.cash_account_id === null) {
      throw conflictState('CASH_SESSION_WITHOUT_ACCOUNT');
    }

    // Portefeuille : neuf pour une activation anonyme (A24) ; connu seulement pour ce bracelet.
    let walletId: string;
    if (requestedWallet === null) {
      walletId = await this.newWalletId(tx);
    } else if (media.status === 'ACTIVE' && media.wallet_id === requestedWallet) {
      walletId = requestedWallet;
    } else if (await this.walletKnown(tx, requestedWallet)) {
      throw validation('wallet_id : portefeuille déjà connu');
    } else {
      walletId = requestedWallet;
    }

    const occurredAt = new Date(occurredRaw);
    const activation = await ctx.deps.queue.append(
      tx,
      {
        originKey: ctx.key,
        type: 'ACTIVATION',
        authorizedMode: 'EDGE_ONLINE',
        deviceSerial: device.serial,
        deviceId: device.deviceId,
        operation: {
          seq: ctx.seq,
          type: 'ACTIVATION',
          occurred_at: occurredRaw,
          currency: event.currency,
          tap: tap.raw,
          edge_guichet: {
            media_id: mediaId,
            wallet_id: walletId,
            event_id: event.eventId,
            channel: 'DESK',
          },
        },
        occurredAt,
        recordedAt: now,
      },
      [],
    );
    let depositState: Record<string, unknown> = {
      status: 'NONE',
      amount: 0,
      mode: null,
      transaction_id: null,
      cash_session_id: null,
    };
    if (session !== null) {
      await ctx.deps.queue.append(
        tx,
        {
          originKey: `${ctx.key}#deposit`,
          type: 'DEPOSIT_CASH',
          authorizedMode: 'EDGE_ONLINE',
          deviceSerial: device.serial,
          deviceId: device.deviceId,
          operation: {
            seq: ctx.seq,
            type: 'DEPOSIT_CASH',
            occurred_at: occurredRaw,
            amount: toSafeNumber(deposit),
            currency: event.currency,
            edge_guichet: {
              media_id: mediaId,
              event_id: event.eventId,
              channel: 'DESK',
              deposit_amount: toSafeNumber(deposit),
              cash_desk_account_id: session.cash_account_id,
            },
          },
          occurredAt,
          recordedAt: now,
        },
        [],
      );
      depositState = {
        status: 'HELD',
        amount: toSafeNumber(deposit),
        mode: 'SEPARATE',
        transaction_id: localTransactionId(),
        cash_session_id: session.cash_session_id,
      };
    }

    // Effet local : le bracelet est attaché à son portefeuille (neuf s'il n'existe pas encore).
    await tx.query(
      `INSERT INTO edge_wallet (wallet_id, status, central_paid, central_promo, applied_edge_seq)
       SELECT $1, 'ACTIVE', 0, 0, last_edge_seq_applied FROM edge_replication_cursor
       ON CONFLICT (wallet_id) DO NOTHING`,
      [walletId],
    );
    await tx.query(
      `UPDATE edge_media SET wallet_id = $2, status = 'ACTIVE' WHERE token_hash = $1`,
      [media.token_hash, walletId],
    );
    const balance = await readEffectiveBalance(tx, walletId);
    return {
      status: 201,
      edgeSeq: activation.edgeSeq,
      body: {
        media_id: mediaId,
        media_status: 'ACTIVE',
        wallet: {
          wallet_id: walletId,
          status: 'ACTIVE',
          currency: event.currency,
          spendable: toSafeNumber(balance.paid + balance.promo),
          paid: toSafeNumber(balance.paid),
          promo: toSafeNumber(balance.promo),
        },
        deposit: depositState,
      },
    };
  }
}
