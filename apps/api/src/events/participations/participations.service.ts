// Participations et points de vente (SPECIFICATION §3.1, §5.2, §12.1 ; FR-012, FR-013). Une participation porte les
// conditions d'un commerçant à un événement (type, droit de place) ; sa commission est une règle de frais de portée
// PARTICIPATION, jamais une donnée du commerçant. Création : la participation, son compte commerçant
// (`open_participation_account`) et l'audit dans la transaction de la requête (NFR-004). Le bénéficiaire des
// versements est posé par la base : l'organisateur si INTERNAL, le commerçant si EXTERNAL.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import { jsonValue } from '../../configuration/cascade.service';
import type { TxClient } from '../../db/tenant-tx';
import {
  amountField,
  conflict,
  enumField,
  invalid,
  isUuid,
  notFound,
  nullableText,
  objectBody,
  textField,
  unprocessable,
} from '../../organization/platform/platform.dto';

const LINK_TYPES = ['INTERNAL', 'EXTERNAL'] as const;
const PITCH_MODES = ['DEDUCT_OR_DEBT', 'PREPAID', 'DEDUCT_CAPPED'] as const;

export interface ParticipationTerms {
  pitch_fee_mode?: (typeof PITCH_MODES)[number];
  pitch_fee?: string;
  pitch_fee_reference?: string | null;
}
export type ParticipationInput = ParticipationTerms & { merchant_id: string; link_type: (typeof LINK_TYPES)[number] };

function parseTerms(body: Record<string, unknown>): ParticipationTerms {
  const terms: ParticipationTerms = {};
  const mode = enumField(body, 'pitch_fee_mode', PITCH_MODES, 'optional');
  if (mode !== undefined) terms.pitch_fee_mode = mode;
  const fee = amountField(body, 'pitch_fee', false);
  if (fee !== undefined && fee !== null) terms.pitch_fee = fee;
  const reference = nullableText(body, 'pitch_fee_reference', 200);
  if (reference !== undefined) terms.pitch_fee_reference = reference;
  return terms;
}

export function parseParticipationCreate(raw: unknown): ParticipationInput {
  const body = objectBody(raw);
  if (!isUuid(body.merchant_id)) throw invalid('merchant_id : identifiant attendu.');
  return { merchant_id: body.merchant_id, link_type: enumField(body, 'link_type', LINK_TYPES, 'required')!, ...parseTerms(body) };
}

export function parseParticipationUpdate(raw: unknown): ParticipationTerms {
  const terms = parseTerms(objectBody(raw));
  if (Object.keys(terms).length === 0) throw invalid('Au moins un champ à modifier : pitch_fee_mode, pitch_fee, pitch_fee_reference.');
  return terms;
}

export function parsePointOfSale(raw: unknown): string {
  return textField(objectBody(raw), 'name', 120, 'required')!;
}

export interface ParticipationRow {
  id: string;
  operator_id: string;
  event_id: string;
  merchant_id: string;
  link_type: string;
  payout_to: string;
  pitch_fee_mode: string;
  pitch_fee: bigint;
  pitch_fee_reference: string | null;
  account_id: string | null;
}

export const participationDto = (row: ParticipationRow) => ({
  participation_id: row.id,
  operator_id: row.operator_id,
  event_id: row.event_id,
  merchant_id: row.merchant_id,
  link_type: row.link_type,
  payout_to: row.payout_to,
  pitch_fee_mode: row.pitch_fee_mode,
  pitch_fee: jsonValue(row.pitch_fee),
  pitch_fee_reference: row.pitch_fee_reference,
  account_id: row.account_id,
});
export type ParticipationDto = ReturnType<typeof participationDto>;

export interface PointOfSaleRow {
  id: string;
  operator_id: string;
  participation_id: string;
  name: string;
}
export const pointOfSaleDto = (row: PointOfSaleRow) => ({ pos_id: row.id, operator_id: row.operator_id, participation_id: row.participation_id, name: row.name });

/** Événement d'une participation, pour les droits et les statuts. */
export interface EventRef {
  id: string;
  operator_id: string;
  organizer_id: string;
  status: string;
}

const SELECT = `SELECT mp.*, (SELECT a.id FROM account a WHERE a.participation_id = mp.id ORDER BY a.id LIMIT 1) AS account_id
                  FROM merchant_participation mp`;

/** Droit de place payé d'avance : la référence du paiement est obligatoire (§12.1). */
function assertPrepaid(mode: string, fee: bigint | string, reference: string | null): void {
  if (mode === 'PREPAID' && BigInt(fee) > 0n && !reference) {
    throw unprocessable('pitch_fee_reference : référence du paiement obligatoire pour un droit de place payé d\'avance (PREPAID).');
  }
}

@Injectable()
export class ParticipationsService {
  constructor(private readonly audit: AuditService) {}

