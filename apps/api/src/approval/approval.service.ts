// Double validation au back-office (contracts/approvals.md, research R-08, ADR-74) : création d'une demande par
// l'opération à deux d'une mission, approbation (décision + exécution unique) et refus, chacun dans UNE transaction
// (le client de la transaction métier IdempotentTx) : décision, exécution, statut final et audit ensemble.
import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { resolveProblem } from '../errors/problem.filter';
import { isSqlError } from '../errors/sqlstate-map';
import { CommittedProblem } from '../idempotency/committed-problem';
import type { Principal, Role } from '../identity/principal';
import { exercisedRole, resolveChain } from '../identity/scope-resolver';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from './action-registry';
import { approvalRequestDto, type ApprovalRequestDto, type ApprovalRequestRow } from './approval.mapper';

export interface NewApprovalRequest {
  action: string;
  targetId: string | null;
  payload: unknown;
}

export interface ApprovalActor {
  principal: Principal;
  audit: AuditContext;
}

export interface ApprovalPage {
  data: ApprovalRequestDto[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface ApprovalListFilter {
  status?: string;
  action?: string;
  cursor?: string;
  limit: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED', 'FAILED'];

@Injectable()
export class ApprovalService {
  constructor(
    private readonly registry: ApprovalActionRegistry,
    private readonly audit: AuditService,
    private readonly tx: TenantTx,
  ) {}

  /**
   * Crée une demande (règle 2) : à appeler dans le `IdempotentTx.run` de l'opération à deux. L'auteur doit tenir le
   * rôle exigé sur la portée de l'action. Le contrôleur répond ensuite `respondAccepted(res, demande)`.
   */
  async request(client: TxClient, operatorId: string, input: NewApprovalRequest, actor: ApprovalActor): Promise<ApprovalRequestDto> {
    const definition = this.registry.get(input.action);
    if (!definition) {
      throw new ProblemException('VALIDATION_FAILED', { status: 422, detail: `Action non prise en charge : ${input.action}.` });
    }
    const payload = definition.validate(input.payload);
    const role = await this.roleOn(client, actor.principal, definition, payload, input.targetId);
    if (!role) throw new ProblemException('FORBIDDEN');
    const { rows } = await client.query<ApprovalRequestRow>(
      `INSERT INTO approval_request (operator_id, action, target_id, payload, requested_by)
       VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING *`,
      [operatorId, definition.action, input.targetId, JSON.stringify(payload), actor.principal.userId],
    );
    const dto = approvalRequestDto(rows[0]!);
    await this.audit.record(client, {
      ...actor.audit,
      actorRole: role,
      operatorId,
      action: 'APPROVAL_REQUESTED',
      objectType: 'approval_request',
      objectId: dto.approval_request_id,
      after: dto,
    });
    return dto;
  }

  /** Approbation (règle 3) : décision, puis exécution unique sous un point de sauvegarde ; EXECUTED ou FAILED. */
  async approve(client: TxClient, operatorId: string, id: string, note: string | null, actor: ApprovalActor): Promise<ApprovalRequestDto> {
    const { before, definition, role } = await this.prepareDecision(client, id, actor);
    const decided = await this.decide(client, id, actor.principal.userId, true, note);
    const payload = decided.payload as never;

    let after: ApprovalRequestRow;
    await client.query('SAVEPOINT approval_exec');
    try {
      const outcome = await definition.execute(client, {
        request: decided,
        payload,
        requestedBy: decided.requested_by,
        approvedBy: actor.principal.userId,
      });
      await client.query('RELEASE SAVEPOINT approval_exec');
      after = await this.finish(
        client,
        id,
        `status = 'EXECUTED', result = $2::jsonb, executed_tx_id = $3`,
        [JSON.stringify(outcome.result ?? null), outcome.executedTxId ?? null],
      );
    } catch (error) {
      if (!businessFailure(error)) throw error;
      await client.query('ROLLBACK TO SAVEPOINT approval_exec');
      const problem = resolveProblem(error);
      // Jamais de texte SQL : seul le détail d'une erreur métier de l'API est conservé.
      const reason = error instanceof ProblemException ? (error.detail ?? null) : null;
      after = await this.finish(client, id, `status = 'FAILED', failure_code = $2, failure_reason = $3`, [problem.code, reason]);
    }
    const dto = approvalRequestDto(after);
    await this.audit.record(client, {
      ...actor.audit,
      actorRole: role,
      operatorId,
      action: after.status === 'EXECUTED' ? 'APPROVAL_EXECUTED' : 'APPROVAL_FAILED',
      objectType: 'approval_request',
      objectId: id,
      approverId: actor.principal.userId,
      before: approvalRequestDto(before),
      after: dto,
    });
    return dto;
  }

  /** Refus (règle 4) : note obligatoire, aucune exécution. */
  async reject(client: TxClient, operatorId: string, id: string, note: string, actor: ApprovalActor): Promise<ApprovalRequestDto> {
    const { before, role } = await this.prepareDecision(client, id, actor);
    const after = await this.decide(client, id, actor.principal.userId, false, note);
    const dto = approvalRequestDto(after);
    await this.audit.record(client, {
      ...actor.audit,
      actorRole: role,
      operatorId,
      action: 'APPROVAL_REJECTED',
      objectType: 'approval_request',
      objectId: id,
      approverId: actor.principal.userId,
      before: approvalRequestDto(before),
      after: dto,
    });
    return dto;
  }

  /** Liste (règle 6) : demandes du prestataire que la personne peut lancer ou approuver (rôle sur la portée). */
  list(operatorId: string, principal: Principal, filter: ApprovalListFilter): Promise<ApprovalPage> {
    if (filter.status !== undefined && !STATUSES.includes(filter.status)) {
      throw new ProblemException('VALIDATION_FAILED', { status: 400, detail: 'status : valeur inconnue.' });
    }
    let position = decodeCursor(filter.cursor);
    return this.tx.run(operatorId, async (client) => {
      const visible: ApprovalRequestRow[] = [];
      let exhausted = false;
      // Les demandes que la personne ne peut pas voir sont sautées : on lit par lots jusqu'à remplir la page.
      while (visible.length <= filter.limit && !exhausted) {
        const batch = await this.page(client, filter, position, filter.limit + 1);
        exhausted = batch.length <= filter.limit;
        for (const row of batch) {
          position = [row.requested_at_text, row.id];
          if (await this.canSee(client, principal, row)) visible.push(row);
          if (visible.length > filter.limit) break;
        }
      }
      const data = visible.slice(0, filter.limit);
      const last = data[data.length - 1] as (ApprovalRequestRow & { requested_at_text: string }) | undefined;
      const hasMore = visible.length > filter.limit;
      return {
        data: data.map((row) => approvalRequestDto(row)),
        next_cursor: hasMore && last ? encodeCursor(last.requested_at_text, last.id) : null,
        has_more: hasMore,
      };
    });
  }

  /** Consultation : 404 si la demande est invisible (RLS) ou si la personne n'a pas le rôle de l'action. */
  get(operatorId: string, principal: Principal, id: string): Promise<ApprovalRequestDto> {
    if (!UUID.test(id)) throw new ProblemException('NOT_FOUND');
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<ApprovalRequestRow>('SELECT * FROM approval_request WHERE id = $1', [id]);
      const row = rows[0];
      if (!row || !(await this.canSee(client, principal, row))) throw new ProblemException('NOT_FOUND');
      return approvalRequestDto(row);
    });
  }

  // ------------------------------------------------------------------ Aides

  private async prepareDecision(client: TxClient, id: string, actor: ApprovalActor) {
    if (!UUID.test(id)) throw new ProblemException('NOT_FOUND');
    const { rows } = await client.query<ApprovalRequestRow>('SELECT * FROM approval_request WHERE id = $1', [id]);
    const before = rows[0];
    if (!before) throw new ProblemException('NOT_FOUND');
    const definition = this.registry.get(before.action);
    // Action sans définition : personne ne peut la décider dans cette version.
    if (!definition) throw new ProblemException('FORBIDDEN');
    const role = await this.roleOn(client, actor.principal, definition, before.payload, before.target_id);
    if (!role) throw new ProblemException('FORBIDDEN');
    return { before, definition, role };
  }

  /** `decide_approval_request` ; CL023 remonte (409) ; NULL = demande échue, passée EXPIRED : validée, puis 409. */
  private async decide(client: TxClient, id: string, approver: string, approve: boolean, note: string | null): Promise<ApprovalRequestRow> {
    const { rows } = await client.query<ApprovalRequestRow>('SELECT d.* FROM decide_approval_request($1, $2, $3, $4) d', [
      id,
      approver,
      approve,
      note,
    ]);
    const decided = rows[0];
    if (!decided?.id) {
      throw new CommittedProblem('APPROVAL_INVALID', { status: 409, detail: 'Demande expirée.' });
    }
    return decided;
  }

  private async finish(client: TxClient, id: string, set: string, params: unknown[]): Promise<ApprovalRequestRow> {
    const { rows } = await client.query<ApprovalRequestRow>(`UPDATE approval_request SET ${set} WHERE id = $1 RETURNING *`, [
      id,
      ...params,
    ]);
    return rows[0]!;
  }

  private async roleOn(
    client: TxClient,
    principal: Principal,
    definition: ApprovalActionDefinition,
    payload: unknown,
    targetId: string | null,
  ): Promise<Role | undefined> {
    const chain = await resolveChain(client, definition.scopeOf(payload, targetId));
    return exercisedRole(principal, [definition.requiredRole], chain);
  }

  private async canSee(client: TxClient, principal: Principal, row: ApprovalRequestRow): Promise<boolean> {
    const definition = this.registry.get(row.action);
    if (!definition) return false;
    try {
      return (await this.roleOn(client, principal, definition, row.payload, row.target_id)) !== undefined;
    } catch (error) {
      if (error instanceof ProblemException && error.code === 'NOT_FOUND') return false;
      throw error;
    }
  }

  private async page(
    client: TxClient,
    filter: ApprovalListFilter,
    position: [string, string] | null,
    limit: number,
  ): Promise<Array<ApprovalRequestRow & { requested_at_text: string }>> {
    const actions = this.registry.all().map((d) => d.action as string);
    const { rows } = await client.query<ApprovalRequestRow & { requested_at_text: string }>(
      `SELECT r.*, r.requested_at::text AS requested_at_text FROM approval_request r
        WHERE r.action = ANY($1::text[])
          AND ($2::text IS NULL OR r.action = $2)
          AND ($3::text IS NULL
               OR ($3 = 'EXPIRED' AND (r.status = 'EXPIRED' OR (r.status = 'PENDING' AND r.expires_at < clock_timestamp())))
               OR ($3 = 'PENDING' AND r.status = 'PENDING' AND r.expires_at >= clock_timestamp())
               OR ($3 NOT IN ('EXPIRED', 'PENDING') AND r.status = $3))
          AND ($4::timestamptz IS NULL OR (r.requested_at, r.id) < ($4::timestamptz, $5::uuid))
        ORDER BY r.requested_at DESC, r.id DESC
        LIMIT $6`,
      [actions, filter.action ?? null, filter.status ?? null, position?.[0] ?? null, position?.[1] ?? null, limit],
    );
    return rows;
  }
}

/** Échec métier de l'exécution : la demande passe FAILED (sinon l'erreur annule tout et la clé est relâchée). */
function businessFailure(error: unknown): boolean {
  if (error instanceof CommittedProblem) return false;
  if (error instanceof ProblemException) return error.status < 500;
  return isSqlError(error) && resolveProblem(error).status < 500;
}

function encodeCursor(requestedAt: string, id: string): string {
  return Buffer.from(JSON.stringify([requestedAt, id])).toString('base64url');
}

function decodeCursor(cursor: string | undefined): [string, string] | null {
  if (cursor === undefined || cursor === '') return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && UUID.test(String(value[1]))) {
      return [value[0], String(value[1])];
    }
  } catch {
    // illisible : refusé ci-dessous
  }
  throw new ProblemException('VALIDATION_FAILED', { status: 400, detail: 'cursor : curseur invalide.' });
}

/** Réponse `202 Accepted` d'une opération à deux : la demande créée, avec son adresse. */
export function respondAccepted(res: Response, request: ApprovalRequestDto): ApprovalRequestDto {
  res.status(202);
  res.setHeader('Location', `/v1/approval-requests/${request.approval_request_id}`);
  return request;
}
