// Contrats prestataire–organisateur (SPECIFICATION §4.3 ; FR-007, FR-019). Un contrat ne se modifie jamais : la
// version 1 se crée directement, toute version suivante passe par l'action à deux `CONTRACT_VERSION`. Le numéro de
// version est posé par la base (migration 0007). Les événements gardent la version à laquelle ils sont rattachés.
import { Injectable } from '@nestjs/common';
import {
  ApprovalActionRegistry,
  type ApprovalActionDefinition,
} from '../../approval/action-registry';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import {
  conflict,
  contractDto,
  dateTimeField,
  enumField,
  intField,
  isUuid,
  notFound,
  objectBody,
  unprocessable,
  type ContractDto,
  type ContractRow,
} from '../platform/platform.dto';

const BEARERS = ['ORGANIZER', 'OPERATOR'] as const;
const FEE_BASES = ['GROSS', 'NET_OF_REFUNDS'] as const;

export interface OrganizerContractTerms {
  offline_loss_bearer: (typeof BEARERS)[number];
  cash_diff_bearer: (typeof BEARERS)[number];
  breakage_organizer_bps: number;
  operator_fee_basis: (typeof FEE_BASES)[number];
  chargeback_bearer: (typeof BEARERS)[number];
}
export type OrganizerContractInput = OrganizerContractTerms & { valid_from: string };
export type OrganizerContractChanges = Partial<OrganizerContractTerms> & { valid_from: string };

/** Lit les champs présents ; une valeur mal formée est refusée (400). */
function terms(body: Record<string, unknown>): Partial<OrganizerContractTerms> {
  const parsed: Partial<OrganizerContractTerms> = {};
  const set = <K extends keyof OrganizerContractTerms>(
    key: K,
    value: OrganizerContractTerms[K] | undefined,
  ) => {
    if (value !== undefined) parsed[key] = value;
  };
  set('offline_loss_bearer', enumField(body, 'offline_loss_bearer', BEARERS, 'optional'));
  set('cash_diff_bearer', enumField(body, 'cash_diff_bearer', BEARERS, 'optional'));
  set('breakage_organizer_bps', intField(body, 'breakage_organizer_bps', 0, 10000, 'optional'));
  set('operator_fee_basis', enumField(body, 'operator_fee_basis', FEE_BASES, 'optional'));
  set('chargeback_bearer', enumField(body, 'chargeback_bearer', BEARERS, 'optional'));
  return parsed;
}

/** Version 1 : les champs obligatoires de §4.3 doivent tous être là ; un manque est un 422 qui le nomme. */
export function parseOrganizerContractCreate(raw: unknown): OrganizerContractInput {
  const body = objectBody(raw);
  const parsed = terms(body);
  const missing = (
    ['valid_from', 'offline_loss_bearer', 'cash_diff_bearer', 'breakage_organizer_bps'] as const
  ).filter((field) => body[field] === undefined);
  if (missing.length > 0)
    throw unprocessable(`Champ obligatoire du contrat (§4.3) manquant : ${missing.join(', ')}.`);
  return {
    valid_from: dateTimeField(body, 'valid_from', 'required')!.toISOString(),
    offline_loss_bearer: parsed.offline_loss_bearer!,
    cash_diff_bearer: parsed.cash_diff_bearer!,
    breakage_organizer_bps: parsed.breakage_organizer_bps!,
    operator_fee_basis: parsed.operator_fee_basis ?? 'GROSS',
    chargeback_bearer: parsed.chargeback_bearer ?? 'ORGANIZER',
  };
}

export function parseOrganizerContractVersion(raw: unknown): OrganizerContractChanges {
  const body = objectBody(raw);
  if (body.platform_fee_mode !== undefined)
    throw unprocessable('platform_fee_mode : champ du contrat de plateforme, refusé ici.');
  return {
    ...terms(body),
    valid_from: dateTimeField(body, 'valid_from', 'required')!.toISOString(),
  };
}

export interface ContractVersionPayload {
  /** Prestataire du contrat (celui du chemin de la demande) : portée de l'action. */
  operator_id: string;
  /** Version de référence : la dernière au moment de la demande. */
  contract_id: string;
  changes: OrganizerContractChanges;
}

@Injectable()
export class ContractsService {
  constructor(
    private readonly audit: AuditService,
    registry: ApprovalActionRegistry,
  ) {
    registry.register(this.versionAction() as ApprovalActionDefinition);
  }

  async list(
    client: TxClient,
    organizerId: string,
    offset: number,
    limit: number,
  ): Promise<ContractRow[]> {
    const { rows } = await client.query<ContractRow>(
      `SELECT * FROM contract WHERE kind = 'OPERATOR_ORGANIZER' AND counterparty_id = $1 ORDER BY version DESC LIMIT $2 OFFSET $3`,
      [organizerId, limit, offset],
    );
    return rows;
  }

