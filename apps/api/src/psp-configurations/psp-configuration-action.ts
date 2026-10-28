// Action à deux personnes `PSP_CONFIGURATION` (mission 6, lot WP10, T050 ; FR-009, FR-011, FR-031 ; A15, A18,
// A30, A34) : activation, suspension, réactivation. Aucune route ne change le statut en direct.
//
// A RELIRE PAR UNE PERSONNE (approbation). Charge de la demande : `{psp_configuration_id, version, status,
// compliance_ref?}` composée ICI à partir du chemin et de la version lue en base (le corps HTTP reste
// `{status, compliance_ref}`), plus `scope_type`/`scope_id` (prestataire lu en base) pour la portée du registre.
// Auteur ≠ valideur, auteur de la configuration ≠ valideur d'une activation, version, règle de frais,
// `compliance_ref` : contrôlés par `activate_psp_configuration` (la base est l'arbitre).
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

/** Rôles qui demandent et approuvent : l'OPERATOR_ADMIN seul (test de bornage). */
export const PSP_CONFIGURATION_ROLES: readonly StaffRole[] = ['OPERATOR_ADMIN'];

export interface PspConfigurationPayload {
  psp_configuration_id: string;
  version: number;
  status: 'ACTIVE' | 'SUSPENDED';
  compliance_ref?: string;
  scope_type: 'OPERATOR';
  scope_id: string;
}

const FIELDS = new Set([
  'psp_configuration_id',
  'version',
  'status',
  'compliance_ref',
  'scope_type',
  'scope_id',
]);

/** Transitions permises : DRAFT → ACTIVE, ACTIVE → SUSPENDED, SUSPENDED → ACTIVE. */
const TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE'],
};

/** Refus de l'exécution : la demande passe FAILED avec ce motif (le code SQL seul est lu). */
const SQL_FAILURES: Readonly<Record<string, string>> = {
  CL023:
    'Refusé par la base : demande sans rapport avec cette version, déjà utilisée, auteur et valideur ' +
    'non distincts, activation par le créateur ou référence de conformité manquante.',
  CL029:
    'Refusé par la base : configuration déjà active, échue, remplacée, défaut déjà pris ou règle de ' +
    'frais absente.',
  CL001: 'Refusé par la base : configuration invalide.',
  P0002: 'Configuration introuvable.',
};

@Injectable()
export class PspConfigurationActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /** Crée la demande (à appeler dans l'`IdempotentTx.run` de la route). Portée et version lues en base. */
  async request(
    client: TxClient,
    operatorId: string,
    input: { configId: string; status: 'ACTIVE' | 'SUSPENDED'; complianceRef?: string },
    actor: ApprovalActor,
  ): Promise<ApprovalRequestDto> {
    if (!isUuid(input.configId)) throw notFound();
    const { rows } = await client.query<{ status: string; version: number; operator_id: string }>(
      `SELECT status, version, operator_id FROM psp_configuration WHERE psp_configuration_id = $1`,
      [input.configId],
    );
    const config = rows[0];
    if (!config) throw notFound();
    if (!TRANSITIONS[config.status]?.includes(input.status))
      throw new ProblemException('CONFLICT_STATE', {
        detail: `Transition impossible : ${config.status} vers ${input.status}.`,
      });
    const payload: PspConfigurationPayload = {
      psp_configuration_id: input.configId,
      version: config.version,
      status: input.status,
      ...(input.complianceRef !== undefined ? { compliance_ref: input.complianceRef } : {}),
      scope_type: 'OPERATOR',
      scope_id: config.operator_id,
    };
    return this.approvals.request(
      client,
      operatorId,
      { action: 'PSP_CONFIGURATION', targetId: input.configId, payload },
      actor,
    );
  }

  private definition(): ApprovalActionDefinition<PspConfigurationPayload> {
    return {
      action: 'PSP_CONFIGURATION',
      requiredRole: PSP_CONFIGURATION_ROLES,
      scopeOf: (payload) => ({ type: 'OPERATOR', id: payload.scope_id }),
      validate: validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        try {
          const before = await this.state(client, payload.psp_configuration_id);
          // Messages lisibles seulement : la base reste l'arbitre de chaque contrôle.
          if (before && before.version !== payload.version)
            throw new ProblemException('CONFLICT_STATE', {
              detail: 'La configuration a une version plus récente que celle de la demande.',
            });
          if (payload.status === 'ACTIVE' && !(await this.hasFeeRule(client, payload)))
            throw new ProblemException('CONFLICT_STATE', {
              detail:
                'Aucune règle de frais PSP_CONFIGURATION en vigueur pour cette configuration.',
            });
          await client.query('SELECT activate_psp_configuration($1, $2)', [
            payload.psp_configuration_id,
            request.id,
          ]);
          const after = (await this.state(client, payload.psp_configuration_id))!;
          await this.audit.record(client, {
            actorId: requestedBy,
            actorRole: 'OPERATOR_ADMIN',
            origin: null,
            requestId: null,
            operatorId: request.operator_id,
            action: 'PSP_CONFIGURATION_STATUS_CHANGED',
            objectType: 'psp_configuration',
            objectId: payload.psp_configuration_id,
            before,
            after,
            approverId: approvedBy,
          });
          return {
            result: {
              psp_configuration_id: payload.psp_configuration_id,
              status: after.status,
              version: after.version,
            },
            executedTxId: undefined,
          };
        } catch (error) {
          throw failure(error);
        }
      },
    };
  }

  private async state(client: TxClient, id: string) {
    const { rows } = await client.query<{ status: string; version: number }>(
      'SELECT status, version FROM psp_configuration WHERE psp_configuration_id = $1',
      [id],
    );
    return rows[0];
  }

  private async hasFeeRule(client: TxClient, payload: PspConfigurationPayload): Promise<boolean> {
    const { rows } = await client.query(
      `SELECT 1 FROM fee_rule WHERE scope_type = 'PSP_CONFIGURATION' AND scope_id = $1
          AND basis = 'TOPUP_AMOUNT' AND valid_from <= clock_timestamp()
          AND (valid_to IS NULL OR valid_to > clock_timestamp())`,
      [payload.psp_configuration_id],
    );
    return rows.length > 0;
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

function validatePayload(raw: unknown): PspConfigurationPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (!isUuid(p.psp_configuration_id) || !isUuid(p.scope_id) || p.scope_type !== 'OPERATOR')
    throw unprocessable('psp_configuration_id, scope_type (OPERATOR) et scope_id attendus.');
  if (typeof p.version !== 'number' || !Number.isInteger(p.version) || p.version < 1)
    throw unprocessable('version : entier positif attendu.');
  if (p.status !== 'ACTIVE' && p.status !== 'SUSPENDED')
    throw unprocessable('status : valeurs permises ACTIVE, SUSPENDED.');
  let complianceRef: string | undefined;
  if (p.compliance_ref !== undefined) {
    if (
      typeof p.compliance_ref !== 'string' ||
      p.compliance_ref.trim() === '' ||
      p.compliance_ref.length > 200
    )
      throw unprocessable('compliance_ref : texte de 1 à 200 caractères.');
    complianceRef = p.compliance_ref.trim();
  }
  if (p.status === 'ACTIVE' && complianceRef === undefined)
    throw unprocessable('compliance_ref : obligatoire pour ACTIVE.');
  return {
    psp_configuration_id: p.psp_configuration_id,
    version: p.version,
    status: p.status,
    ...(complianceRef !== undefined ? { compliance_ref: complianceRef } : {}),
    scope_type: 'OPERATOR',
    scope_id: p.scope_id,
  };
}
