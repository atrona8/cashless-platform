// Action à deux personnes `WALLET_UNBLOCK` (mission 6, lot WP13, T067 ; FR-028 ; ADR-74) : `ORGANIZER_ADMIN` seul, auteur
// et valideur distincts. Ne débloque qu'un portefeuille bloqué par une contestation (au moins une ligne
// `psp_chargeback` avec `wallet_blocked`) ; un portefeuille bloqué pour une autre cause (perte, fraude) n'est jamais
// débloqué par cette voie. La base revérifie tout à l'exécution (`unblock_wallet` : demande approuvée, deux
// `ORGANIZER_ADMIN` actifs, postérieure au dernier blocage).
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
import { isUuid, notFound, unprocessable } from '../organization/platform/platform.dto';

/** Rôle unique du déblocage (FR-028) : test de bornage. */
export const WALLET_UNBLOCK_ROLE: StaffRole = 'ORGANIZER_ADMIN';

export interface WalletUnblockPayload {
  wallet_id: string;
  /** Portée figée à la demande : l'événement du portefeuille, lu en base. */
  scope_type: 'EVENT';
  scope_id: string;
}

const FIELDS = new Set(['wallet_id', 'scope_type', 'scope_id']);

const SQL_FAILURES: Readonly<Record<string, string>> = {
  CL023: 'Déblocage refusé : la demande ne remplit pas les conditions des deux personnes.',
  CL029:
    'Déblocage refusé : portefeuille non bloqué par une contestation, ou demande antérieure au blocage.',
  P0002: 'Portefeuille ou demande introuvable.',
};

@Injectable()
export class WalletUnblockActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /**
   * Demande de déblocage : l'événement du portefeuille est lu EN BASE (jamais dans un corps) ; portefeuille inconnu du
   * prestataire : `404` sans fuite ; non bloqué par une contestation : `409`. À appeler dans l'`IdempotentTx.run`.
   */
  async request(
    client: TxClient,
    operatorId: string,
    input: { walletId: string },
    actor: ApprovalActor,
  ): Promise<ApprovalRequestDto> {
    if (!isUuid(input.walletId)) throw notFound();
    const { rows } = await client.query<{ status: string; event_id: string | null }>(
      `SELECT w.status, CASE WHEN l.scope_type = 'EVENT' THEN l.scope_id END AS event_id
         FROM wallet w JOIN ledger l ON l.id = w.ledger_id WHERE w.id = $1`,
      [input.walletId],
    );
    const wallet = rows[0];
    if (wallet === undefined || wallet.event_id === null) throw notFound();
    const blocked = await client.query(
      `SELECT 1 FROM psp_chargeback c JOIN psp_topup t ON t.psp_topup_id = c.psp_topup_id
        WHERE t.wallet_id = $1 AND c.wallet_blocked AND c.unblocked_by_request IS NULL LIMIT 1`,
      [input.walletId],
    );
    if (wallet.status !== 'BLOCKED' || blocked.rowCount === 0)
      throw new ProblemException('CONFLICT_STATE', {
        detail: 'Ce portefeuille n’est pas bloqué par une contestation.',
      });
    const payload: WalletUnblockPayload = {
      wallet_id: input.walletId,
      scope_type: 'EVENT',
      scope_id: wallet.event_id,
    };
    const dto = await this.approvals.request(
      client,
      operatorId,
      { action: 'WALLET_UNBLOCK', targetId: input.walletId, payload },
      actor,
    );
    await this.audit.record(client, {
      ...actor.audit,
      operatorId,
      action: 'WALLET_UNBLOCK_REQUESTED',
      objectType: 'wallet',
      objectId: input.walletId,
      after: { approval_request_id: dto.approval_request_id, event_id: wallet.event_id },
    });
    return dto;
  }

  private definition(): ApprovalActionDefinition<WalletUnblockPayload> {
    return {
      action: 'WALLET_UNBLOCK',
      requiredRole: WALLET_UNBLOCK_ROLE,
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.scope_id }),
      validate: validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        if (request.target_id !== payload.wallet_id)
          throw new ProblemException('APPROVAL_INVALID', {
            detail: 'Le portefeuille visé par la demande n’est pas celui de sa charge utile.',
          });
        try {
          await client.query('SELECT unblock_wallet($1, $2)', [payload.wallet_id, request.id]);
          await this.audit.record(client, {
            operatorId: request.operator_id,
            actorId: requestedBy,
            actorRole: null,
            origin: 'approval',
            requestId: null,
            action: 'WALLET_UNBLOCKED',
            objectType: 'wallet',
            objectId: payload.wallet_id,
            approverId: approvedBy,
            after: { approval_request_id: request.id },
          });
          return { result: { wallet_id: payload.wallet_id, status: 'ACTIVE' } };
        } catch (error) {
          throw failure(error);
        }
      },
    };
  }
}

function failure(error: unknown): unknown {
  if (!isSqlError(error) || !(error.code in SQL_FAILURES)) return error;
  const problem = resolveProblem(error);
  return new ProblemException(problem.code, {
    status: problem.status,
    detail: SQL_FAILURES[error.code]!,
  });
}

function validatePayload(raw: unknown): WalletUnblockPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (!isUuid(p.wallet_id) || !isUuid(p.scope_id) || p.scope_type !== 'EVENT')
    throw unprocessable('wallet_id, scope_type (EVENT) et scope_id attendus.');
  return { wallet_id: p.wallet_id, scope_type: 'EVENT', scope_id: p.scope_id };
}