  async event(client: TxClient, eventId: string): Promise<EventRef> {
    const { rows } = await client.query<EventRef>('SELECT id, operator_id, organizer_id, status FROM event WHERE id = $1', [eventId]);
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  /** `merchants` : restriction d'un MERCHANT_ADMIN à ses commerçants. */
  async list(client: TxClient, eventId: string, merchants: string[] | null, offset: number, limit: number): Promise<ParticipationRow[]> {
    const { rows } = await client.query<ParticipationRow>(
      `${SELECT} WHERE mp.event_id = $1 AND ($2::uuid[] IS NULL OR mp.merchant_id = ANY($2)) ORDER BY mp.id LIMIT $3 OFFSET $4`,
      [eventId, merchants, limit, offset],
    );
    return rows;
  }

  async row(client: TxClient, participationId: string): Promise<ParticipationRow> {
    const { rows } = await client.query<ParticipationRow>(`${SELECT} WHERE mp.id = $1`, [participationId]);
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  /** Contrôles d'une inscription, sans écrire : commerçant du prestataire, pas déjà inscrit, droit de place cohérent. */
  async checkCreate(client: TxClient, eventId: string, input: ParticipationInput): Promise<void> {
    const merchant = await client.query(`SELECT 1 FROM party WHERE id = $1 AND kind = 'MERCHANT'`, [input.merchant_id]);
    if (merchant.rowCount !== 1) throw unprocessable('merchant_id : commerçant de ce prestataire attendu.');
    const existing = await client.query('SELECT 1 FROM merchant_participation WHERE event_id = $1 AND merchant_id = $2', [eventId, input.merchant_id]);
    if (existing.rowCount !== 0) throw conflict('Ce commerçant est déjà inscrit à cet événement.');
    assertPrepaid(input.pitch_fee_mode ?? 'DEDUCT_OR_DEBT', input.pitch_fee ?? '0', input.pitch_fee_reference ?? null);
  }

  /** Inscrit le commerçant : participation, compte commerçant et audit, ensemble. */
  async create(client: TxClient, event: EventRef, input: ParticipationInput, actor: AuditContext, approverId?: string): Promise<ParticipationDto> {
    await this.checkCreate(client, event.id, input);
    let id: string;
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO merchant_participation (operator_id, event_id, merchant_id, link_type, pitch_fee_mode, pitch_fee, pitch_fee_reference)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [event.operator_id, event.id, input.merchant_id, input.link_type, input.pitch_fee_mode ?? 'DEDUCT_OR_DEBT', input.pitch_fee ?? '0', input.pitch_fee_reference ?? null],
      );
      id = rows[0]!.id;
    } catch (error) {
      // Deux inscriptions simultanées du même commerçant : unicité (événement, commerçant).
      if ((error as { code?: string }).code === '23505') throw conflict('Ce commerçant est déjà inscrit à cet événement.');
      throw error;
    }
    await client.query('SELECT open_participation_account($1)', [id]);
    const created = participationDto(await this.row(client, id));
    await this.audit.record(client, {
      ...actor,
      operatorId: event.operator_id,
      action: 'PARTICIPATION_CREATED',
      objectType: 'merchant_participation',
      objectId: id,
      after: created,
      approverId: approverId ?? null,
    });
    return created;
  }

  /** Conditions après modification, contrôlées sans écrire. */
  merged(row: ParticipationRow, terms: ParticipationTerms): { mode: string; fee: string; reference: string | null } {
    const merged = {
      mode: terms.pitch_fee_mode ?? row.pitch_fee_mode,
      fee: terms.pitch_fee ?? row.pitch_fee.toString(),
      reference: terms.pitch_fee_reference !== undefined ? terms.pitch_fee_reference : row.pitch_fee_reference,
    };
    assertPrepaid(merged.mode, merged.fee, merged.reference);
    return merged;
  }

  async update(client: TxClient, row: ParticipationRow, terms: ParticipationTerms, actor: AuditContext, approverId?: string): Promise<ParticipationDto> {
    const next = this.merged(row, terms);
    await client.query('UPDATE merchant_participation SET pitch_fee_mode = $2, pitch_fee = $3, pitch_fee_reference = $4 WHERE id = $1', [
      row.id,
      next.mode,
      next.fee,
      next.reference,
    ]);
    const after = participationDto(await this.row(client, row.id));
    await this.audit.record(client, {
      ...actor,
      operatorId: row.operator_id,
      action: 'PARTICIPATION_UPDATED',
      objectType: 'merchant_participation',
      objectId: row.id,
      before: participationDto(row),
      after,
      approverId: approverId ?? null,
    });
    return after;
  }

  // ------------------------------------------------------------------ Points de vente

  async listPointsOfSale(client: TxClient, participationId: string, offset: number, limit: number): Promise<PointOfSaleRow[]> {
    const { rows } = await client.query<PointOfSaleRow>(
      'SELECT id, operator_id, participation_id, name FROM point_of_sale WHERE participation_id = $1 ORDER BY name, id LIMIT $2 OFFSET $3',
      [participationId, limit, offset],
    );
    return rows;
  }

  async pointOfSale(client: TxClient, posId: string): Promise<PointOfSaleRow> {
    const { rows } = await client.query<PointOfSaleRow>('SELECT id, operator_id, participation_id, name FROM point_of_sale WHERE id = $1', [posId]);
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  async createPointOfSale(client: TxClient, participation: ParticipationRow, name: string, actor: AuditContext) {
    const { rows } = await client.query<PointOfSaleRow>(
      'INSERT INTO point_of_sale (operator_id, participation_id, name) VALUES ($1, $2, $3) RETURNING id, operator_id, participation_id, name',
      [participation.operator_id, participation.id, name],
    );
    const created = pointOfSaleDto(rows[0]!);
    await this.audit.record(client, { ...actor, operatorId: participation.operator_id, action: 'POINT_OF_SALE_CREATED', objectType: 'point_of_sale', objectId: created.pos_id, after: created });
    return created;
  }

  async renamePointOfSale(client: TxClient, pos: PointOfSaleRow, name: string, actor: AuditContext) {
    const { rows } = await client.query<PointOfSaleRow>('UPDATE point_of_sale SET name = $2 WHERE id = $1 RETURNING id, operator_id, participation_id, name', [pos.id, name]);
    const after = pointOfSaleDto(rows[0]!);
    await this.audit.record(client, { ...actor, operatorId: pos.operator_id, action: 'POINT_OF_SALE_RENAMED', objectType: 'point_of_sale', objectId: pos.id, before: pointOfSaleDto(pos), after });
    return after;
  }
}
