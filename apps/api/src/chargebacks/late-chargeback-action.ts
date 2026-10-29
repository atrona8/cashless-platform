// Action à deux personnes `LATE_CHARGEBACK` (mission 6, lot WP13, T066 ; FR-027 ; ADR-74, ADR-77 ; SPECIFICATION §12.1
// « contestation tardive »). Une contestation reçue grand livre `LOCKED` n'écrit rien à la réception : elle est
// conservée `late` avec son anomalie. Une PERSONNE du back-office (`ORGANIZER_ADMIN` ou `OPERATOR_ADMIN` de
// l'événement) demande l'écriture, une AUTRE l'approuve ; l'exécution écrit `CHARGEBACK` en source `BACKOFFICE` dans les
// bornes de `check_late_claim` (CL024) et avant `late_claims_until`, sous la MÊME clé que la voie normale.
// Jamais de demande « créée par le système » : une seule personne humaine affaiblirait la règle des deux personnes.
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
import { PspTopupLookup } from '../topups/psp/psp-topup-lookup';
import { ChargebackService } from './chargeback.service';

/** Rôles qui demandent et approuvent : « rôle de l'opération (back-office) », jamais d'autres (test de bornage). */
export const LATE_CHARGEBACK_ROLES: readonly StaffRole[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'];

export interface LateChargebackPayload {
  chargeback_id: string;
  /** Portée figée à la demande : l'événement de la recharge contestée, lu en base. */
  scope_type: 'EVENT';
  scope_id: string;
}

const FIELDS = new Set(['chargeback_id', 'scope_type', 'scope_id']);

/** Refus de l'exécution : la demande passe FAILED avec ce motif ; rien n'est écrit. */
const SQL_FAILURES: Readonly<Record<string, string>> = {
  CL024: 'Contestation tardive hors des bornes permises sur un grand livre verrouillé.',
  CL003: 'Date limite des réclamations tardives dépassée (grand livre verrouillé).',
  CL005: 'Période close : écriture datée avant la clôture.',
  CL043: 'Contestation au-delà du montant net restant crédité.',
  CL044: 'Contestation non permise pour cette recharge.',
  CL029: 'La contestation est déjà écrite ou en conflit.',
  P0002: 'Contestation ou portefeuille introuvable.',
  '23505': 'La contestation est déjà écrite.',
};

interface ChargebackRow {
  psp_chargeback_id: string;
  provider_dispute_id: string;
  amount: string;
  late: boolean;
  chargeback_tx_id: string | null;
  psp_topup_id: string;
  anomaly_status: string | null;
  event_id: string;
}

@Injectable()
export class LateChargebackActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly approvals: ApprovalService,
    private readonly chargebacks: ChargebackService,
    private readonly lookup: PspTopupLookup,
    private readonly audit: AuditService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /**
   * Demande d'écriture d'une contestation tardive : lit en base la contestation (`late`, non écrite, anomalie
   * ouverte), fige l'événement de sa recharge dans la charge utile, puis `ApprovalService.request` (rôle de l'auteur
   * contrôlé sur cet événement). Une seconde demande est refusée tant qu'une est `PENDING` ou `EXECUTED`.
   * À appeler dans l'`IdempotentTx.run` de la route.
   */
  async request(
    client: TxClient,
    operatorId: string,
    input: { chargebackId: string },
    actor: ApprovalActor,
  ): Promise<ApprovalRequestDto> {
    if (!isUuid(input.chargebackId)) throw notFound();
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `late-chargeback:${input.chargebackId}`,
    ]);
    const cb = await readChargeback(client, input.chargebackId);
    if (cb === undefined) throw notFound();
    if (!cb.late || cb.chargeback_tx_id !== null || cb.anomaly_status !== 'OPEN')
      throw new ProblemException('CONFLICT_STATE', {
        detail: 'Cette contestation n’est pas une contestation tardive à écrire.',
      });
    const open = await client.query(
      `SELECT 1 FROM approval_request
        WHERE action = 'LATE_CHARGEBACK' AND target_id = $1
          AND (status IN ('APPROVED', 'EXECUTED') OR (status = 'PENDING' AND expires_at > now()))
        LIMIT 1`,
      [input.chargebackId],
    );
    if (open.rowCount !== 0)
      throw new ProblemException('CONFLICT_STATE', {
        detail: 'Une demande existe déjà pour cette contestation.',
      });
    const payload: LateChargebackPayload = {
      chargeback_id: input.chargebackId,
      scope_type: 'EVENT',
      scope_id: cb.event_id,
    };
    const dto = await this.approvals.request(
      client,
      operatorId,
      { action: 'LATE_CHARGEBACK', targetId: input.chargebackId, payload },
      actor,
    );
    await this.audit.record(client, {
      ...actor.audit,
      operatorId,
      action: 'LATE_CHARGEBACK_REQUESTED',
      objectType: 'psp_chargeback',
      objectId: input.chargebackId,
      after: { approval_request_id: dto.approval_request_id, event_id: cb.event_id },
    });
    return dto;
  }

  private definition(): ApprovalActionDefinition<LateChargebackPayload> {
    return {
      action: 'LATE_CHARGEBACK',
      requiredRole: LATE_CHARGEBACK_ROLES,
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.scope_id }),
      validate: validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        if (request.target_id !== payload.chargeback_id)
          throw new ProblemException('APPROVAL_INVALID', {
            detail: 'La contestation visée par la demande n’est pas celle de sa charge utile.',
          });
        try {
          const first = await readChargeback(client, payload.chargeback_id);
          if (first === undefined) throw new ProblemException('NOT_FOUND');
          // Verrou de la recharge (ordre : recharge, portefeuille, comptes), puis relecture sous verrou.
          await this.lookup.lock(client, first.psp_topup_id);
          const cb = (await readChargeback(client, payload.chargeback_id))!;
          if (cb.chargeback_tx_id !== null)
            throw new ProblemException('CONFLICT_STATE', {
              detail: 'La contestation est déjà écrite.',
            });
          if (!cb.late)
            throw new ProblemException('CONFLICT_STATE', {
              detail: 'La contestation n’est pas tardive.',
            });
          if (cb.event_id !== payload.scope_id)
            throw new ProblemException('APPROVAL_INVALID', {
              detail: 'La portée de la demande n’est pas l’événement de la recharge.',
            });
          const topup = (await this.lookup.find(client, cb.psp_topup_id))!;
          const { rows: clock } = await client.query<{ now: Date }>(
            'SELECT clock_timestamp() AS now',
          );
          const write = {
            chargebackId: cb.psp_chargeback_id,
            disputeId: cb.provider_dispute_id,
            amount: BigInt(cb.amount),
          };
          const posted = await this.chargebacks.post(client, topup, write, {
            source: 'BACKOFFICE',
            occurredAt: clock[0]!.now,
            createdBy: requestedBy,
            approvedBy,
            metadata: { approval_request_id: request.id },
          });
          if (posted.replayed)
            throw new ProblemException('CONFLICT_STATE', {
              detail: 'La contestation est déjà écrite.',
            });
          await this.chargebacks.record(
            client,
            topup,
            'CHARGEBACK_RECORDED',
            write,
            {
              late: true,
              tx: posted.transactionId,
              blocked: posted.walletBlocked,
              approval_request_id: request.id,
            },
            { actorId: requestedBy, actorRole: null, origin: 'approval', requestId: null },
            approvedBy,
          );
          return {
            result: {
              chargeback_id: cb.psp_chargeback_id,
              transaction_id: posted.transactionId,
              wallet_blocked: posted.walletBlocked,
            },
            executedTxId: posted.transactionId,
          };
        } catch (error) {
          throw failure(error);
        }
      },
    };
  }
}

async function readChargeback(client: TxClient, id: string): Promise<ChargebackRow | undefined> {
  const { rows } = await client.query<ChargebackRow>(
    `SELECT c.psp_chargeback_id, c.provider_dispute_id, c.amount::text AS amount, c.late,
            c.chargeback_tx_id, c.psp_topup_id, a.status AS anomaly_status, t.event_id
       FROM psp_chargeback c
       JOIN psp_topup t ON t.psp_topup_id = c.psp_topup_id
       LEFT JOIN anomaly a ON a.id = c.anomaly_id
      WHERE c.psp_chargeback_id = $1`,
    [id],
  );
  return rows[0];
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

function validatePayload(raw: unknown): LateChargebackPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (!isUuid(p.chargeback_id) || !isUuid(p.scope_id) || p.scope_type !== 'EVENT')
    throw unprocessable('chargeback_id, scope_type (EVENT) et scope_id attendus.');
  return { chargeback_id: p.chargeback_id, scope_type: 'EVENT', scope_id: p.scope_id };
}
