// Caution d'un bracelet (SPECIFICATION §7.9, §5.3 ; FR-022, FR-023). Les écritures passent par le moteur de la
// mission 1, qui délègue à `take_deposit` et `refund_deposit` : aucune ligne n'est construite ici.
//   FROM_BALANCE : prélevée sur le solde payé ; s'il ne suffit pas, la caution reste DUE et se prendra après une recharge
//                  (`takeDueDeposit`, toujours dans une transaction distincte de celle qui a crédité le portefeuille).
//   SEPARATE     : payée à part, en espèces seulement dans cette mission (C-007), au compte de caisse du terminal.
// Décision du porteur n° 10 (13/10/2026) : cette mission ne crée AUCUN compte de caisse. Tant que la mission des
// caisses n'a pas ouvert celui du terminal, une caution en espèces est refusée : aucun argent liquide n'entre sans
// session de caisse.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { Language } from '../../http/language';
import { LedgerEngineService } from '../../ledger/ledger-engine.service';
import { conflict, notFound } from '../../organization/platform/platform.dto';
import { counterRefusal, type DepositState, type Payment } from './lifecycle.dto';

export interface DepositContext {
  operatorId: string;
  /** Code du compte de caisse du terminal, s'il y en a un. */
  cashDeskCode: string | null;
  deviceId?: string;
  audit: AuditContext;
  language: Language;
}

interface DepositRow {
  deposit_status: DepositState['status'];
  deposit_held: bigint;
  deposit_amount: bigint | null;
  deposit_mode: 'FROM_BALANCE' | 'SEPARATE' | null;
  ledger_id: string | null;
  currency: string | null;
  debit_authority: 'CENTRAL' | 'EDGE' | null;
  event_id: string | null;
  assignments: number;
}

@Injectable()
export class DepositService {
  constructor(
    private readonly tx: TenantTx,
    private readonly engine: LedgerEngineService,
    private readonly audit: AuditService,
  ) {}

