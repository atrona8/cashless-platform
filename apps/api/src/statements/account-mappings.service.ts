// Correspondance comptable versionnée (route 18, FR-023, C-007). Lecture par `SELECT` ; une version s'écrit par la
// seule fonction `create_account_mapping_version` (WP05) : aucun `INSERT`, `UPDATE` ni `DELETE` d'ici. Aucun jeu de
// comptes n'est livré (OP-N3) : la table est vide tant que le prestataire n'a rien publié.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import {
  invalid,
  isUuid,
  objectBody,
  pageOf,
  type PageRequest,
} from '../organization/platform/platform.dto';

/** Types de transaction du grand livre (liste fermée de `journal_transaction.type`). */
export const TRANSACTION_TYPES: readonly string[] = [
  'TOPUP',
  'TOPUP_CASH',
  'PROMO_CREDIT',
  'PROMO_EXPIRY',
  'ACTIVATION_FEE',
  'DEPOSIT_TAKEN',
  'DEPOSIT_REFUNDED',
  'DEPOSIT_FORFEITED',
  'PURCHASE',
  'REVERSAL',
  'PITCH_FEE',
  'OPERATOR_FEE',
  'PLATFORM_FEE',
  'ANOMALY_RESOLUTION',
  'CASH_CLOSE',
  'CASH_DEPOSIT',
  'PSP_SETTLEMENT',
  'CHARGEBACK',
  'WALLET_REFUND',
  'BREAKAGE',
  'PAYOUT_INITIATED',
  'PAYOUT_CONFIRMED',
  'PAYOUT_FAILED',
  'ADJUSTMENT',
  'MERCHANT_DEBT_TRANSFER',
  'BREAKAGE_REVERSAL',
];

export interface AccountMappingLine {
  purpose: string;
  transaction_type: string | null;
  debit_account: string;
  credit_account: string;
}

export interface AccountMappingVersionDto {
  entity_party_id: string;
  version: number;
  valid_from: string;
  created_by: string;
  mappings: AccountMappingLine[];
}

