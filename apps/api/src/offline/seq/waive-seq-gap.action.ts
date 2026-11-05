// Action à deux personnes `WAIVE_SEQ_GAP` (mission 7, lot WP20, T083 ; FR-032, FR-033 ; ADR-74). `SUPERVISOR` demande,
// un AUTRE `SUPERVISOR` approuve. L'exécution rejoue les contrôles de la demande (course entre les deux : le numéro
// a pu arriver, ou un lot le couvrir) puis appelle `waive_seq_gap` : registre `WAIVED` (canal `WAIVER`), anomalie
// `SEQ_GAP` du numéro `RESOLVED`, curseur avancé, AUCUNE écriture comptable. Un refus de la base (`CL012`, `CL010`)
// fait passer la demande `FAILED` avec un message lisible. La portée est lue en base, jamais d'un corps.
import { Injectable } from '@nestjs/common';
import {
  ApprovalActionRegistry,
  type ApprovalActionDefinition,
} from '../../approval/action-registry';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { resolveProblem } from '../../errors/problem.filter';
import { isSqlError } from '../../errors/sqlstate-map';
import type { StaffRole } from '../../identity/roles.decorator';
import { isUuid, unprocessable } from '../../organization/platform/platform.dto';

export const WAIVE_SEQ_GAP_ROLES = ['SUPERVISOR'] as const;

export interface WaiveSeqGapPayload {
  device_id: string;
  /** Numéro en TEXTE (jamais un nombre : au-delà de 2^53 un flottant l'arrondirait). */
  seq: string;
  reason: string;
  scope_type: 'EVENT';
  scope_id: string;
}

const FIELDS = new Set(['device_id', 'seq', 'reason', 'scope_type', 'scope_id']);

/** Refus de l'exécution : la demande passe FAILED avec ce motif lisible. */
const SQL_FAILURES: Readonly<Record<string, string>> = {
  CL012: 'Ce numéro n’est plus un trou (déjà reçu, ou au-delà du dernier numéro vu).',
  CL010: 'Un lot en cours de traitement couvre ce numéro.',
};

export interface SeqStatusResult {
  device_serial: string;
  contiguous_acked_seq: number;
  max_seen_seq: number;
  missing_seqs: number[];
  next_seq_floor: number;
}

@Injectable()
export class WaiveSeqGapActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly audit: AuditService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  private definition(): ApprovalActionDefinition<WaiveSeqGapPayload> {
    return {
      action: 'WAIVE_SEQ_GAP',
      requiredRole: WAIVE_SEQ_GAP_ROLES as readonly StaffRole[],
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.scope_id }),
      validate: validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        if (request.target_id !== payload.device_id)
          throw new ProblemException('VALIDATION_FAILED', {
            status: 422,
            detail: 'Le terminal visé par la demande n’est pas celui de sa charge utile.',
          });
        try {
          const { rows } = await client.query<{ event_id: string | null }>(
            'SELECT event_id FROM device WHERE id = $1',
            [payload.device_id],
          );
          if (rows[0]?.event_id !== payload.scope_id)
            throw new ProblemException('VALIDATION_FAILED', {
              status: 422,
              detail: 'La portée de la demande n’est pas l’événement du terminal.',
            });
          // Mêmes contrôles qu'à la demande (course entre les deux), puis la levée.
          await client.query('SELECT check_seq_gap_waivable($1, $2::bigint)', [
            payload.device_id,
            payload.seq,
          ]);
          await client.query('SELECT waive_seq_gap($1, $2::bigint, $3, $4, $5)', [
            payload.device_id,
            payload.seq,
            requestedBy,
            approvedBy,
            payload.reason,
          ]);
          const status = await this.status(client, payload.device_id);
          await this.audit.record(client, {
            actorId: approvedBy,
            actorRole: 'SUPERVISOR',
            origin: null,
            requestId: null,
            operatorId: request.operator_id,
            action: 'SEQ_GAP_WAIVED',
            objectType: 'device',
            objectId: payload.device_id,
            approverId: approvedBy,
            after: {
              device_id: payload.device_id,
              seq: payload.seq,
              reason: payload.reason,
              requested_by: requestedBy,
              approved_by: approvedBy,
              approval_request_id: request.id,
            },
          });
          return { result: status };
        } catch (error) {
          throw failure(error);
        }
      },
    };
  }

  private async status(client: TxClient, deviceId: string): Promise<SeqStatusResult> {
    const { rows } = await client.query<{
      serial: string;
      contiguous: string;
      last_seq: string;
      floor: string;
    }>(
      `SELECT serial, contiguous_acked_seq::text AS contiguous, last_seq::text AS last_seq,
              next_seq_floor::text AS floor
         FROM device WHERE id = $1`,
      [deviceId],
    );
    const d = rows[0]!;
    const { rows: missing } = await client.query<{ seq: string }>(
      'SELECT s::text AS seq FROM device_missing_seqs($1, 1000) s',
      [deviceId],
    );
    return {
      device_serial: d.serial,
      contiguous_acked_seq: Number(d.contiguous),
      max_seen_seq: Number(d.last_seq),
      missing_seqs: missing.map((m) => Number(m.seq)),
      next_seq_floor: Number(d.floor),
    };
  }
}

/** Refus SQL connu -> erreur métier avec un motif lisible (la demande passe FAILED) ; le reste repart tel quel. */
function failure(error: unknown): unknown {
  if (!isSqlError(error) || !(error.code in SQL_FAILURES)) return error;
  const problem = resolveProblem(error);
  return new ProblemException(problem.code, {
    status: problem.status,
    detail: SQL_FAILURES[error.code]!,
  });
}

function validatePayload(raw: unknown): WaiveSeqGapPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (!isUuid(p.device_id) || !isUuid(p.scope_id) || p.scope_type !== 'EVENT')
    throw unprocessable('device_id, scope_type (EVENT) et scope_id attendus.');
  if (
    typeof p.seq !== 'string' ||
    !/^[1-9][0-9]{0,15}$/.test(p.seq) ||
    BigInt(p.seq) > 9_007_199_254_740_991n
  )
    throw unprocessable('seq : texte décimal de 1 à 2^53 - 1 attendu.');
  if (typeof p.reason !== 'string' || p.reason.trim().length < 10)
    throw unprocessable('reason : au moins 10 caractères attendus.');
  return {
    device_id: p.device_id,
    seq: p.seq,
    reason: p.reason.trim(),
    scope_type: 'EVENT',
    scope_id: p.scope_id,
  };
}