  private async row(client: TxClient, mediaId: string): Promise<DepositRow> {
    const { rows } = await client.query<DepositRow>(
      `SELECT m.deposit_status, m.deposit_held, b.deposit_amount, b.deposit_mode, w.ledger_id, l.currency, l.debit_authority,
              CASE WHEN l.scope_type = 'EVENT' THEN l.scope_id END AS event_id,
              (SELECT count(*)::int FROM media_assignment a WHERE a.media_id = m.id) AS assignments
         FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id LEFT JOIN wallet w ON w.id = m.wallet_id LEFT JOIN ledger l ON l.id = w.ledger_id
        WHERE m.id = $1`,
      [mediaId],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  /** État courant de la caution, avec l'écriture qui l'a posée ou rendue pour le détenteur actuel. */
  async state(client: TxClient, mediaId: string): Promise<DepositState> {
    const row = await this.row(client, mediaId);
    const amount = row.deposit_status === 'HELD' ? row.deposit_held : row.deposit_status === 'NONE' ? 0n : (row.deposit_amount ?? 0n);
    const prefix = row.deposit_status === 'REFUNDED' ? 'deposit-refund' : row.deposit_status === 'FORFEITED' ? 'deposit-forfeit' : 'deposit';
    const tx = row.ledger_id
      ? await client.query<{ id: string }>('SELECT id FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key = $2', [row.ledger_id, `${prefix}:${mediaId}:${row.assignments}`])
      : { rows: [] };
    return {
      status: row.deposit_status,
      amount: Number(amount),
      mode: Number(row.deposit_amount ?? 0n) === 0 ? null : row.deposit_mode,
      transaction_id: row.deposit_status === 'NONE' || row.deposit_status === 'DUE' ? null : (tx.rows[0]?.id ?? null),
    };
  }

  /** Prend la caution du lot ; rend l'identifiant de l'écriture, s'il y en a eu une. Déjà détenue : rien de plus. */
  async take(client: TxClient, context: DepositContext, mediaId: string, payment: Payment | null, occurredAt: Date): Promise<{ state: DepositState; transactionId: string | null }> {
    const row = await this.row(client, mediaId);
    if (Number(row.deposit_amount ?? 0n) === 0 || row.deposit_status === 'HELD') return { state: await this.state(client, mediaId), transactionId: null };
    if (!row.ledger_id || !row.currency) throw new ProblemException('MEDIA_NOT_ACTIVATED');
    const moneyAccount = this.moneyAccount(context, row, payment);
    if (row.deposit_mode === 'FROM_BALANCE' && row.debit_authority === 'EDGE') throw new ProblemException('DEBIT_AUTHORITY_EDGE');
    const result = await this.engine.execute(client, {
      type: 'DEPOSIT_TAKEN',
      idempotencyKey: `deposit:${mediaId}:${row.assignments}`,
      occurredAt,
      source: 'ONLINE',
      ledgerId: row.ledger_id,
      ...(row.event_id ? { eventId: row.event_id } : {}),
      currency: row.currency.trim(),
      mediaId,
      ...(context.deviceId ? { deviceId: context.deviceId } : {}),
      payload: moneyAccount ? { moneyAccount } : {},
    });
    const state = await this.state(client, mediaId);
    await this.audit.record(client, {
      ...context.audit,
      operatorId: context.operatorId,
      action: 'MEDIA_DEPOSIT_TAKEN',
      objectType: 'media',
      objectId: mediaId,
      after: { status: state.status, amount: state.amount, mode: state.mode, transaction_id: result.transactionId },
    });
    return { state, transactionId: result.transactionId };
  }

  /** Rend la caution détenue, par le canal de son mode. Déjà rendue : même état, rien de plus. */
  async refund(client: TxClient, context: DepositContext, mediaId: string, payment: Payment | null, occurredAt: Date): Promise<{ state: DepositState; transactionId: string | null }> {
    const row = await this.row(client, mediaId);
    if (row.deposit_status === 'REFUNDED') return { state: await this.state(client, mediaId), transactionId: null };
    if (row.deposit_status !== 'HELD' && row.deposit_status !== 'DUE') throw conflict(`Aucune caution à rendre sur ce bracelet (${row.deposit_status}).`);
    if (!row.ledger_id || !row.currency) throw new ProblemException('MEDIA_NOT_ACTIVATED');
    const held = Number(row.deposit_held);
    const moneyAccount = row.deposit_status === 'HELD' ? this.moneyAccount(context, row, payment) : undefined;
    const result = await this.engine.execute(client, {
      type: 'DEPOSIT_REFUNDED',
      idempotencyKey: `deposit-refund:${mediaId}:${row.assignments}`,
      occurredAt,
      source: 'ONLINE',
      ledgerId: row.ledger_id,
      ...(row.event_id ? { eventId: row.event_id } : {}),
      currency: row.currency.trim(),
      mediaId,
      ...(context.deviceId ? { deviceId: context.deviceId } : {}),
      payload: moneyAccount ? { moneyAccount } : {},
    });
    const state = await this.state(client, mediaId);
    await this.audit.record(client, {
      ...context.audit,
      operatorId: context.operatorId,
      action: 'MEDIA_DEPOSIT_REFUNDED',
      objectType: 'media',
      objectId: mediaId,
      before: { status: row.deposit_status, amount: held },
      after: { status: state.status, mode: state.mode, transaction_id: result.transactionId },
    });
    return { state: state.status === 'REFUNDED' ? { ...state, amount: held } : state, transactionId: result.transactionId };
  }

  /**
   * Prend une caution restée due, après un crédit payé sur le portefeuille. À appeler par les missions de recharge,
   * APRÈS la validation de la recharge : toujours une transaction distincte (contracts/media-lifecycle.md, règle 4).
   */
  async takeDueDeposit(operatorId: string, mediaId: string, audit: AuditContext, language: Language = 'fr'): Promise<DepositState> {
    return this.tx.run(operatorId, async (client) => {
      const row = await this.row(client, mediaId);
      if (row.deposit_status !== 'DUE') return this.state(client, mediaId);
      return (await this.take(client, { operatorId, cashDeskCode: null, audit, language }, mediaId, null, new Date())).state;
    });
  }

  /** Compte d'argent d'une caution payée à part : la caisse du terminal, en espèces seulement. */
  private moneyAccount(context: DepositContext, row: DepositRow, payment: Payment | null): string | undefined {
    if (row.deposit_mode !== 'SEPARATE') return undefined;
    if (!payment) throw counterRefusal('deposit.payment_required', context.language);
    if (payment.method !== 'CASH') throw counterRefusal('deposit.cash_only', context.language);
    if (!context.cashDeskCode) throw conflict('Aucune caisse ouverte pour ce terminal : une caution en espèces ne peut être ni prise ni rendue ici.');
    return context.cashDeskCode;
  }
}