export interface AccountMappingVersionInput {
  entity_party_id: string;
  valid_from: string;
  mappings: AccountMappingLine[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PURPOSE = /^[A-Z][A-Z0-9_]{0,63}$/;
const LEGAL_ACCOUNT_MAX = 32;
const MAX_LINES = 500;

export function parseDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE.test(value))
    throw invalid(`${field} : date AAAA-MM-JJ attendue.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw invalid(`${field} : date invalide.`);
  return value;
}

function legalAccount(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > LEGAL_ACCOUNT_MAX)
    throw invalid(`${field} : texte de 1 à ${LEGAL_ACCOUNT_MAX} caractères attendu.`);
  return value.trim();
}

/** Corps strict : un champ inconnu est refusé ; `version` et `created_by` (lecture seule) sont ignorés. */
export function parseMappingVersion(raw: unknown): AccountMappingVersionInput {
  const body = objectBody(raw);
  const known = new Set(['entity_party_id', 'valid_from', 'mappings', 'version', 'created_by']);
  for (const key of Object.keys(body))
    if (!known.has(key)) throw invalid(`${key} : champ inconnu.`);
  if (!isUuid(body.entity_party_id)) throw invalid('entity_party_id : identifiant attendu.');
  const validFrom = parseDate(body.valid_from, 'valid_from');
  const list = body.mappings;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_LINES)
    throw invalid(`mappings : de 1 à ${MAX_LINES} lignes attendues.`);
  const seen = new Set<string>();
  const mappings = list.map((item, index): AccountMappingLine => {
    const line = objectBody(item);
    for (const key of Object.keys(line))
      if (!['purpose', 'transaction_type', 'debit_account', 'credit_account'].includes(key))
        throw invalid(`mappings[${index}].${key} : champ inconnu.`);
    if (typeof line.purpose !== 'string' || !PURPOSE.test(line.purpose))
      throw invalid(`mappings[${index}].purpose : finalité attendue (majuscules et _).`);
    const type = line.transaction_type ?? null;
    if (type !== null && (typeof type !== 'string' || !TRANSACTION_TYPES.includes(type)))
      throw invalid(`mappings[${index}].transaction_type : type de transaction inconnu.`);
    const key = `${line.purpose}|${type ?? '*'}`;
    if (seen.has(key)) throw invalid(`mappings[${index}] : couple (purpose, type) en double.`);
    seen.add(key);
    return {
      purpose: line.purpose,
      transaction_type: type,
      debit_account: legalAccount(line.debit_account, `mappings[${index}].debit_account`),
      credit_account: legalAccount(line.credit_account, `mappings[${index}].credit_account`),
    };
  });
  return { entity_party_id: body.entity_party_id, valid_from: validFrom, mappings };
}

interface VersionRow {
  entity_party_id: string;
  version: number;
  valid_from: string;
  created_by: string;
  mappings: AccountMappingLine[];
}

@Injectable()
export class AccountMappingsService {
  constructor(private readonly audit: AuditService) {}

  /** Versions, plus récentes d'abord par entité. `scope` : entités visibles (`null` : toutes celles du prestataire). */
  async list(
    client: TxClient,
    operatorId: string,
    filter: { entity: string | null; scope: string[] | null },
    page: PageRequest,
  ) {
    const { rows } = await client.query<VersionRow>(
      `SELECT m.entity_party_id, m.version,
              to_char(m.valid_from AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS valid_from, m.created_by,
              jsonb_agg(jsonb_build_object('purpose', m.purpose, 'transaction_type', m.transaction_type,
                                           'debit_account', m.debit_account,
                                           'credit_account', m.credit_account)
                        ORDER BY m.purpose, m.transaction_type NULLS FIRST) AS mappings
         FROM account_mapping m
        WHERE m.operator_id = $1 AND ($2::uuid IS NULL OR m.entity_party_id = $2)
          AND ($3::uuid[] IS NULL OR m.entity_party_id = ANY($3))
        GROUP BY m.entity_party_id, m.version, m.valid_from, m.created_by
        ORDER BY m.entity_party_id, m.version DESC
        OFFSET $4 LIMIT $5`,
      [operatorId, filter.entity, filter.scope, page.offset, page.limit + 1],
    );
    return pageOf(rows, page, (row): AccountMappingVersionDto => row);
  }

  private async version(
    client: TxClient,
    operatorId: string,
    entity: string,
    version: number,
  ): Promise<AccountMappingVersionDto> {
    const { rows } = await client.query<VersionRow>(
      `SELECT m.entity_party_id, m.version,
              to_char(m.valid_from AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS valid_from, m.created_by,
              jsonb_agg(jsonb_build_object('purpose', m.purpose, 'transaction_type', m.transaction_type,
                                           'debit_account', m.debit_account,
                                           'credit_account', m.credit_account)
                        ORDER BY m.purpose, m.transaction_type NULLS FIRST) AS mappings
         FROM account_mapping m
        WHERE m.operator_id = $1 AND m.entity_party_id = $2 AND m.version = $3
        GROUP BY m.entity_party_id, m.version, m.valid_from, m.created_by`,
      [operatorId, entity, version],
    );
    return rows[0]!;
  }

  /** Nouvelle version complète pour une entité du prestataire (organisateur ou prestataire) ; autre : `404`. */
  async create(
    client: TxClient,
    actor: { operatorId: string; userId: string; audit: AuditContext },
    input: AccountMappingVersionInput,
  ): Promise<AccountMappingVersionDto> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM party WHERE id = $1 AND kind IN ('ORGANIZER', 'OPERATOR')
          AND (id = $2 OR operator_id = $2)`,
      [input.entity_party_id, actor.operatorId],
    );
    if (rowCount !== 1) throw new ProblemException('NOT_FOUND');
    const { rows } = await client.query<{ version: number }>(
      `SELECT create_account_mapping_version($1, $2, $3::timestamptz, $4::jsonb, $5) AS version`,
      [
        actor.operatorId,
        input.entity_party_id,
        `${input.valid_from}T00:00:00Z`,
        JSON.stringify(input.mappings),
        actor.userId,
      ],
    );
    const version = rows[0]!.version;
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'ACCOUNT_MAPPING_VERSION_CREATED',
      objectType: 'party',
      objectId: input.entity_party_id,
      after: { version, valid_from: input.valid_from, lines: input.mappings.length },
    });
    return this.version(client, actor.operatorId, input.entity_party_id, version);
  }
}
