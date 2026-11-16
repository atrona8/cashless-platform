// Demandes de remboursement : création par le festivalier, listes, refus du back-office (mission 9a, WP04 ;
// FR-002 à FR-007, FR-010, FR-014, FR-020). L'éligibilité vient de `evaluateRefundEligibility` (une seule règle) ;
// « une seule demande ouverte » vient de l'index unique partiel de la base (NFR-002).
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { CustomerAuthService } from '../customer-auth/customer-auth.service';
import type { CustomerContext } from '../customer-identity/customer-identity.port';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { exercisedRole, resolveChain } from '../identity/scope-resolver';
import type { Role } from '../identity/principal';
import type { TenantActor } from '../organization/tenant/tenant-access';
import { resolveDestination } from './destination';
import { HolderChallengeService } from './holder-challenge.service';
import { evaluateRefundEligibility } from './refund-eligibility';
import {
  encodeCursor,
  REFUND_COLUMNS,
  toRefundRequest,
  type RefundRequest,
  type RefundRequestCreateInput,
  type RefundRow,
  type RefundStatus,
} from './refund-requests.dto';

export const REFUND_BACKOFFICE_ROLES: readonly Role[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];

export interface Page {
  limit: number;
  after: { t: string; i: string } | null;
}

export interface RefundPage {
  data: RefundRequest[];
  next_cursor: string | null;
  has_more: boolean;
}

const notFound = () => new ProblemException('NOT_FOUND');

@Injectable()
export class RefundRequestsService {
  constructor(
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    private readonly auth: CustomerAuthService,
    private readonly holder: HolderChallengeService,
  ) {}

