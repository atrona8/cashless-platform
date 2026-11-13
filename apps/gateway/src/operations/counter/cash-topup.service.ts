// `createCashTopup` sur la passerelle (FR-015, C-005, décisions 14 et 21 du porteur).
//
//  - terminal en mode `TOPUP_DESK` (`403` sinon), personne `CASHIER`/`SUPERVISOR` (jeton, R-20) ;
//  - `assertCanDebit(époque)` d'abord : la passerelle ne sert une recharge qu'en `ACTIVE` ;
//  - session de caisse `OPEN`, `usable_on_edge` (répliquée avant la bascule), du terminal : sinon
//    `409 CONFLICT_STATE`, RIEN d'écrit. Aucune exemption de garde de caisse. Le compte de caisse
//    vient de la session, jamais de la requête ;
//  - plafond par recharge (décision 21) puis plafonds réglementaires (`wallet_limits`,
//    `kyc_verified`, `topup_month_paid`), appliqués ICI à la saisie : au rejeu la recharge n'est
//    jamais rejetée pour un plafond (décision 14) ;
//  - entrée de file `TOPUP_CASH` / `EDGE_ONLINE` (clé d'origine = `Idempotency-Key`) et delta
//    positif dans la MÊME transaction : le crédit n'existe pas sans sa trace en file.
// Contradiction de texte (note 6) : `OfflineOperationType` rejette `TOPUP_CASH` dans un lot de
// terminal sans exception pour la passerelle, qui l'emploie avec `EDGE_ONLINE` : signalée.
import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUTHORITY, AuthorityService } from '../../authority/authority.service';
import { GATEWAY_CLOCK, type GatewayClock } from '../../clock/gateway-clock';
import { GatewayTx, type TxClient } from '../../db/gateway-tx';
import { NonceStore } from '../../device-proofs/nonce-store';
import { ProblemException } from '../../device-proofs/problem';
import { IdempotencyService } from '../../device/idempotency.service';
import { readEffectiveBalance } from '../../replication/effective-balance';
import { EDGE_QUEUE, EdgeQueue } from '../../queue/edge-queue';
import { StaffAuthorizer } from '../../staff/staff-token.guard';
import {
  asObject,
  assertEventLive,
  assertMediaActive,
  assertTapMatchesMedia,
  conflictState,
  consumeTap,
  localTransactionId,
  mediaByTokenHash,
  parseTapInput,
  positiveAmount,
  readEpochHeader,
  readEvent,
  requireUsableSession,
  resolveTapId,
  runCounterOperation,
  timestampField,
  toSafeNumber,
  validation,
  type CounterDeps,
  type EventSettings,
  type OperationContext,
  type OperationResult,
  type TapReading,
} from './counter-common';

/** Décision 21 : plafond par recharge en espèces par défaut (unités mineures du XOF). */
export const DEFAULT_CASH_TOPUP_CEILING = 500_000n;

/**
 * Plafond par recharge, réglable (décisions 21 et 36) : `edge_terms.max_cash_topup` répliqué par le
 * central (réglage `replay_max_per_cash_topup`). Absent ou invalide : 500 000 pour le XOF ; pour une
 * autre devise le réglage manque, échec fermé (aucune recharge, comme le central au rejeu).
 */
export function cashTopupCeiling(event: EventSettings): bigint {
  const setting = event.edgeTerms?.max_cash_topup;
  if (typeof setting === 'number' && Number.isSafeInteger(setting) && setting > 0) {
    return BigInt(setting);
  }
  return event.currency === 'XOF' ? DEFAULT_CASH_TOPUP_CEILING : 0n;
}

interface Limits {
  maxWalletBalance: bigint | null;
  unidentifiedMaxBalance: bigint | null;
  identifiedMonthly: bigint | null;
  unidentifiedMonthly: bigint | null;
}

function limitValue(source: Record<string, unknown>, name: string): bigint | null {
  if (!(name in source)) throw conflictState('WALLET_LIMITS_UNKNOWN');
  const value = source[name];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw conflictState('WALLET_LIMITS_UNKNOWN');
  }
  return BigInt(value);
}

/** Les quatre plafonds du profil de législation ; l'un d'eux absent : échec fermé. */
export function readLimits(event: EventSettings): Limits {
  const source = event.walletLimits;
  return {
    maxWalletBalance: limitValue(source, 'max_wallet_balance'),
    unidentifiedMaxBalance: limitValue(source, 'unidentified_max_balance'),
    identifiedMonthly: limitValue(source, 'identified_monthly_limit'),
    unidentifiedMonthly: limitValue(source, 'unidentified_monthly_limit'),
  };
}

