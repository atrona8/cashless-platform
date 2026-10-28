// Recharge en espèces au guichet (`createCashTopup`, mission 6, lot WP09, T044 et T046 ; FR-004, FR-005, FR-007,
// FR-008 ; A8, A27, A33). Ordre dans UNE transaction : terminal FOR UPDATE (en tête), autorisation, mode
// `TOPUP_DESK`, devise, SESSION ouverte (avant toute écriture), lecture du bracelet, `TOPUP_CASH` par le moteur
// (source `ONLINE` fixée ici : jamais lue du corps, jamais de découpage), rattachement à la session
// (`attach_cash_tx`), lecture consommée, numéro au registre (`accept`), audit.
//
// Le portefeuille crédité est celui de l'attribution ouverte du bracelet (jamais un champ du corps) ; la caisse
// est celle de la session (jamais un champ du corps). `occurred_at` du terminal est informatif : l'heure écrite est
// celle de la base. Aucune réponse ne porte le solde ou le théorique de la caisse (A27).
//
// Registre des numéros : `TOPUP_CASH` est un type chaîné (sync_protocol.md §3.3 ; recharge hors ligne permise sous
// `cash_topup_offline`) : réussite rangée dans la transaction (`accept`), refus définitif 4xx en transaction
// séparée (`reject`). `content_sha256` : `seq`, `type`, `occurred_at`, `amount`, `currency`, `tap` (jamais
// `tap_id`, champ d'état : §3.3), à l'image de `purchaseContent`.
//
// Caution due (R-06) : prise par `afterCredit`, APRÈS le COMMIT du crédit, dans une transaction distincte. Un
// échec de caution n'altère jamais le crédit ni la réponse.
import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { assertDeviceMode, type DeviceContext } from '../../device-identity/device-identity.port';
import { ProblemException } from '../../errors/problem';
import { resolveProblem } from '../../errors/problem.filter';
import type { Language } from '../../http/language';
import type { IdempotentTx } from '../../idempotency/idempotent.decorator';
import { LedgerEngineService } from '../../ledger/ledger-engine.service';
import { ActivationService } from '../../media/lifecycle/activation.service';
import { CounterAccess, requireCashSession } from '../../media/lifecycle/counter-access';
import { DepositService } from '../../media/lifecycle/deposit.service';
import { counterRefusal, type DepositState } from '../../media/lifecycle/lifecycle.dto';
import { lockCounterMedia } from '../../media/lifecycle/release.service';
import { TapRefused, TapService, type RegisteredTap } from '../../media/taps/tap.service';
import { tapProblem, type TapInput } from '../../media/taps/taps.dto';
import { conflict, invalid } from '../../organization/platform/platform.dto';
import {
  contentSha256,
  DeviceSeqRegistry,
  isRegistrable,
} from '../../payments/device-seq-registry';
import { parseCashTopup, type CashTopupInput } from './cash-topup.dto';

const CASH_ACCOUNT_PREFIX = 'A-CAISSE-';

export interface CashTopupArgs {
  req: Request;
  device: DeviceContext;
  seq: bigint;
  key: string;
  body: unknown;
  language: Language;
}

export interface CashTopupResult {
  transaction_id: string;
  idempotency_key: string;
  type: 'TOPUP_CASH';
  status: 'SUCCEEDED';
  amount: number;
  currency: string;
  wallet_id: string;
  balance_after: { spendable: number; paid: number; promo: number };
  deposit: DepositState | null;
  cash_session_id: string;
}

interface Progress {
  tap: TapInput | null;
  mediaId: string | null;
  audit: AuditContext | null;
}

/** Contenu chaîné de la recharge, calculé sur le corps TEL QUE REÇU (un corps mal formé a aussi un contenu). */
function topupContent(seq: bigint, body: unknown): Buffer | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  return contentSha256({
    seq: Number(seq),
    type: 'TOPUP_CASH',
    occurred_at: raw.occurred_at,
    amount: raw.amount,
    currency: raw.currency,
    tap: raw.tap,
  });
}

@Injectable()
export class CashTopupService {
  private readonly log = new Logger(CashTopupService.name);

