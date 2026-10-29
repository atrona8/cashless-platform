// Action à deux personnes `CASH_DEPOSIT` : dépôt en banque des espèces en transit (mission 6, lot WP08, T041 ;
// FR-029, FR-031, IC-10 ; ADR-74). `ORGANIZER_ADMIN` ou `OPERATOR_ADMIN` de l'événement du grand livre
// demande, une AUTRE personne du même rôle l'approuve (auteur ≠ valideur : service d'approbation ET base).
// Écriture `CASH_DEPOSIT` (débit `A-BANQUE`, crédit `A-TRANSIT`) en source `BACKOFFICE`, jamais au-delà du
// solde de `A-TRANSIT` (refus de la base `CL007` : la demande passe `FAILED`, rien n'est écrit).
// La portée est lue en base (événement du grand livre), jamais d'un corps. Modèle : `SaleReversalActions`.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from '../approval/action-registry';
import type { ApprovalRequestDto } from '../approval/approval.mapper';
import { ApprovalService, type ApprovalActor } from '../approval/approval.service';
import { AuditService } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { resolveProblem } from '../errors/problem.filter';
import { isSqlError } from '../errors/sqlstate-map';
import type { StaffRole } from '../identity/roles.decorator';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import { isUuid, notFound, unprocessable } from '../organization/platform/platform.dto';

/** Rôles qui demandent et approuvent : le contrat nomme ceux-là, jamais d'autres (test de bornage). */
export const CASH_DEPOSIT_ROLES = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'] as const;

/** Référence de bordereau : 200 caractères au plus (contrat `requestCashDeposit`). */
export const BANK_REFERENCE_MAX = 200;

export interface CashDepositPayload {
  ledger_id: string;
  amount: number;
  bank_reference: string;
  /** Portée figée à la demande : l'événement du grand livre, lu en base. */
  scope_type: 'EVENT';
  scope_id: string;
}

const FIELDS = new Set(['ledger_id', 'amount', 'bank_reference', 'scope_type', 'scope_id']);

/** Refus de l'exécution : la demande passe FAILED avec ce motif lisible. */
const SQL_FAILURES: Readonly<Record<string, string>> = {
  CL007: 'Dépôt supérieur aux espèces en transit.',
  CL003: 'Grand livre verrouillé : dépôt impossible.',
  CL004: 'Événement en clôture : dépôt impossible.',
  CL005: 'Période close : dépôt impossible.',
};

@Injectable()
export class CashDepositActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly engine: LedgerEngineService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /**
   * Demande de dépôt : lit l'événement du grand livre en base (404 s'il est introuvable ou d'un autre
   * prestataire), crée la demande (rôle de l'auteur contrôlé sur cet événement), audit `CASH_DEPOSIT_REQUESTED`.
   */
  async request(
    client: TxClient,
    operatorId: string,
    input: { ledgerId: string; amount: number; bankReference: string },
    actor: ApprovalActor,
  ): Promise<ApprovalRequestDto> {
    if (!isUuid(input.ledgerId)) throw notFound();
    const { rows } = await client.query<{ scope_id: string }>(
      `SELECT scope_id FROM ledger WHERE id = $1 AND scope_type = 'EVENT'`,
      [input.ledgerId],
    );
    const eventId = rows[0]?.scope_id;
    if (!eventId) throw notFound();
    const payload: CashDepositPayload = {
      ledger_id: input.ledgerId,
      amount: input.amount,
      bank_reference: input.bankReference,
      scope_type: 'EVENT',
      scope_id: eventId,
    };
    const request = await this.approvals.request(
      client,
      operatorId,
      { action: 'CASH_DEPOSIT', targetId: input.ledgerId, payload },
      actor,
    );
    await this.audit.record(client, {
      ...actor.audit,
      operatorId,
      action: 'CASH_DEPOSIT_REQUESTED',
      objectType: 'approval_request',
      objectId: request.approval_request_id,
      after: {
        ledger_id: input.ledgerId,
        amount: input.amount,
        bank_reference: input.bankReference,
      },
    });
    return request;
  }

  private definition(): ApprovalActionDefinition<CashDepositPayload> {
    return {
      action: 'CASH_DEPOSIT',
      requiredRole: CASH_DEPOSIT_ROLES as readonly StaffRole[],
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.scope_id }),
      validate: validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        if (request.target_id !== payload.ledger_id)
          throw new ProblemException('VALIDATION_FAILED', {
            status: 422,
            detail: 'Le grand livre visé par la demande n’est pas celui de sa charge utile.',
          });
        try {
          // Grand livre et devise relus sous la transaction de l'approbation.
          const { rows } = await client.query<{ scope_id: string; currency: string; now: Date }>(
            `SELECT l.scope_id, trim(l.currency) AS currency, clock_timestamp() AS now
               FROM ledger l WHERE l.id = $1 AND l.scope_type = 'EVENT'`,
            [payload.ledger_id],
          );
          const ledger = rows[0];
          if (!ledger || ledger.scope_id !== payload.scope_id)
            throw new ProblemException('VALIDATION_FAILED', {
              status: 422,
              detail: 'La portée de la demande n’est pas l’événement du grand livre.',
            });
          const written = await this.engine.execute(client, {
            type: 'CASH_DEPOSIT',
            source: 'BACKOFFICE',
            // Un dépôt par demande.
            idempotencyKey: `cash-deposit:${request.id}`,
            occurredAt: ledger.now,
            ledgerId: payload.ledger_id,
            eventId: ledger.scope_id,
            currency: ledger.currency,
            createdBy: requestedBy,
            approvedBy,
            payload: { amount: BigInt(payload.amount) },
            metadata: {
              approval_request_id: request.id,
              bank_reference: payload.bank_reference,
            },
          });
          if (!written.transactionId || written.replayed)
            throw new ProblemException('IDEMPOTENCY_KEY_REUSED', {
              detail: 'Cette demande a déjà écrit un dépôt.',
            });
          return {
            result: { transaction_id: written.transactionId, amount: payload.amount },
            executedTxId: written.transactionId,
          };
        } catch (error) {
          throw failure(error);
        }
      },
    };
  }
}

/** Refus SQL connu → erreur métier avec un motif lisible (la demande passe FAILED) ; le reste repart tel quel. */
function failure(error: unknown): unknown {
  if (!isSqlError(error) || !(error.code in SQL_FAILURES)) return error;
  const problem = resolveProblem(error);
  return new ProblemException(problem.code, {
    status: problem.status,
    detail: SQL_FAILURES[error.code]!,
  });
}

function validatePayload(raw: unknown): CashDepositPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (!isUuid(p.ledger_id) || !isUuid(p.scope_id) || p.scope_type !== 'EVENT')
    throw unprocessable('ledger_id, scope_type (EVENT) et scope_id attendus.');
  if (typeof p.amount !== 'number' || !Number.isSafeInteger(p.amount) || p.amount <= 0)
    throw unprocessable('amount : entier strictement positif attendu.');
  if (
    typeof p.bank_reference !== 'string' ||
    p.bank_reference.trim() === '' ||
    p.bank_reference.length > BANK_REFERENCE_MAX ||
    /[\r\n]/.test(p.bank_reference)
  )
    throw unprocessable(
      `bank_reference : texte d’une ligne de 1 à ${BANK_REFERENCE_MAX} caractères.`,
    );
  return {
    ledger_id: p.ledger_id,
    amount: p.amount,
    bank_reference: p.bank_reference.trim(),
    scope_type: 'EVENT',
    scope_id: p.scope_id,
  };
}
