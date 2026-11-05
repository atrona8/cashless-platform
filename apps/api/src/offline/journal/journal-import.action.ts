// Action à deux personnes `DEVICE_JOURNAL_IMPORT` (mission 7, lot WP20, T084 ; FR-034, FR-035 ; R-30.10 ; ADR-74).
// `SUPERVISOR` demande, un AUTRE `SUPERVISOR` du même prestataire approuve. L'exécution NE TRAITE AUCUNE opération :
// elle passe l'import à `PROCESSING` (`begin_device_journal_import`, qui contrôle l'empreinte et abandonne les lots
// du terminal restés en cours depuis plus de 15 min), RELIT les lots en base, recalcule empreinte, signatures et
// chaîne (rien n'est allégé « parce que déjà fait à la demande »), et rend l'état. Le travailleur `journal-import`
// prend la suite, opération par opération, par le processeur de WP19.
//
// La base ne contrôle PAS `p_actor` ni `p_approver` (note de WP05) : l'API vérifie ici que l'approbateur est une
// autre personne que le demandeur, active, du prestataire de la demande, titulaire du rôle `SUPERVISOR`. (Le service
// d'approbation a déjà vérifié son rôle SUR LA PORTÉE de l'événement ; ce contrôle ne le remplace pas, il le double.)
// Exécution : un refus qui précède `begin_` (ou la base) passe la demande `FAILED` (retour au point de sauvegarde) ;
// un écart de revérification APRÈS `begin_` clôt l'import `FAILED` et la demande est `EXECUTED` avec ce résultat
// (lever l'erreur annulerait `begin_` et laisserait l'import `PENDING` pour toujours).
import { Injectable } from '@nestjs/common';
import {
  ApprovalActionRegistry,
  type ApprovalActionDefinition,
  type ApprovalClosure,
} from '../../approval/action-registry';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { resolveProblem } from '../../errors/problem.filter';
import { isSqlError } from '../../errors/sqlstate-map';
import type { StaffRole } from '../../identity/roles.decorator';
import { isUuid, unprocessable } from '../../organization/platform/platform.dto';
import {
  batchesSha256,
  parseStoredBatches,
  readImportTerminal,
  verifyImportBatches,
  type ImportSummary,
} from './journal-verify';

export const JOURNAL_IMPORT_ROLES = ['SUPERVISOR'] as const;

export interface JournalImportPayload {
  import_id: string;
  device_id: string;
  /** SHA-256 hexadécimal du JCS de `batches` tel que stocké. */
  batches_sha256: string;
  summary: ImportSummary;
  reason: string;
  scope_type: 'EVENT';
  scope_id: string;
}

const FIELDS = new Set([
  'import_id',
  'device_id',
  'batches_sha256',
  'summary',
  'reason',
  'scope_type',
  'scope_id',
]);

/** Refus de la base à l'exécution : la demande passe FAILED avec ce motif lisible. */
const SQL_FAILURES: Readonly<Record<string, string>> = {
  CL053: 'Empreinte des lots différente de la demande, ou import déjà appliqué.',
  CL010: 'Un lot du terminal est en cours de traitement.',
  CL001: 'Import refusé par la base (approbateur, état ou lots).',
  CL052: 'Terminal non révoqué : import refusé.',
};

export interface ImportResultBody {
  device_id: string;
  status: 'PROCESSING' | 'APPLIED' | 'FAILED';
  results: unknown[];
}