  constructor(
    private readonly counter: CounterAccess,
    private readonly taps: TapService,
    private readonly engine: LedgerEngineService,
    private readonly deposits: DepositService,
    private readonly activation: ActivationService,
    private readonly audit: AuditService,
    private readonly registry: DeviceSeqRegistry,
  ) {}

  async create(
    args: CashTopupArgs,
    tx: IdempotentTx,
  ): Promise<{
    result: CashTopupResult;
    operatorId: string;
    mediaId: string;
    audit: AuditContext;
  }> {
    const progress: Progress = { tap: null, mediaId: null, audit: null };
    try {
      const input = parseCashTopup(args.body);
      progress.tap = input.tap;
      const result = await tx.run((client) => this.write(client, args, input, progress));
      return {
        result,
        operatorId: args.device.operatorId,
        mediaId: progress.mediaId!,
        audit: progress.audit!,
      };
    } catch (error) {
      return this.refuse(error, args, progress);
    }
  }

  /**
   * Caution due du bracelet, APRÈS la validation du crédit (transaction distincte). Toute erreur est attrapée et
   * journalisée sans donnée personnelle : la caution reste `DUE`, le crédit et la réponse sont intacts.
   */
  async afterCredit(operatorId: string, mediaId: string, audit: AuditContext): Promise<void> {
    try {
      await this.deposits.takeDueDeposit(operatorId, mediaId, audit);
    } catch (error) {
      const problem = resolveProblem(error);
      this.log.warn(`caution due non prise : media_id=${mediaId} code=${problem.code}`);
    }
  }

  // ------------------------------------------------------------------------------ l'écriture

