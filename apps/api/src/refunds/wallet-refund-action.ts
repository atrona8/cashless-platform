// Action à deux personnes `WALLET_REFUND` (mission 9a, WP05 ; FR-008, FR-019, FR-020, NFR-001 ; décisions 3 et 7).
// Une personne (`OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` de l'événement) propose l'approbation d'une demande de
// remboursement ; une SECONDE personne distincte l'approuve (`approveApprovalRequest`), ce qui exécute le
// `WALLET_REFUND` du solde payé À CET INSTANT et passe la demande `PROCESSING`. L'API ne verse rien : le paiement est
// fait hors système (`confirmRefundRequest`). Modèle : `reversals/sale-reversal-action.ts`.
//
// Rien de la règle d'éligibilité n'est réécrit ici : `evaluateRefundEligibility` (WP04) est rappelée à l'exécution.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from '../approval/action-registry';
import { ApprovalService, type ApprovalActor } from '../approval/approval.service';
import type { ApprovalRequestDto } from '../approval/approval.mapper';
import { AuditService } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { resolveProblem } from '../errors/problem.filter';
import { isSqlError } from '../errors/sqlstate-map';
import type { StaffRole } from '../identity/roles.decorator';
import { exercisedRole, resolveChain } from '../identity/scope-resolver';
import { moneyAccountFor } from '../ledger/builders/festival/refund';
import { lockWalletPaidBalance } from '../ledger/db/ledger-queries';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import { isUuid, unprocessable } from '../organization/platform/platform.dto';
import type { TenantActor } from '../organization/tenant/tenant-access';
import { evaluateRefundEligibility } from './refund-eligibility';
import { REFUND_COLUMNS, toRefundRequest, type RefundRow } from './refund-requests.dto';

/** Rôles qui proposent et approuvent (décision 7) : jamais d'autres (test de bornage). */
export const WALLET_REFUND_ROLES: readonly StaffRole[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];

export const NOTE_MAX = 2000;

export interface WalletRefundPayload {
  refund_request_id: string;
  ledger_id: string;
  event_id: string;
  operator_id: string;
  /** `bo:` + clé d'idempotence de l'appel `approveRefundRequest` : le remboursement n'est écrit qu'une fois. */
  idempotency_key: string;
  note?: string;
}

const FIELDS = new Set([
  'refund_request_id',
  'ledger_id',
  'event_id',
  'operator_id',
  'idempotency_key',
  'note',
]);

/** Refus SQL connus de l'exécution : la demande d'approbation passe FAILED, la demande de remboursement reste. */
const SQL_FAILURES: Readonly<Record<string, string>> = {
  CL006:
    'Remboursement refusé : le débit du portefeuille est sous l’autorité de la passerelle locale.',
  CL001: 'Remboursement refusé : événement ni en service ni en clôture.',
};

interface RequestRow {
  id: string;
  operator_id: string;
  ledger_id: string;
  event_id: string;
  wallet_id: string;
  status: string;
  method: string;
  extra_check_required: boolean;
  approval_request_id: string | null;
}

const COLUMNS = `id, operator_id, ledger_id, event_id, wallet_id, status, method, extra_check_required,
  approval_request_id`;