@Injectable()
export class JournalImportActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly audit: AuditService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /** Approbateur : autre personne que le demandeur, active, du prestataire de la demande, `SUPERVISOR`. */
  async assertApprover(
    client: TxClient,
    operatorId: string,
    requestedBy: string,
    approvedBy: string,
  ): Promise<void> {
    if (approvedBy === requestedBy)
      throw new ProblemException('FORBIDDEN', {
        detail: 'L’approbateur doit être une autre personne que le demandeur.',
      });
    const { rows } = await client.query(
      `SELECT 1 FROM app_user u JOIN role_assignment ra ON ra.user_id = u.id
        WHERE u.id = $1 AND u.operator_id = $2 AND u.status = 'ACTIVE' AND ra.role = 'SUPERVISOR'
        LIMIT 1`,
      [approvedBy, operatorId],
    );
    if (rows.length === 0)
      throw new ProblemException('FORBIDDEN', {
        detail: 'L’approbateur n’est pas un superviseur actif du prestataire.',
      });
  }

  /**
   * Demande refusée, échue ou échouée : l'import `PENDING` passe `REJECTED` (`cancel_device_journal_import`, 0050),
   * ce qui libère l'index d'unicité et permet une nouvelle demande. Idempotent ; la base contrôle le prestataire
   * et que la demande d'approbation de l'import est bien fermée.
   */
  async cancel(
    client: TxClient,
    operatorId: string,
    importId: string,
    outcome: ApprovalClosure,
    actorId: string,
  ): Promise<void> {
    await client.query('SELECT cancel_device_journal_import($1, $2, $3)', [
      importId,
      actorId,
      outcome,
    ]);
    await this.audit.record(client, {
      actorId,
      actorRole: 'SUPERVISOR',
      origin: null,
      requestId: null,
      operatorId,
      action: 'DEVICE_JOURNAL_IMPORT_CANCELLED',
      objectType: 'device_journal_import',
      objectId: importId,
      after: { import_id: importId, status: 'REJECTED', reason: outcome },
    });
  }

  private definition(): ApprovalActionDefinition<JournalImportPayload> {
    return {
      action: 'DEVICE_JOURNAL_IMPORT',
      onClosed: async (client, { request, payload, outcome, actorId }) =>
        this.cancel(client, request.operator_id, payload.import_id, outcome, actorId),
      requiredRole: JOURNAL_IMPORT_ROLES as readonly StaffRole[],
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.scope_id }),
      validate: validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        if (request.target_id !== payload.import_id)
          throw new ProblemException('VALIDATION_FAILED', {
            status: 422,
            detail: 'L’import visé par la demande n’est pas celui de sa charge utile.',
          });
        await this.assertApprover(client, request.operator_id, requestedBy, approvedBy);
        try {
          const terminal = await readImportTerminal(client, payload.device_id);
          if (!terminal || terminal.eventId !== payload.scope_id)
            throw new ProblemException('VALIDATION_FAILED', {
              status: 422,
              detail: 'La portée de la demande n’est pas l’événement du terminal.',
            });
          if (terminal.status !== 'REVOKED')
            throw new ProblemException('CONFLICT_STATE', {
              status: 409,
              detail: 'Terminal non révoqué : import refusé.',
            });
          // PENDING|PROCESSING -> PROCESSING ; empreinte de la demande égale à la stockée (CL053).
          await client.query('SELECT * FROM begin_device_journal_import($1, $2, $3)', [
            payload.import_id,
            Buffer.from(payload.batches_sha256, 'hex'),
            approvedBy,
          ]);
          // Relecture des lots en base : empreinte recalculée, signatures, chaîne.
          const { rows } = await client.query<{
            device_id: string;
            batches: unknown;
            batches_sha256: Buffer;
          }>(
            'SELECT device_id, batches, batches_sha256 FROM device_journal_import_view($1, true)',
            [payload.import_id],
          );
          const stored = rows[0]!;
          const reason = this.discrepancy(payload, stored, terminal);
          if (reason !== null) {
            await client.query('SELECT finish_device_journal_import($1, $2, $3::jsonb)', [
              payload.import_id,
              'FAILED',
              JSON.stringify({
                device_id: payload.device_id,
                status: 'FAILED',
                results: [],
                reason,
              }),
            ]);
            await this.audit.record(client, {
              actorId: approvedBy,
              actorRole: 'SUPERVISOR',
              origin: null,
              requestId: null,
              operatorId: request.operator_id,
              action: 'DEVICE_JOURNAL_IMPORTED',
              objectType: 'device_journal_import',
              objectId: payload.import_id,
              approverId: approvedBy,
              after: { import_id: payload.import_id, status: 'FAILED', reason },
            });
            return {
              result: { device_id: payload.device_id, status: 'FAILED', results: [] },
            };
          }
          const body: ImportResultBody = {
            device_id: payload.device_id,
            status: 'PROCESSING',
            results: [],
          };
          return { result: body };
        } catch (error) {
          throw failure(error);
        }
      },
    };
  }

  /** Écart de revérification (code stable, jamais une valeur reçue) ; `null` : lots sains. */
  private discrepancy(
    payload: JournalImportPayload,
    stored: { device_id: string; batches: unknown; batches_sha256: Buffer },
    terminal: Parameters<typeof verifyImportBatches>[1],
  ): string | null {
    if (stored.device_id !== payload.device_id) return 'DEVICE_MISMATCH';
    const recomputed = batchesSha256(stored.batches);
    if (
      !recomputed.equals(stored.batches_sha256) ||
      recomputed.toString('hex') !== payload.batches_sha256
    )
      return 'DIGEST_MISMATCH';
    try {
      verifyImportBatches(parseStoredBatches(stored.batches), terminal);
    } catch (error) {
      if (error instanceof ProblemException) return error.code;
      throw error;
    }
    return null;
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

function validatePayload(raw: unknown): JournalImportPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (
    !isUuid(p.import_id) ||
    !isUuid(p.device_id) ||
    !isUuid(p.scope_id) ||
    p.scope_type !== 'EVENT'
  )
    throw unprocessable('import_id, device_id, scope_type (EVENT) et scope_id attendus.');
  if (typeof p.batches_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.batches_sha256))
    throw unprocessable('batches_sha256 : empreinte hexadécimale de 64 caractères attendue.');
  if (typeof p.summary !== 'object' || p.summary === null || Array.isArray(p.summary))
    throw unprocessable('summary : objet attendu.');
  if (typeof p.reason !== 'string' || p.reason.trim().length < 10)
    throw unprocessable('reason : au moins 10 caractères attendus.');
  return {
    import_id: p.import_id,
    device_id: p.device_id,
    batches_sha256: p.batches_sha256,
    summary: p.summary as ImportSummary,
    reason: p.reason.trim(),
    scope_type: 'EVENT',
    scope_id: p.scope_id,
  };
}
