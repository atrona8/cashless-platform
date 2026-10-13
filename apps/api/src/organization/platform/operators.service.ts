// Prestataires, contrats plateforme–prestataire et redevances de plateforme (SPECIFICATION §3.1, §4.3, §5.6 ;
// FR-004, FR-007, FR-008). Écritures par le rôle de la plateforme seulement ; chaque écriture a sa ligne d'audit
// dans la chaîne de la plateforme (operator_id NULL), dans la même transaction.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import {
  conflict,
  contractDto,
  feeRuleDto,
  notFound,
  operatorDto,
  unprocessable,
  type ContractDto,
  type ContractRow,
  type FeeRuleDto,
  type FeeRuleInput,
  type FeeRuleRow,
  type OperatorDto,
  type PartyFields,
  type PartyRow,
  type PlatformContractInput,
} from './platform.dto';

const PARTY = 'id, operator_id, legal_name, country_code, tax_id, created_at';

@Injectable()
export class OperatorsService {
  constructor(private readonly audit: AuditService) {}

  // ------------------------------------------------------------------ Prestataires

  async list(client: TxClient, offset: number, limit: number): Promise<PartyRow[]> {
    const { rows } = await client.query<PartyRow>(
      `SELECT ${PARTY} FROM party WHERE kind = 'OPERATOR' ORDER BY created_at, id LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  async get(client: TxClient, operatorId: string): Promise<OperatorDto> {
    const { rows } = await client.query<PartyRow>(`SELECT ${PARTY} FROM party WHERE id = $1 AND kind = 'OPERATOR'`, [operatorId]);
    if (!rows[0]) throw notFound();
    return operatorDto(rows[0]);
  }

  async create(client: TxClient, input: { legal_name: string; country_code: string; tax_id: string | null }, actor: AuditContext): Promise<OperatorDto> {
    const { rows } = await client.query<PartyRow>(
      `INSERT INTO party (kind, legal_name, country_code, tax_id) VALUES ('OPERATOR', $1, $2, $3) RETURNING ${PARTY}`,
      [input.legal_name, input.country_code, input.tax_id],
    );
    const created = operatorDto(rows[0]!);
    await this.audit.record(client, { ...actor, operatorId: null, action: 'OPERATOR_CREATED', objectType: 'party', objectId: created.operator_id, after: created });
    return created;
  }

  async update(client: TxClient, operatorId: string, fields: PartyFields, actor: AuditContext): Promise<OperatorDto> {
    const before = await this.get(client, operatorId);
    const { rows } = await client.query<PartyRow>(
      `UPDATE party SET legal_name = $2, country_code = $3, tax_id = $4 WHERE id = $1 AND kind = 'OPERATOR' RETURNING ${PARTY}`,
      [
        operatorId,
        fields.legal_name ?? before.legal_name,
        fields.country_code !== undefined ? fields.country_code : before.country_code,
        fields.tax_id !== undefined ? fields.tax_id : before.tax_id,
      ],
    );
    const after = operatorDto(rows[0]!);
    await this.audit.record(client, { ...actor, operatorId: null, action: 'OPERATOR_UPDATED', objectType: 'party', objectId: operatorId, before, after });
    return after;
  }

  // ------------------------------------------------------------------ Contrats plateforme–prestataire

  async listContracts(client: TxClient, operatorId: string, offset: number, limit: number): Promise<ContractRow[]> {
    await this.get(client, operatorId);
    const { rows } = await client.query<ContractRow>(
      `SELECT * FROM contract WHERE operator_id = $1 AND kind = 'PLATFORM_OPERATOR' ORDER BY version DESC LIMIT $2 OFFSET $3`,
      [operatorId, limit, offset],
    );
    return rows;
  }

  /** Dernière version du contrat plateforme du prestataire, ou `null`. */
  async latestContract(client: TxClient, operatorId: string): Promise<ContractRow | null> {
    const { rows } = await client.query<ContractRow>(
      `SELECT * FROM contract WHERE operator_id = $1 AND kind = 'PLATFORM_OPERATOR' ORDER BY version DESC LIMIT 1`,
      [operatorId],
    );
    return rows[0] ?? null;
  }

  async createContract(client: TxClient, operatorId: string, input: PlatformContractInput, actor: AuditContext): Promise<ContractDto> {
    await this.get(client, operatorId);
    if (await this.latestContract(client, operatorId)) {
      throw conflict('Ce prestataire a déjà un contrat avec la plateforme : publier une nouvelle version.');
    }
    return this.insertContract(client, operatorId, input, null, actor);
  }

  /** `contractId` doit être la dernière version du contrat plateforme du prestataire (sinon 409). */
  async assertLatestContract(client: TxClient, operatorId: string, contractId: string): Promise<ContractRow> {
    await this.get(client, operatorId);
    const { rows } = await client.query<ContractRow>(
      `SELECT * FROM contract WHERE id = $1 AND operator_id = $2 AND kind = 'PLATFORM_OPERATOR'`,
      [contractId, operatorId],
    );
    if (!rows[0]) throw notFound();
    const latest = await this.latestContract(client, operatorId);
    if (latest?.id !== contractId) throw conflict('Ce contrat n\'est plus la dernière version : repartir de la version courante.');
    return rows[0];
  }

  /** Version suivante (numéro posé par la base) ; un champ omis reprend la version précédente. */
  async createContractVersion(
    client: TxClient,
    operatorId: string,
    contractId: string,
    changes: { valid_from: string; platform_fee_mode?: string },
    actor: AuditContext,
    approverId?: string,
  ): Promise<ContractDto> {
    const previous = await this.assertLatestContract(client, operatorId, contractId);
    if (new Date(changes.valid_from) < previous.valid_from) {
      throw unprocessable('La date d\'effet ne peut pas précéder celle de la version en vigueur.');
    }
    return this.insertContract(
      client,
      operatorId,
      { valid_from: changes.valid_from, platform_fee_mode: (changes.platform_fee_mode ?? previous.platform_fee_mode) as PlatformContractInput['platform_fee_mode'] },
      previous,
      actor,
      approverId,
    );
  }

  private async insertContract(
    client: TxClient,
    operatorId: string,
    input: PlatformContractInput,
    previous: ContractRow | null,
    actor: AuditContext,
    approverId?: string,
  ): Promise<ContractDto> {
    const platform = await platformParty(client);
    const { rows } = await client.query<ContractRow>(
      `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, platform_fee_mode)
       VALUES ($1, 'PLATFORM_OPERATOR', $2, $3, $4) RETURNING *`,
      [operatorId, previous?.counterparty_id ?? platform, input.valid_from, input.platform_fee_mode],
    );
    const created = contractDto(rows[0]!);
    await this.audit.record(client, {
      ...actor,
      operatorId: null,
      action: 'CONTRACT_CREATED',
      objectType: 'contract',
      objectId: created.contract_id,
      before: previous ? contractDto(previous) : null,
      after: created,
      approverId: approverId ?? null,
    });
    return created;
  }

  // ------------------------------------------------------------------ Redevances de plateforme

  async listFeeRules(client: TxClient, operatorId: string, offset: number, limit: number): Promise<FeeRuleRow[]> {
    await this.get(client, operatorId);
    const { rows } = await client.query<FeeRuleRow>(
      `SELECT * FROM fee_rule WHERE operator_id = $1 AND scope_type = 'PLATFORM_CONTRACT'
        ORDER BY valid_from DESC, id LIMIT $2 OFFSET $3`,
      [operatorId, limit, offset],
    );
    return rows;
  }

  /** Redevance de la plateforme (§5.3 `PLATFORM_FEE`) : débit `OPE_REDEV`, crédit `PLT_REDEV`, sur un contrat du prestataire. */
  async createFeeRule(client: TxClient, operatorId: string, input: FeeRuleInput, actor: AuditContext): Promise<FeeRuleDto> {
    const operator = await this.get(client, operatorId);
    if (input.scope_type !== 'PLATFORM_CONTRACT') throw unprocessable('scope_type : PLATFORM_CONTRACT attendu pour une redevance de plateforme.');
    if (input.payer_purpose !== 'OPE_REDEV' || input.beneficiary_purpose !== 'PLT_REDEV') {
      throw unprocessable('Une redevance de plateforme débite OPE_REDEV et crédite PLT_REDEV.');
    }
    const contract = await client.query(`SELECT 1 FROM contract WHERE id = $1 AND operator_id = $2 AND kind = 'PLATFORM_OPERATOR'`, [
      input.scope_id,
      operatorId,
    ]);
    if (contract.rowCount !== 1) throw unprocessable('scope_id : contrat plateforme–prestataire de ce prestataire attendu.');
    if (input.tax_code !== null) await assertTaxCode(client, operator.country_code, input.tax_code);

    const identity = [input.scope_type, input.scope_id, input.payer_purpose, input.beneficiary_purpose, input.basis];
    const open = await client.query(
      `SELECT 1 FROM fee_rule WHERE scope_type = $1 AND scope_id = $2 AND payer_purpose = $3 AND beneficiary_purpose = $4
          AND basis = $5 AND valid_to IS NULL`,
      identity,
    );
    if (open.rowCount !== 0) throw conflict('Une règle en vigueur existe déjà pour cette portée, ce payeur, ce bénéficiaire et cette assiette : la remplacer.');
    const { rows } = await client.query<FeeRuleRow>(
      `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps, fixed_amount,
                             min_amount, max_amount, tax_code, tax_inclusive, trigger, valid_from, version)
       VALUES ($6, $1, $2, $3, $4, $5, $7, $8, $9, $10, $11, $12, $13, coalesce($14::timestamptz, clock_timestamp()),
               1 + (SELECT coalesce(max(version), 0) FROM fee_rule WHERE scope_type = $1 AND scope_id = $2 AND payer_purpose = $3
                                                                      AND beneficiary_purpose = $4 AND basis = $5))
       RETURNING *`,
      [
        ...identity, operatorId, input.rate_bps, input.fixed_amount, input.min_amount, input.max_amount, input.tax_code,
        input.tax_inclusive, input.trigger, input.valid_from,
      ],
    );
    const created = feeRuleDto(rows[0]!);
    await this.audit.record(client, { ...actor, operatorId: null, action: 'FEE_RULE_CREATED', objectType: 'fee_rule', objectId: created.fee_rule_id, after: created });
    return created;
  }
}

/** Partie plateforme (la plus ancienne si une base d'essai en contient plusieurs, comme open_event_ledger). */
export async function platformParty(client: TxClient): Promise<string> {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM party WHERE kind = 'PLATFORM' ORDER BY created_at, id LIMIT 1`);
  if (!rows[0]) throw conflict('Partie plateforme absente : amorcer la plateforme avant toute configuration.');
  return rows[0].id;
}

/** `tax_code` doit être une taxe (`rules.taxes`) du dernier profil de législation du pays. */
export async function assertTaxCode(client: TxClient, countryCode: string | null, taxCode: string): Promise<void> {
  const { rows } = await client.query<{ known: boolean }>(
    `SELECT coalesce(rules->'taxes', '{}'::jsonb) ? $2 AS known FROM jurisdiction_profile
      WHERE country_code = $1 ORDER BY version DESC LIMIT 1`,
    [countryCode, taxCode],
  );
  if (!rows[0]?.known) throw unprocessable(`tax_code : ${taxCode} n'est pas une taxe du profil de législation (${countryCode ?? 'pays inconnu'}).`);
}