interface WalletState {
  status: string;
  verified: boolean;
  monthPaidKnown: boolean;
  monthPaid: bigint;
}

async function readWallet(tx: TxClient, walletId: string): Promise<WalletState> {
  const { rows } = await tx.query<{
    status: string | null;
    state_status: string | null;
    tier: string | null;
    limits: Record<string, unknown> | null;
    month_paid: string | null;
  }>(
    `SELECT w.status, ws.status AS state_status, ws.identification_tier AS tier,
            l.limits, l.topup_month_paid AS month_paid
       FROM edge_wallet w
       LEFT JOIN edge_wallet_state ws ON ws.wallet_id = w.wallet_id
       LEFT JOIN edge_wallet_limit l ON l.wallet_id = w.wallet_id
      WHERE w.wallet_id = $1`,
    [walletId],
  );
  const row = rows[0];
  if (!row) throw new ProblemException('MEDIA_NOT_ACTIVATED');
  const fromLimits = row.limits ? row.limits.kyc_verified === true : null;
  const fromTier = row.tier === null ? null : row.tier === 'VERIFIED';
  // Deux sources en désaccord : la plus stricte (non identifié).
  const verified =
    fromLimits !== null && fromTier !== null
      ? fromLimits && fromTier
      : (fromTier ?? fromLimits ?? false);
  return {
    status: row.state_status ?? row.status ?? 'UNKNOWN',
    verified,
    monthPaidKnown: row.limits?.topup_month_known === true,
    monthPaid: BigInt(row.month_paid ?? '0'),
  };
}

/** Recharges de la passerelle ce mois (UTC), pas encore comprises dans `topup_month_paid`. */
async function localMonthTopups(tx: TxClient, walletId: string, now: Date): Promise<bigint> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const { rows } = await tx.query<{ total: string }>(
    `SELECT coalesce(sum(d.paid_delta), 0)::text AS total
       FROM edge_op_delta d
       JOIN edge_op o ON o.edge_seq = d.edge_seq
       LEFT JOIN edge_wallet w ON w.wallet_id = d.wallet_id
      WHERE d.wallet_id = $1 AND o.type = 'TOPUP_CASH'
        AND d.edge_seq > coalesce(w.applied_edge_seq, 0)
        AND o.recorded_at >= $2 AND o.recorded_at < $3`,
    [walletId, start, end],
  );
  return BigInt(rows[0]?.total ?? '0');
}

@Injectable()
export class CashTopupService {
  private readonly deps: CounterDeps;

  constructor(
    @Inject(GatewayTx) gatewayTx: GatewayTx,
    @Inject(NonceStore) nonces: NonceStore,
    @Inject(AUTHORITY) authority: AuthorityService,
    @Inject(StaffAuthorizer) staff: StaffAuthorizer,
    @Inject(IdempotencyService) idempotency: IdempotencyService,
    @Inject(EDGE_QUEUE) queue: EdgeQueue,
    @Inject(GATEWAY_CLOCK) clock: GatewayClock,
  ) {
    this.deps = { gatewayTx, nonces, authority, staff, idempotency, queue, clock };
  }

  async create(req: Request, res: Response, body: unknown): Promise<unknown> {
    const input = asObject(body, 'corps');
    return runCounterOperation(
      this.deps,
      {
        route: 'createCashTopup',
        req,
        res,
        body,
        epoch: readEpochHeader(req),
        citedSessionId: typeof input.cash_session_id === 'string' ? input.cash_session_id : null,
      },
      (ctx) => this.apply(ctx, input),
    );
  }

