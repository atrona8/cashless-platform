// Création d'une demande de remboursement par le back-office (mission 9b, WP11 ; FR-017, OP-N123) : `createRefundRequest`.
// Mêmes refus d'éligibilité que l'app (`evaluateRefundEligibility`), mais le numéro n'est pas vérifié par code : le
// back-office engage sa responsabilité. Renforcements (à consigner) : le virement naît `REQUESTED` avec contrôle
// supplémentaire au-delà du seuil ; un numéro mobile différent de celui du titulaire vérifié passe par `AWAITING_HOLDER`.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { IbanVault } from '../common/iban-vault';
import { maskIban } from '../common/iban';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { exercisedRole, resolveChain } from '../identity/scope-resolver';
import type { TenantActor } from '../organization/tenant/tenant-access';
import { HolderChallengeService } from './holder-challenge.service';
import { evaluateRefundEligibility } from './refund-eligibility';
import {
  REFUND_COLUMNS,
  toRefundRequest,
  type RefundBackofficeCreateInput,
  type RefundRequest,
  type RefundRow,
} from './refund-requests.dto';
import { REFUND_BACKOFFICE_ROLES } from './refund-requests.service';

@Injectable()
export class RefundBackofficeCreateService {
  constructor(
    private readonly audit: AuditService,
    private readonly holder: HolderChallengeService,
    private readonly vault: IbanVault,
  ) {}

  /** Création, dans la transaction idempotente de l'appelant. */
  async create(
    client: TxClient,
    actor: TenantActor,
    input: RefundBackofficeCreateInput,
  ): Promise<RefundRequest> {
    // 1. Portefeuille et portée : inconnu (RLS) ou hors portée de l'événement : même 404. Verrou : sérialise les créations.
    const found = await client.query<{
      ledger_id: string;
      event_id: string;
      currency: string;
      customer_id: string | null;
    }>(
      `SELECT w.ledger_id, l.scope_id AS event_id, l.currency, w.customer_id
         FROM wallet w JOIN ledger l ON l.id = w.ledger_id AND l.scope_type = 'EVENT'
        WHERE w.id = $1
        FOR UPDATE OF w`,
      [input.walletId],
    );
    const wallet = found.rows[0];
    if (!wallet) throw new ProblemException('NOT_FOUND');
    const chain = await resolveChain(client, { type: 'EVENT', id: wallet.event_id });
    if (!exercisedRole(actor.principal, REFUND_BACKOFFICE_ROLES, chain))
      throw new ProblemException('NOT_FOUND');
    // 2. Éligibilité, à l'horloge de la base.
    await client.query('SELECT promote_due_refund_requests()');
    const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
    const eligibility = await evaluateRefundEligibility(client, input.walletId, now);
    if (!eligibility.eligible)
      throw new ProblemException(
        eligibility.reason === 'WINDOW_CLOSED' ? 'REFUND_WINDOW_CLOSED' : 'REFUND_NOT_ALLOWED',
      );
    // 3. Titulaire vérifié (s'il existe) : un autre numéro mobile attend sa décision, comme dans l'app.
    const holderPhone = await this.holderPhone(client, wallet.customer_id, actor.operatorId);
    const bank = input.method === 'BANK_TRANSFER';
    const foreignNumber = !bank && holderPhone !== null && input.msisdn !== holderPhone;
    const newNumber = bank || foreignNumber;
    const awaiting = foreignNumber;
    const event = (
      await client.query<{ max: string; hours: number }>(
        `SELECT refund_new_number_max::text AS max, refund_new_number_hold_hours AS hours
           FROM event WHERE id = $1`,
        [wallet.event_id],
      )
    ).rows[0]!;
    const extraCheck = newNumber && eligibility.estimatedAmount > BigInt(event.max);
    // IBAN : masque calculé avant de chiffrer ; seule l'enveloppe va en base (OP-N140, FR-010).
    const mask = input.iban ? maskIban(input.iban) : null;
    const sealedIban = input.iban ? this.vault.seal(input.iban, actor.operatorId) : null;
    let row: RefundRow;
    try {
      const inserted = await client.query<RefundRow>(
        `INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, customer_id, requested_by, method,
                                     msisdn, iban, new_number, status, estimated_amount, fee, currency, hold_until,
                                     extra_check_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 CASE WHEN $11 = 'AWAITING_HOLDER' THEN clock_timestamp() + make_interval(hours => $15) END, $16)
         RETURNING ${REFUND_COLUMNS.replace(/r\./g, '')}`,
        [
          actor.operatorId,
          wallet.ledger_id,
          wallet.event_id,
          input.walletId,
          wallet.customer_id,
          actor.principal.userId,
          input.method,
          input.msisdn,
          sealedIban,
          newNumber,
          awaiting ? 'AWAITING_HOLDER' : 'REQUESTED',
          eligibility.estimatedAmount.toString(),
          eligibility.fee.toString(),
          wallet.currency.trim(),
          event.hours,
          extraCheck,
        ],
      );
      row = inserted.rows[0]!;
    } catch (error) {
      const e = error as { code?: string; constraint?: string };
      if (e.code === '23505' && e.constraint === 'refund_request_one_open')
        throw new ProblemException('REFUND_ALREADY_OPEN');
      throw error;
    }
    if (awaiting) await this.holder.startHolderChallenge(client, row.id, holderPhone!);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'REFUND_REQUEST_CREATED',
      objectType: 'refund_request',
      objectId: row.id,
      after: {
        wallet_id: row.wallet_id,
        status: row.status,
        method: row.method,
        new_number: row.new_number,
        estimated_amount: row.estimated_amount,
        fee: row.fee,
        source: 'BACKOFFICE',
        reason: input.reason,
        ...(mask ? { iban: mask } : {}),
      },
    });
    return toRefundRequest(row);
  }

  private async holderPhone(
    client: TxClient,
    customerId: string | null,
    operatorId: string,
  ): Promise<string | null> {
    if (customerId === null) return null;
    const { rows } = await client.query<{ phone: string | null }>(
      'SELECT phone FROM customer_identity WHERE customer_id = $1 AND operator_id = $2',
      [customerId, operatorId],
    );
    return rows[0]?.phone ? rows[0].phone : null;
  }
}
