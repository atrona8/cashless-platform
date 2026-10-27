// Action à deux personnes `SALE_REVERSAL` (mission 5b, lot WP12, T058 ; FR-017 ; contrat `reversePayment`, volet
// back-office ; ADR-122) : un `SUPERVISOR` ou un `ORGANIZER_ADMIN` de l'événement de la vente demande l'annulation,
// une SECONDE personne distincte, du même rôle sur le même événement, l'approuve ; source `BACKOFFICE`, auteur et
// valideur contrôlés par la base. Droit plus large que FR-017 (qui ne nomme que le SUPERVISOR) : décision du porteur
// du 22/10/2026 (ADR-122) ; borné par `SALE_REVERSAL_ROLES` (aucun autre rôle) et la portée de l'événement de la vente.
//
// Rien de la règle d'annulation n'est réécrit ici (C-001) : `assert_reversible` en mode BACKOFFICE relit en base
// la demande approuvée (auteur ≠ valideur, rôles, événement de la vente) ; l'exécuteur ne fait que l'appeler, écrire
// la contre-passation par le moteur et attribuer l'annulation à son auteur.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from '../approval/action-registry';
import { ApprovalService, type ApprovalActor } from '../approval/approval.service';
import type { ApprovalRequestDto } from '../approval/approval.mapper';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { resolveProblem } from '../errors/problem.filter';
import { isSqlError } from '../errors/sqlstate-map';
import type { StaffRole } from '../identity/roles.decorator';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import { isUuid, notFound, unprocessable } from '../organization/platform/platform.dto';
import { COMMENT_MAX, REVERSAL_REASONS, type ReversalReason } from './reversal.dto';

/** Rôles qui demandent et approuvent : le contrat nomme ceux-là, jamais d'autres (test de bornage). */
export const SALE_REVERSAL_ROLES: readonly StaffRole[] = ['SUPERVISOR', 'ORGANIZER_ADMIN'];

export interface SaleReversalPayload {
  transaction_id: string;
  reason: ReversalReason;
  comment?: string;
  /** Portée figée à la demande : l'événement de la vente, lu en base. */
  scope_type: 'EVENT';
  scope_id: string;
}

const FIELDS = new Set(['transaction_id', 'reason', 'comment', 'scope_type', 'scope_id']);

/** Refus de l'exécution : la demande passe FAILED avec ce code et ce motif. */
const SQL_FAILURES: Readonly<Record<string, string>> = {
  CL035: 'La vente a déjà été annulée.',
  CL036: 'Annulation refusée par la base : la demande approuvée ne couvre pas cette vente.',
  CL040: 'Fenêtre d’annulation dépassée.',
  CL001: 'Annulation refusée : événement ni en service ni en clôture.',
  P0002: 'Vente introuvable.',
  '23505': 'La vente a déjà été annulée.',
};