  /** Création, dans la transaction idempotente de l'appelant. */
  async create(
    client: TxClient,
    customer: CustomerContext,
    input: RefundRequestCreateInput,
    context: AuditContext,
  ): Promise<RefundRequest> {
    // 1. Portefeuille du festivalier seulement ; inconnu ou d'autrui : même refus. Verrou : sérialise les créations.
    const owned = await client.query<{ ledger_id: string; event_id: string; currency: string }>(
      `SELECT w.ledger_id, l.scope_id AS event_id, l.currency
         FROM wallet w JOIN ledger l ON l.id = w.ledger_id AND l.scope_type = 'EVENT'
        WHERE w.id = $1 AND w.customer_id = $2
        FOR UPDATE OF w`,
      [input.wallet_id, customer.customerId],
    );
    const wallet = owned.rows[0];
    if (!wallet) throw new ProblemException('REFUND_NOT_ALLOWED');
    // Compte sans identité vérifiée (comptes de démo anciens) : la demande n'aurait pas de titulaire (clé étrangère).
    const identity = await client.query(
      'SELECT 1 FROM customer_identity WHERE customer_id = $1 AND operator_id = $2',
      [customer.customerId, customer.operatorId],
    );
    if (identity.rowCount !== 1) throw new ProblemException('REFUND_NOT_ALLOWED');
    // 2. Éligibilité, à l'horloge de la base.
    await client.query('SELECT promote_due_refund_requests()');
    const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
    const eligibility = await evaluateRefundEligibility(client, input.wallet_id, now);
    if (!eligibility.eligible)
      throw new ProblemException(
        eligibility.reason === 'WINDOW_CLOSED' ? 'REFUND_WINDOW_CLOSED' : 'REFUND_NOT_ALLOWED',
      );
    // 3. Destination (le code d'un autre numéro est vérifié et consommé ici).
    const destination = await resolveDestination(
      client,
      {
        operatorId: customer.operatorId,
        walletId: input.wallet_id,
        customerId: customer.customerId,
        destination: input.destination,
      },
      (verify) => this.auth.verifyChallenge(verify),
    );
    // 4. Seuils de l'événement.
    const event = (
      await client.query<{ max: string; hours: number }>(
        `SELECT refund_new_number_max::text AS max, refund_new_number_hold_hours AS hours
           FROM event WHERE id = $1`,
        [wallet.event_id],
      )
    ).rows[0]!;
    const awaiting = destination.newNumber && destination.holderPhone !== null;
    const extraCheck = destination.newNumber && eligibility.estimatedAmount > BigInt(event.max);
    let row: RefundRow;
    try {
      const inserted = await client.query<RefundRow>(
        `INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, customer_id, method, msisdn,
                                     new_number, status, estimated_amount, fee, currency, hold_until,
                                     extra_check_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 CASE WHEN $9 = 'AWAITING_HOLDER' THEN clock_timestamp() + make_interval(hours => $13) END, $14)
         RETURNING ${REFUND_COLUMNS.replace(/r\./g, '')}`,
        [
          customer.operatorId,
          wallet.ledger_id,
          wallet.event_id,
          input.wallet_id,
          customer.customerId,
          destination.method,
          destination.msisdn,
          destination.newNumber,
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
    // 5. Le titulaire reçoit son code dans la même transaction (un échec annule la demande).
    if (awaiting) await this.holder.startHolderChallenge(client, row.id, destination.holderPhone!);
    await this.audit.record(client, {
      ...context,
      operatorId: customer.operatorId,
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
      },
    });
    return toRefundRequest(row);
  }

  listMine(customer: CustomerContext, page: Page): Promise<RefundPage> {
    return this.tx.run(customer.operatorId, async (client) => {
      await client.query('SELECT promote_due_refund_requests()');
      return this.page(client, 'r.customer_id = $1', [customer.customerId], page);
    });
  }

  async listBackOffice(
    client: TxClient,
    actor: TenantActor,
    filters: { status: RefundStatus | null; eventId: string | null },
    page: Page,
  ): Promise<RefundPage> {
    await client.query('SELECT promote_due_refund_requests()');
    // Portée : les événements des demandes que le rôle exercé couvre (une chaîne par événement, jamais par ligne).
    const events = await client.query<{ event_id: string }>(
      `SELECT DISTINCT event_id FROM refund_request
        WHERE ($1::uuid IS NULL OR event_id = $1)`,
      [filters.eventId],
    );
    const allowed: string[] = [];
    for (const { event_id } of events.rows) {
      const chain = await resolveChain(client, { type: 'EVENT', id: event_id });
      if (exercisedRole(actor.principal, REFUND_BACKOFFICE_ROLES, chain)) allowed.push(event_id);
    }
    return this.page(
      client,
      'r.event_id = ANY($1::uuid[]) AND ($2::text IS NULL OR r.status = $2)',
      [allowed, filters.status],
      page,
    );
  }

  /** Une requête par page ; tri et curseur à la milliseconde (même grain des deux côtés : ni doublon ni trou). */
  private async page(
    client: TxClient,
    where: string,
    params: unknown[],
    page: Page,
  ): Promise<RefundPage> {
    const n = params.length;
    const { rows } = await client.query<RefundRow>(
      `SELECT ${REFUND_COLUMNS} FROM refund_request r
        WHERE ${where}
          AND ($${n + 1}::timestamptz IS NULL
               OR (date_trunc('milliseconds', r.created_at), r.id) < ($${n + 1}::timestamptz, $${n + 2}::uuid))
        ORDER BY date_trunc('milliseconds', r.created_at) DESC, r.id DESC
        LIMIT $${n + 3}`,
      [...params, page.after?.t ?? null, page.after?.i ?? null, page.limit + 1],
    );
    const hasMore = rows.length > page.limit;
    const kept = rows.slice(0, page.limit);
    const last = kept[kept.length - 1];
    return {
      data: kept.map(toRefundRequest),
      next_cursor: hasMore && last ? encodeCursor(last) : null,
      has_more: hasMore,
    };
  }

  async reject(
    client: TxClient,
    actor: TenantActor,
    refundRequestId: string,
    reason: string,
  ): Promise<RefundRequest> {
    await client.query('SELECT promote_due_refund_requests()');
    const found = await client.query<{ event_id: string; status: RefundStatus }>(
      'SELECT event_id, status FROM refund_request WHERE id = $1 FOR UPDATE',
      [refundRequestId],
    );
    const current = found.rows[0];
    if (!current) throw notFound();
    const chain = await resolveChain(client, { type: 'EVENT', id: current.event_id });
    if (!exercisedRole(actor.principal, REFUND_BACKOFFICE_ROLES, chain)) throw notFound();
    if (current.status !== 'REQUESTED') throw new ProblemException('CONFLICT_STATE');
    const { rows } = await client.query<RefundRow>(
      `UPDATE refund_request r
          SET status = 'REJECTED', reject_reason = $2, updated_at = clock_timestamp()
        WHERE r.id = $1 AND r.status = 'REQUESTED'
    RETURNING ${REFUND_COLUMNS}`,
      [refundRequestId, reason],
    );
    const row = rows[0];
    if (!row) throw new ProblemException('CONFLICT_STATE');
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'REFUND_REQUEST_REJECTED',
      objectType: 'refund_request',
      objectId: refundRequestId,
      before: { status: 'REQUESTED' },
      after: { status: 'REJECTED', reason },
    });
    return toRefundRequest(row);
  }
}