  async create(
    client: TxClient,
    operatorId: string,
    organizerId: string,
    input: OrganizerContractInput,
    actor: AuditContext,
  ): Promise<ContractDto> {
    const existing = await this.list(client, organizerId, 0, 1);
    if (existing.length > 0)
      throw conflict('Cet organisateur a déjà un contrat : publier une nouvelle version.');
    return this.insert(client, operatorId, organizerId, input, null, actor);
  }

  /** `contractId` doit être la dernière version du contrat de son organisateur (sinon 409). */
  async assertLatest(client: TxClient, contractId: string): Promise<ContractRow> {
    const { rows } = await client.query<ContractRow>(
      `SELECT * FROM contract WHERE id = $1 AND kind = 'OPERATOR_ORGANIZER'`,
      [contractId],
    );
    const contract = rows[0];
    if (!contract) throw notFound();
    const [latest] = await this.list(client, contract.counterparty_id, 0, 1);
    if (latest?.id !== contractId)
      throw conflict(
        "Ce contrat n'est plus la dernière version : repartir de la version courante.",
      );
    return contract;
  }

  /** Version suivante ; un champ omis reprend la version précédente. */
  async createVersion(
    client: TxClient,
    contractId: string,
    changes: OrganizerContractChanges,
    actor: AuditContext,
    approverId?: string,
  ): Promise<ContractDto> {
    const previous = await this.assertLatest(client, contractId);
    if (new Date(changes.valid_from) < previous.valid_from)
      throw unprocessable("La date d'effet ne peut pas précéder celle de la version en vigueur.");
    const input: OrganizerContractInput = {
      valid_from: changes.valid_from,
      offline_loss_bearer:
        changes.offline_loss_bearer ??
        (previous.offline_loss_bearer as OrganizerContractTerms['offline_loss_bearer']),
      cash_diff_bearer:
        changes.cash_diff_bearer ??
        (previous.cash_diff_bearer as OrganizerContractTerms['cash_diff_bearer']),
      breakage_organizer_bps: changes.breakage_organizer_bps ?? previous.breakage_organizer_bps!,
      operator_fee_basis:
        changes.operator_fee_basis ??
        (previous.operator_fee_basis as OrganizerContractTerms['operator_fee_basis']),
      chargeback_bearer:
        changes.chargeback_bearer ??
        (previous.chargeback_bearer as OrganizerContractTerms['chargeback_bearer']),
    };
    return this.insert(
      client,
      previous.operator_id,
      previous.counterparty_id,
      input,
      previous,
      actor,
      approverId,
    );
  }

  private async insert(
    client: TxClient,
    operatorId: string,
    organizerId: string,
    input: OrganizerContractInput,
    previous: ContractRow | null,
    actor: AuditContext,
    approverId?: string,
  ): Promise<ContractDto> {
    const { rows } = await client.query<ContractRow>(
      `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer,
                             breakage_organizer_bps, operator_fee_basis, chargeback_bearer)
       VALUES ($1, 'OPERATOR_ORGANIZER', $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        operatorId,
        organizerId,
        input.valid_from,
        input.offline_loss_bearer,
        input.cash_diff_bearer,
        input.breakage_organizer_bps,
        input.operator_fee_basis,
        input.chargeback_bearer,
      ],
    );
    const created = contractDto(rows[0]!);
    await this.audit.record(client, {
      ...actor,
      operatorId,
      action: 'CONTRACT_CREATED',
      objectType: 'contract',
      objectId: created.contract_id,
      before: previous ? contractDto(previous) : null,
      after: created,
      approverId: approverId ?? null,
    });
    return created;
  }

  /** Action à deux `CONTRACT_VERSION` (R-09) : OPERATOR_ADMIN, portée du prestataire du contrat. */
  private versionAction(): ApprovalActionDefinition<ContractVersionPayload> {
    return {
      action: 'CONTRACT_VERSION',
      requiredRole: 'OPERATOR_ADMIN',
      scopeOf: (payload) => ({ type: 'OPERATOR', id: payload.operator_id }),
      validate: (raw) => {
        const payload = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
          string,
          unknown
        >;
        if (!isUuid(payload.operator_id) || !isUuid(payload.contract_id)) {
          throw new ProblemException('VALIDATION_FAILED', {
            status: 422,
            detail: 'operator_id et contract_id attendus.',
          });
        }
        return {
          operator_id: payload.operator_id,
          contract_id: payload.contract_id,
          changes: parseOrganizerContractVersion(payload.changes),
        };
      },
      execute: async (client, { payload, requestedBy, approvedBy }) => ({
        result: await this.createVersion(
          client,
          payload.contract_id,
          payload.changes,
          { actorId: requestedBy, actorRole: 'OPERATOR_ADMIN', origin: null, requestId: null },
          approvedBy,
        ),
      }),
    };
  }
}
