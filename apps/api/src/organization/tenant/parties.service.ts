// Organisateurs et commerçants d'un prestataire (SPECIFICATION §3.1 ; FR-005, FR-006) : parties rattachées au
// prestataire de la transaction, jamais à un prestataire reçu dans un corps. Un commerçant ne porte aucune condition
// commerciale : elles sont sur ses participations. Chaque écriture a sa ligne d'audit dans la même transaction.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditAction, type AuditContext } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { notFound, type PartyFields, type PartyRow } from '../platform/platform.dto';

export type TenantPartyKind = 'ORGANIZER' | 'MERCHANT';

const COLUMNS = 'id, operator_id, legal_name, country_code, tax_id, created_at';
const AUDIT: Record<TenantPartyKind, { created: AuditAction; updated: AuditAction }> = {
  ORGANIZER: { created: 'ORGANIZER_CREATED', updated: 'ORGANIZER_UPDATED' },
  MERCHANT: { created: 'MERCHANT_CREATED', updated: 'MERCHANT_UPDATED' },
};

const base = (row: PartyRow) => ({
  operator_id: row.operator_id!,
  legal_name: row.legal_name,
  country_code: row.country_code,
  tax_id: row.tax_id,
  created_at: row.created_at.toISOString(),
});
export const organizerDto = (row: PartyRow) => ({ organizer_id: row.id, ...base(row) });
export const merchantDto = (row: PartyRow) => ({ merchant_id: row.id, ...base(row) });
const dto = (kind: TenantPartyKind, row: PartyRow) => (kind === 'ORGANIZER' ? organizerDto(row) : merchantDto(row));

@Injectable()
export class PartiesService {
  constructor(private readonly audit: AuditService) {}

  /** `only` : restriction aux identifiants donnés (visibilité d'un ORGANIZER_ADMIN ou d'un MERCHANT_ADMIN). */
  async list(client: TxClient, kind: TenantPartyKind, only: string[] | null, offset: number, limit: number): Promise<PartyRow[]> {
    const { rows } = await client.query<PartyRow>(
      `SELECT ${COLUMNS} FROM party WHERE kind = $1 AND operator_id = current_setting('app.operator_id')::uuid
          AND ($2::uuid[] IS NULL OR id = ANY($2)) ORDER BY created_at, id LIMIT $3 OFFSET $4`,
      [kind, only, limit, offset],
    );
    return rows;
  }

  async row(client: TxClient, kind: TenantPartyKind, id: string): Promise<PartyRow> {
    const { rows } = await client.query<PartyRow>(
      `SELECT ${COLUMNS} FROM party WHERE id = $1 AND kind = $2 AND operator_id = current_setting('app.operator_id')::uuid`,
      [id, kind],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  async create(client: TxClient, kind: TenantPartyKind, operatorId: string, fields: PartyFields & { legal_name: string }, actor: AuditContext) {
    const { rows } = await client.query<PartyRow>(
      `INSERT INTO party (kind, operator_id, legal_name, country_code, tax_id) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [kind, operatorId, fields.legal_name, fields.country_code ?? null, fields.tax_id ?? null],
    );
    const created = dto(kind, rows[0]!);
    await this.audit.record(client, { ...actor, operatorId, action: AUDIT[kind].created, objectType: 'party', objectId: rows[0]!.id, after: created });
    return created;
  }

  async update(client: TxClient, kind: TenantPartyKind, operatorId: string, id: string, fields: PartyFields, actor: AuditContext) {
    const previous = await this.row(client, kind, id);
    const { rows } = await client.query<PartyRow>(
      `UPDATE party SET legal_name = $2, country_code = $3, tax_id = $4 WHERE id = $1 RETURNING ${COLUMNS}`,
      [
        id,
        fields.legal_name ?? previous.legal_name,
        fields.country_code !== undefined ? fields.country_code : previous.country_code,
        fields.tax_id !== undefined ? fields.tax_id : previous.tax_id,
      ],
    );
    const after = dto(kind, rows[0]!);
    await this.audit.record(client, { ...actor, operatorId, action: AUDIT[kind].updated, objectType: 'party', objectId: id, before: dto(kind, previous), after });
    return after;
  }
}