/** Contrôles communs à la création de l'approbation et à son exécution (même ordre, mêmes refus). */
async function readOpen(
  client: TxClient,
  refundRequestId: string,
  lock: boolean,
): Promise<RequestRow> {
  await client.query('SELECT promote_due_refund_requests()');
  const { rows } = await client.query<RequestRow>(
    `SELECT ${COLUMNS} FROM refund_request WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [refundRequestId],
  );
  const row = rows[0];
  if (!row) throw new ProblemException('NOT_FOUND');
  return row;
}

/** `409 DEBIT_AUTHORITY_EDGE` AVANT toute écriture (CL006 reste le dernier recours). */
export async function refuseUnderEdge(client: TxClient, ledgerId: string): Promise<void> {
  const { rows } = await client.query<{ debit_authority: string }>(
    'SELECT debit_authority FROM ledger WHERE id = $1',
    [ledgerId],
  );
  if (rows[0]?.debit_authority === 'EDGE') throw new ProblemException('DEBIT_AUTHORITY_EDGE');
}

@Injectable()
export class WalletRefundActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly engine: LedgerEngineService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /**
   * `approveRefundRequest` : crée la demande d'approbation (rien n'est écrit au grand livre). Refuse déjà ce que le
   * contrat refuse « à la création » ; le ledger, l'événement et le prestataire sont LUS EN BASE, jamais d'un corps.
   */
  async request(
    client: TxClient,
    actor: TenantActor,
    input: { refundRequestId: string; idempotencyKey: string; note?: string },
  ): Promise<ApprovalRequestDto> {
    if (!isUuid(input.refundRequestId)) throw new ProblemException('NOT_FOUND');
    const row = await readOpen(client, input.refundRequestId, true);
    // Hors portée : même réponse qu'une demande inconnue.
    const chain = await resolveChain(client, { type: 'EVENT', id: row.event_id });
    if (!exercisedRole(actor.principal, WALLET_REFUND_ROLES, chain))
      throw new ProblemException('NOT_FOUND');
    await this.preconditions(client, row, input.note);
    const payload: WalletRefundPayload = {
      refund_request_id: row.id,
      ledger_id: row.ledger_id,
      event_id: row.event_id,
      operator_id: row.operator_id,
      idempotency_key: `bo:${input.idempotencyKey}`,
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    const approval = await this.approvals.request(
      client,
      actor.operatorId,
      { action: 'WALLET_REFUND', targetId: row.id, payload },
      { principal: actor.principal, audit: actor.audit } satisfies ApprovalActor,
    );
    await client.query(
      'UPDATE refund_request SET approval_request_id = $2, updated_at = clock_timestamp() WHERE id = $1',
      [row.id, approval.approval_request_id],
    );
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'REFUND_APPROVAL_REQUESTED',
      objectType: 'refund_request',
      objectId: row.id,
      after: { approval_request_id: approval.approval_request_id },
    });
    return approval;
  }

  /** Refus métier communs (états, autorité de débit, fenêtre, note du contrôle renforcé). */
  private async preconditions(client: TxClient, row: RequestRow, note: string | undefined) {
    if (row.status !== 'REQUESTED') throw new ProblemException('CONFLICT_STATE');
    await refuseUnderEdge(client, row.ledger_id);
    const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
    // Verrou du solde payé AVANT la lecture : le montant est celui de cet instant.
    await lockWalletPaidBalance(client, { occurredAt: now, payload: { walletId: row.wallet_id } });
    const eligibility = await evaluateRefundEligibility(client, row.wallet_id, now);
    if (!eligibility.eligible)
      throw new ProblemException(
        eligibility.reason === 'WINDOW_CLOSED' ? 'REFUND_WINDOW_CLOSED' : 'REFUND_NOT_ALLOWED',
      );
    if (row.extra_check_required && (note === undefined || note.trim() === ''))
      throw unprocessable('Contrôle renforcé : une note de vérification est obligatoire.');
    return { eligibility, now };
  }

  private definition(): ApprovalActionDefinition<WalletRefundPayload> {
    return {
      action: 'WALLET_REFUND',
      requiredRole: WALLET_REFUND_ROLES,
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.event_id }),
      validate: validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        try {
          if (request.target_id !== payload.refund_request_id)
            throw new ProblemException('APPROVAL_INVALID', {
              detail: 'La demande de remboursement visée n’est pas celle de la charge utile.',
            });
          const row = await readOpen(client, payload.refund_request_id, true);
          if (
            row.ledger_id !== payload.ledger_id ||
            row.event_id !== payload.event_id ||
            row.operator_id !== payload.operator_id
          )
            throw new ProblemException('APPROVAL_INVALID', {
              detail: 'La charge utile ne correspond plus à la demande de remboursement.',
            });
          const { eligibility, now } = await this.preconditions(client, row, payload.note);
          const ledger = await client.query<{ currency: string }>(
            'SELECT trim(currency) AS currency FROM ledger WHERE id = $1',
            [row.ledger_id],
          );
          const moneyAccount = moneyAccountFor(row.method);
          // Compte d'argent ouvert à la sélection du PSP (`open_psp_accounts`) : message exact s'il manque.
          const account = await client.query(
            'SELECT 1 FROM account WHERE ledger_id = $1 AND code = $2',
            [row.ledger_id, moneyAccount],
          );
          if (account.rowCount !== 1)
            throw new ProblemException('VALIDATION_FAILED', {
              status: 422,
              detail: `Compte d’argent ${moneyAccount} absent du grand livre : le prestataire de paiement de l’événement n’est pas ouvert.`,
            });
          const written = await this.engine.execute(client, {
            type: 'WALLET_REFUND',
            source: 'BACKOFFICE',
            idempotencyKey: payload.idempotency_key,
            occurredAt: now,
            ledgerId: row.ledger_id,
            eventId: row.event_id,
            currency: ledger.rows[0]!.currency,
            createdBy: requestedBy,
            approvedBy,
            payload: {
              walletId: row.wallet_id,
              // Solde payé de cet instant, frais compris : jamais le montant estimé de la demande.
              amount: eligibility.paid,
              moneyAccount,
            },
            metadata: { approval_request_id: request.id, refund_request_id: row.id },
          });
          if (!written.transactionId || written.replayed)
            throw new ProblemException('IDEMPOTENCY_KEY_REUSED', {
              detail: 'Cette clé a déjà écrit un remboursement.',
            });
          const updated = await client.query<RefundRow>(
            `UPDATE refund_request r
                SET status = 'PROCESSING', transaction_id = $2, approved_by = $3, approval_request_id = $4,
                    estimated_amount = $5, fee = $6, updated_at = clock_timestamp()
              WHERE r.id = $1 AND r.status = 'REQUESTED'
          RETURNING ${REFUND_COLUMNS}`,
            [
              row.id,
              written.transactionId,
              approvedBy,
              request.id,
              eligibility.estimatedAmount.toString(),
              eligibility.fee.toString(),
            ],
          );
          if (updated.rowCount !== 1) throw new ProblemException('CONFLICT_STATE');
          const exercised = await client.query<{ role: string }>(
            'SELECT role FROM role_assignment WHERE user_id = $1 AND role = ANY($2::text[]) LIMIT 1',
            [approvedBy, [...WALLET_REFUND_ROLES]],
          );
          await this.audit.record(client, {
            actorId: approvedBy,
            actorRole: exercised.rows[0]?.role ?? null,
            origin: 'approval',
            requestId: null,
            operatorId: row.operator_id,
            action: 'REFUND_REQUEST_PROCESSING',
            objectType: 'refund_request',
            objectId: row.id,
            approverId: approvedBy,
            before: { status: 'REQUESTED' },
            after: {
              status: 'PROCESSING',
              transaction_id: written.transactionId,
              amount: eligibility.paid,
              fee: eligibility.fee,
            },
          });
          return {
            result: toRefundRequest(updated.rows[0]!),
            executedTxId: written.transactionId,
          };
        } catch (error) {
          throw failure(error);
        }
      },
    };
  }
}

/** Refus SQL connu → erreur métier lisible (l'approbation passe FAILED) ; le reste repart tel quel. */
function failure(error: unknown): unknown {
  if (!isSqlError(error) || !(error.code in SQL_FAILURES)) return error;
  const problem = resolveProblem(error);
  return new ProblemException(problem.code, {
    status: problem.status,
    detail: SQL_FAILURES[error.code]!,
  });
}

function validatePayload(raw: unknown): WalletRefundPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (
    !isUuid(p.refund_request_id) ||
    !isUuid(p.ledger_id) ||
    !isUuid(p.event_id) ||
    !isUuid(p.operator_id)
  )
    throw unprocessable('refund_request_id, ledger_id, event_id et operator_id attendus.');
  const key = p.idempotency_key;
  if (typeof key !== 'string' || !key.startsWith('bo:') || key.length <= 3 || key.length > 255)
    throw unprocessable('idempotency_key : clé du back-office (préfixe bo:) attendue.');
  let note: string | undefined;
  if (p.note !== undefined) {
    if (typeof p.note !== 'string' || p.note.trim() === '' || p.note.length > NOTE_MAX)
      throw unprocessable(`note : texte de 1 à ${NOTE_MAX} caractères.`);
    note = p.note.trim();
  }
  return {
    refund_request_id: p.refund_request_id,
    ledger_id: p.ledger_id,
    event_id: p.event_id,
    operator_id: p.operator_id,
    idempotency_key: key,
    ...(note !== undefined ? { note } : {}),
  };
}