  private async apply(
    ctx: OperationContext,
    input: Record<string, unknown>,
  ): Promise<OperationResult> {
    const { tx, device, now } = ctx;
    // Terminal « guichet de recharge » seulement.
    if (device.appMode !== 'TOPUP_DESK') throw new ProblemException('FORBIDDEN');
    const amount = positiveAmount(input.amount, 'amount');
    if (typeof input.currency !== 'string') throw validation('currency : code attendu');
    const occurredRaw = timestampField(input.occurred_at, 'occurred_at');
    if (input.cash_tendered !== undefined && !Number.isSafeInteger(input.cash_tendered)) {
      throw validation('cash_tendered : entier attendu');
    }
    const hasId = input.tap_id !== undefined && input.tap_id !== null;
    const hasTap = input.tap !== undefined && input.tap !== null;
    if (hasId === hasTap) throw validation('exactement un de tap_id ou tap est attendu');

    const event = await readEvent(tx);
    assertEventLive(event);
    if (input.currency !== event.currency) throw new ProblemException('CURRENCY_MISMATCH');

    // Décision 21 : plafond par recharge, à la saisie, avant toute écriture ou mise en file.
    if (amount > cashTopupCeiling(event)) {
      throw new ProblemException('AMOUNT_OUT_OF_RANGE', { detail: 'CASH_TOPUP_CEILING' });
    }

    // Session de caisse répliquée avant la bascule (FR-015), du terminal, jamais de la requête.
    const session = requireUsableSession(device, ctx.staff.session, input.cash_session_id);

    // Bracelet : lecture embarquée ou passage local.
    let tapReading: TapReading | null = null;
    let tapId: number | null = null;
    let tokenHash: string;
    if (hasTap) {
      tapReading = parseTapInput(input.tap);
      tokenHash = tapReading.tokenHash;
    } else {
      const resolved = await resolveTapId(tx, input.tap_id, device, event, now);
      tapId = resolved.tapId;
      tokenHash = resolved.tokenHash;
    }
    const media = await mediaByTokenHash(tx, tokenHash);
    if (tapReading !== null) assertTapMatchesMedia(tapReading, media);
    assertMediaActive(media);
    if (media.wallet_id === null || media.media_id === null) {
      throw new ProblemException('MEDIA_NOT_ACTIVATED');
    }
    const wallet = await readWallet(tx, media.wallet_id);
    if (wallet.status !== 'ACTIVE') throw new ProblemException('WALLET_BLOCKED');

    // Plafonds réglementaires (comme `check_wallet_limits`), sur l'état répliqué.
    const limits = readLimits(event);
    const balance = await readEffectiveBalance(tx, media.wallet_id);
    const balanceCap = wallet.verified ? limits.maxWalletBalance : limits.unidentifiedMaxBalance;
    if (balanceCap !== null && balance.paid + amount > balanceCap) {
      throw new ProblemException('WALLET_LIMIT_EXCEEDED');
    }
    let monthlyCap = wallet.verified ? limits.identifiedMonthly : limits.unidentifiedMonthly;
    if (!wallet.monthPaidKnown) {
      // Cumul du mois inconnu : palier le plus strict (consigne du contrat de réplication).
      const caps = [limits.identifiedMonthly, limits.unidentifiedMonthly].filter(
        (cap): cap is bigint => cap !== null,
      );
      monthlyCap = caps.length === 0 ? null : caps.reduce((a, b) => (a < b ? a : b));
    }
    if (monthlyCap !== null) {
      const central = wallet.monthPaidKnown ? wallet.monthPaid : 0n;
      const total = central + (await localMonthTopups(tx, media.wallet_id, now)) + amount;
      if (total > monthlyCap) throw new ProblemException('MONTHLY_TOPUP_LIMIT_EXCEEDED');
    }

    // Effet local et trace en file, dans la même transaction.
    const row = await ctx.deps.queue.append(
      tx,
      {
        originKey: ctx.key,
        type: 'TOPUP_CASH',
        authorizedMode: 'EDGE_ONLINE',
        deviceSerial: device.serial,
        deviceId: device.deviceId,
        operation: {
          seq: ctx.seq,
          type: 'TOPUP_CASH',
          occurred_at: occurredRaw,
          amount: toSafeNumber(amount),
          currency: event.currency,
          ...(tapReading !== null ? { tap: tapReading.raw } : {}),
          edge_guichet: { media_id: media.media_id },
        },
        occurredAt: new Date(occurredRaw),
        recordedAt: now,
      },
      [{ walletId: media.wallet_id, paidDelta: amount, promoDelta: 0n }],
    );
    if (tapId !== null) await consumeTap(tx, tapId, row.edgeSeq);
    const after = await readEffectiveBalance(tx, media.wallet_id);
    return {
      status: 201,
      edgeSeq: row.edgeSeq,
      body: {
        transaction_id: localTransactionId(),
        idempotency_key: ctx.key,
        type: 'TOPUP_CASH',
        status: 'SUCCEEDED',
        amount: toSafeNumber(amount),
        currency: event.currency,
        wallet_id: media.wallet_id,
        balance_after: {
          spendable: toSafeNumber(after.paid + after.promo),
          paid: toSafeNumber(after.paid),
          promo: toSafeNumber(after.promo),
        },
        cash_session_id: session.cash_session_id,
        deposit: null,
      },
    };
  }
}