@Injectable()
export class SaleReversalActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly engine: LedgerEngineService,
    private readonly approvals: ApprovalService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /**
   * Demande d'annulation d'une vente au back-office : lit l'événement de la vente en base (la portée est figée, jamais
   * celle d'un corps) puis crée la demande par `ApprovalService.request` (rôle de l'auteur contrôlé sur cet événement).
   * À appeler dans l'`IdempotentTx.run` de la route qui expose la demande.
   */
  async request(
    client: TxClient,
    operatorId: string,
    input: { transactionId: string; reason: ReversalReason; comment?: string },
    actor: ApprovalActor,
  ): Promise<ApprovalRequestDto> {
    if (!isUuid(input.transactionId)) throw notFound();
    const { rows } = await client.query<{ event_id: string | null }>(
      `SELECT event_id FROM journal_transaction WHERE id = $1 AND type = 'PURCHASE'`,
      [input.transactionId],
    );
    const eventId = rows[0]?.event_id;
    if (!eventId) throw notFound();
    const payload: SaleReversalPayload = {
      transaction_id: input.transactionId,
      reason: input.reason,
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      scope_type: 'EVENT',
      scope_id: eventId,
    };
    return this.approvals.request(
      client,
      operatorId,
      { action: 'SALE_REVERSAL', targetId: input.transactionId, payload },
      actor,
    );
  }

  private definition(): ApprovalActionDefinition<SaleReversalPayload> {
    return {
      action: 'SALE_REVERSAL',
      requiredRole: SALE_REVERSAL_ROLES,
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.scope_id }),
      validate: validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        if (request.target_id !== payload.transaction_id)
          throw new ProblemException('REVERSAL_NOT_ALLOWED', {
            detail: 'La vente visée par la demande n’est pas celle de sa charge utile.',
          });
        try {
          const { rows } = await client.query<{
            ledger_id: string;
            event_id: string;
            media_id: string | null;
          }>('SELECT * FROM assert_reversible($1, $2, NULL, NULL, NULL, $3)', [
            payload.transaction_id,
            'BACKOFFICE',
            request.id,
          ]);
          const sale = rows[0]!;
          if (sale.event_id !== payload.scope_id)
            throw new ProblemException('REVERSAL_NOT_ALLOWED', {
              detail: 'La portée de la demande n’est pas l’événement de la vente.',
            });
          const { rows: ctx } = await client.query<{ currency: string; now: Date }>(
            `SELECT trim(l.currency) AS currency, clock_timestamp() AS now
               FROM ledger l WHERE l.id = $1`,
            [sale.ledger_id],
          );
          const written = await this.engine.execute(client, {
            type: 'REVERSAL',
            source: 'BACKOFFICE',
            // Clé dérivée de la demande : l'annulation n'est écrite qu'une fois par demande.
            idempotencyKey: `sale-reversal:${request.id}`,
            occurredAt: ctx[0]!.now,
            ledgerId: sale.ledger_id,
            eventId: sale.event_id,
            currency: ctx[0]!.currency,
            ...(sale.media_id ? { mediaId: sale.media_id } : {}),
            reversesId: payload.transaction_id,
            createdBy: requestedBy,
            approvedBy,
            payload: {},
            metadata: {
              approval_request_id: request.id,
              reason: payload.reason,
              ...(payload.comment !== undefined ? { comment: payload.comment } : {}),
            },
          });
          if (!written.transactionId || written.replayed)
            throw new ProblemException('IDEMPOTENCY_KEY_REUSED', {
              detail: 'Cette demande a déjà écrit une annulation.',
            });
          // Sans session : l'auteur de l'écriture est la personne attribuée (contrôlé par la base).
          await client.query('SELECT record_sale_attribution($1, NULL, NULL, $2)', [
            written.transactionId,
            requestedBy,
          ]);
          return {
            result: { transaction_id: written.transactionId, reverses_id: payload.transaction_id },
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

function validatePayload(raw: unknown): SaleReversalPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (!isUuid(p.transaction_id) || !isUuid(p.scope_id) || p.scope_type !== 'EVENT')
    throw unprocessable('transaction_id, scope_type (EVENT) et scope_id attendus.');
  if (typeof p.reason !== 'string' || !(REVERSAL_REASONS as readonly string[]).includes(p.reason))
    throw unprocessable(`reason : valeurs permises ${REVERSAL_REASONS.join(', ')}.`);
  let comment: string | undefined;
  if (p.comment !== undefined) {
    if (typeof p.comment !== 'string' || p.comment.trim() === '' || p.comment.length > COMMENT_MAX)
      throw unprocessable(`comment : texte de 1 à ${COMMENT_MAX} caractères.`);
    comment = p.comment.trim();
  }
  return {
    transaction_id: p.transaction_id,
    reason: p.reason as ReversalReason,
    ...(comment !== undefined ? { comment } : {}),
    scope_type: 'EVENT',
    scope_id: p.scope_id,
  };
}