  private async write(
    client: TxClient,
    args: CashTopupArgs,
    input: CashTopupInput,
    progress: Progress,
  ): Promise<CashTopupResult> {
    const { device, language } = args;
    // 1. Terminal pris FOR UPDATE en première instruction (ordre global des verrous) ; heure de la base.
    const clock = await client.query<{ now: Date }>(
      'SELECT clock_timestamp() AS now FROM device WHERE id = $1 FOR UPDATE',
      [device.deviceId],
    );
    if (!clock.rows[0]) throw new ProblemException('NOT_FOUND');
    const occurredAt = clock.rows[0].now;
    // 2. Autorisation, mode, devise, session ouverte : AVANT toute écriture et toute lecture consommée.
    const actor = await this.counter.authorize(client, args.req);
    progress.audit = actor.audit;
    assertDeviceMode(actor.device, ['TOPUP_DESK']);
    if (input.currency !== actor.currency)
      throw invalid('currency : la devise de l’événement de ce terminal est attendue.');
    const session = requireCashSession(actor, language, input.cashSessionId);
    if (!session.code.startsWith(CASH_ACCOUNT_PREFIX))
      throw new Error('compte de la session de caisse : code inattendu');
    // 3. Le bracelet : lecture embarquée ou citée, visible de l'organisateur, actif, portefeuille de l'attribution.
    const presented: RegisteredTap = input.tap
      ? await this.taps.registerOrRefuse(client, device, input.tap)
      : await this.taps.byId(client, device, input.tapId!);
    if (!presented.mediaId) throw new TapRefused('UNKNOWN');
    const mediaId = presented.mediaId;
    progress.mediaId = mediaId;
    await lockCounterMedia(client, actor, mediaId);
    const media = await client.query<{
      status: string;
      wallet_id: string | null;
      ledger_id: string | null;
    }>(
      `SELECT m.status, ma.wallet_id, w.ledger_id
         FROM media m
         LEFT JOIN media_assignment ma ON ma.media_id = m.id AND ma.released_at IS NULL
                                      AND ma.wallet_id = m.wallet_id AND ma.currency = $2
         LEFT JOIN wallet w ON w.id = ma.wallet_id
        WHERE m.id = $1`,
      [mediaId, actor.currency],
    );
    const row = media.rows[0]!;
    if (row.status !== 'ACTIVE')
      throw counterRefusal('cash_due.media_blocked', language, 'MEDIA_STATE_INVALID', 409, {
        media_status: row.status,
      });
    if (!row.wallet_id) throw new ProblemException('MEDIA_NOT_ACTIVATED');
    if (row.ledger_id !== actor.ledgerId)
      throw conflict(
        'Le portefeuille de ce bracelet n’appartient pas à l’événement de ce terminal.',
      );
    const walletId = row.wallet_id;
    // 4. Le crédit : source `ONLINE` fixée ici, caisse = celle de la session.
    const result = await this.engine.execute(client, {
      type: 'TOPUP_CASH',
      source: 'ONLINE',
      idempotencyKey: args.key,
      occurredAt,
      ledgerId: actor.ledgerId,
      eventId: actor.eventId,
      currency: actor.currency,
      deviceId: device.deviceId,
      mediaId,
      createdBy: actor.userId,
      payload: {
        walletId,
        cashDesk: session.code.slice(CASH_ACCOUNT_PREFIX.length),
        amount: input.amount,
      },
      metadata: {
        cash_session_id: session.id,
        device_occurred_at: input.occurredAt.toISOString(),
      },
    });
    const transactionId = result.transactionId;
    if (!transactionId) throw new Error('recharge en espèces : transaction non écrite');
    await client.query('SELECT attach_cash_tx($1, $2)', [session.id, transactionId]);
    if (presented.tapId) await this.taps.consume(client, presented.tapId, transactionId);
    // 5. Le numéro, dans la même transaction que l'écriture.
    const content = topupContent(args.seq, args.body);
    if (content === null) throw new Error('contenu du registre : corps non objet après validation');
    await this.registry.accept(client, {
      deviceId: device.deviceId,
      seq: args.seq,
      content,
      transactionId,
    });
    // 6. Réponse : soldes du portefeuille et état de la caution, lus dans CETTE transaction.
    const wallet = await this.activation.walletSummary(client, walletId);
    const deposit = await this.deposits.state(client, mediaId);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'CASH_TOPUP',
      objectType: 'journal_transaction',
      objectId: transactionId,
      after: {
        amount: Number(input.amount),
        currency: actor.currency,
        cash_session_id: session.id,
        device_id: device.deviceId,
        media_id: mediaId,
      },
    });
    return {
      transaction_id: transactionId,
      idempotency_key: args.key,
      type: 'TOPUP_CASH',
      status: 'SUCCEEDED',
      amount: Number(input.amount),
      currency: actor.currency,
      wallet_id: walletId,
      balance_after: { spendable: wallet.spendable, paid: wallet.paid, promo: wallet.promo },
      deposit: deposit.status === 'DUE' ? deposit : null,
      cash_session_id: session.id,
    };
  }

  // ------------------------------------------------------------------------------ le refus

  /**
   * Transaction annulée : le refus définitif 4xx est rangé au registre (transaction séparée, validée), puis les
   * effets durables d'une lecture suspecte sont rejoués seuls (`settleRefusal`), et l'erreur repart.
   */
  private async refuse(error: unknown, args: CashTopupArgs, progress: Progress): Promise<never> {
    const visible = error instanceof TapRefused ? this.tapError(error) : error;
    const problem = resolveProblem(visible);
    const content = topupContent(args.seq, args.body);
    let registryError: { error: unknown } | null = null;
    if (content !== null && isRegistrable(problem, visible)) {
      try {
        await this.registry.reject(
          args.device.operatorId,
          { deviceId: args.device.deviceId, seq: args.seq, content, reason: problem.code },
          'ONLINE',
        );
      } catch (registry) {
        registryError = { error: registry };
      }
    }
    if (error instanceof TapRefused) {
      try {
        await this.taps.settleRefusal(error, args.device, progress.tap);
      } catch (settled) {
        throw registryError ? registryError.error : settled;
      }
    }
    throw registryError ? registryError.error : visible;
  }

  private tapError(error: TapRefused): ProblemException {
    return error.alreadyActive
      ? new ProblemException('MEDIA_STATE_INVALID', { status: 409 })
      : tapProblem(error.result);
  }
}
