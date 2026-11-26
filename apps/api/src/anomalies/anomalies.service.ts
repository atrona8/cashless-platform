// Anomalies du back-office (mission 11b, WP07 ; FR-008, FR-009, FR-010, C-002). Lecture dans `anomaly_overview`
// (sous la RLS du prestataire) ; classement par `classify_anomaly` seulement : la base décide du type classable, du
// statut et du motif ; l'API n'écrit jamais `anomaly` directement et n'écrit rien au grand livre.
// Portée (dans le SQL, jamais après lecture) : OPERATOR_ADMIN = tout le prestataire, y compris les anomalies sans
// grand livre (`ledger_id IS NULL`, signal de sécurité sans événement) ; ORGANIZER_ADMIN = les anomalies dont
// l'événement appartient à un organisateur qu'il administre (une anomalie sans événement lui est invisible : 404).
// L'auteur d'un classement est toujours `principal.userId` de la session : `classify_anomaly` ne vérifie pas que
// `p_actor` appartient au prestataire, aucune valeur de la requête n'y est jamais passée.
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { auditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { isSqlError } from '../errors/sqlstate-map';
import { requestPrincipal, type Principal } from '../identity/principal';
import type { RolesRequest } from '../identity/roles.guard';
import {
  ANOMALY_COLUMNS,
  anomalyDto,
  invalid,
  pageOf,
  type AnomalyListQuery,
  type AnomalyRow,
} from './anomalies.dto';

/** Étendue de lecture de la personne : tout le prestataire, ou les organisateurs qu'elle administre. */
export interface Visibility {
  operatorId: string;
  role: 'OPERATOR_ADMIN' | 'ORGANIZER_ADMIN';
  organizers: string[];
}

@Injectable()
export class AnomaliesService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
  ) {}

  /** Rôle exercé et portée ; aucun des deux rôles admis sur le prestataire de la personne : 403. */
  visibility(req: Request): Visibility {
    const principal = requestPrincipal(req);
    const operatorId = principal.operatorId;
    if (operatorId === null) throw new ProblemException('FORBIDDEN');
    const held = (a: Principal['assignments'][number]) =>
      a.role === 'OPERATOR_ADMIN' && a.scopeType === 'OPERATOR' && a.scopeId === operatorId;
    let visibility: Visibility;
    if (principal.assignments.some(held)) {
      visibility = { operatorId, role: 'OPERATOR_ADMIN', organizers: [] };
    } else {
      const organizers = principal.assignments
        .filter((a) => a.role === 'ORGANIZER_ADMIN' && a.scopeType === 'ORGANIZER' && a.scopeId)
        .map((a) => a.scopeId!);
      if (organizers.length === 0) throw new ProblemException('FORBIDDEN');
      visibility = { operatorId, role: 'ORGANIZER_ADMIN', organizers };
    }
    (req as RolesRequest).exercisedRole = visibility.role;
    return visibility;
  }

  /** Condition de portée ajoutée à toute lecture de la vue (`params` reçoit ses valeurs). */
  private scopeClause(v: Visibility, params: unknown[]): string {
    if (v.role === 'OPERATOR_ADMIN') return 'TRUE';
    params.push(v.organizers);
    return `event_id IN (SELECT id FROM event WHERE organizer_id = ANY($${params.length}::uuid[]))`;
  }

  list(req: Request, q: AnomalyListQuery) {
    const v = this.visibility(req);
    return this.tenantTx.run(v.operatorId, async (client) => {
      const params: unknown[] = [];
      const where: string[] = [this.scopeClause(v, params)];
      const add = (sql: string, value: unknown) => {
        params.push(value);
        where.push(sql.replace('$$', `$${params.length}`));
      };
      if (q.eventId) add('event_id = $$', q.eventId);
      if (q.kind) add('kind = $$', q.kind);
      if (q.status) add('status = $$', q.status);
      if (q.from) add('created_at >= $$::timestamptz', q.from);
      if (q.to) add('created_at < $$::timestamptz', q.to);
      if (q.cursor) {
        params.push(q.cursor[0], q.cursor[1]);
        where.push(
          `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      params.push(q.limit + 1);
      const { rows } = await client.query<AnomalyRow>(
        `SELECT ${ANOMALY_COLUMNS} FROM anomaly_overview
          WHERE ${where.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length}`,
        params,
      );
      return pageOf(rows, q.limit);
    });
  }

  /** Classement dans la transaction idempotente `client` ; `404` hors portée, comme une anomalie inexistante. */
  async classify(req: Request, client: TxClient, anomalyId: string, reason: string) {
    const v = this.visibility(req);
    const principal = requestPrincipal(req);
    const found = await this.find(client, v, anomalyId);
    if (!found) throw new ProblemException('NOT_FOUND');
    try {
      // Un seul appel : la base décide (type classable, statut OPEN, motif) et verrouille la ligne.
      await client.query('SELECT classify_anomaly($1::uuid, $2, $3::uuid)', [
        anomalyId,
        reason,
        principal.userId,
      ]);
    } catch (error) {
      throw translate(error);
    }
    const after = (await this.find(client, v, anomalyId))!;
    await this.audit.record(client, {
      ...auditContext(req),
      operatorId: v.operatorId,
      action: 'ANOMALY_CLASSIFIED',
      objectType: 'anomaly',
      objectId: anomalyId,
      before: { status: found.status },
      after: { status: after.status, kind: after.kind, reason },
    });
    return anomalyDto(after);
  }

  /** Anomalie dans la portée de la personne (sous la RLS du prestataire), ou `undefined`. */
  async find(client: TxClient, v: Visibility, anomalyId: string) {
    const params: unknown[] = [anomalyId];
    const scope = this.scopeClause(v, params);
    const { rows } = await client.query<AnomalyRow>(
      `SELECT ${ANOMALY_COLUMNS} FROM anomaly_overview WHERE id = $1 AND ${scope}`,
      params,
    );
    return rows[0];
  }
}

/** Erreurs de `classify_anomaly` (0101) → problèmes du contrat ; aucun code nouveau (D10). */
function translate(error: unknown): unknown {
  if (!isSqlError(error)) return error;
  switch (error.code) {
    case 'CL066':
      return new ProblemException('NOT_FOUND');
    case 'CL067':
      return invalid(
        'Ce type d’anomalie ne se classe pas : il demande une écriture au grand livre.',
        {
          reason: 'ANOMALY_KIND_NOT_CLASSIFIABLE',
        },
      );
    case 'CL068':
      return new ProblemException('CONFLICT_STATE');
    case 'CL069':
      return invalid('reason : texte de 1 à 500 caractères attendu.');
    default:
      return error;
  }
}
