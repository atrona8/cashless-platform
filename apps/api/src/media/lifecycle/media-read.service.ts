// Consultation d'un bracelet (FR-024 ; contrat `getMedia`, `listMedia`, `getMediaAdmin`) : `media_summary` et
// `media_status_log`. Jamais l'identité de la puce, son empreinte, le mot de passe ni l'empreinte du code imprimé.
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../../db/tenant-tx';
import { notFound } from '../../organization/platform/platform.dto';

interface SummaryRow {
  media_id: string;
  status: string;
  kind: string;
  key_index: number;
  personalized_at: Date | null;
  batch_id: string | null;
  batch_kind: string | null;
  batch_status: string | null;
  organizer_id: string | null;
  event_id: string | null;
  deposit_status: string;
  deposit_held: bigint;
  has_claim_code: boolean;
  claim_code_used_at: Date | null;
  wallets: Array<{
    wallet_id: string;
    currency: string;
    spendable: number;
    attached_to_account: boolean;
  }>;
}

const SUMMARY =
  's.media_id, s.status, s.kind, s.key_index, s.personalized_at, s.batch_id, s.batch_kind, s.batch_status, s.organizer_id, s.event_id, s.deposit_status, s.deposit_held, s.has_claim_code, s.claim_code_used_at, s.wallets';

export const mediaAdminDto = (row: SummaryRow) => ({
  media_id: row.media_id,
  status: row.status,
  kind: row.kind,
  key_index: row.key_index,
  personalized_at: row.personalized_at?.toISOString() ?? null,
  batch_id: row.batch_id,
  batch_kind: row.batch_kind,
  batch_status: row.batch_status,
  organizer_id: row.organizer_id,
  event_id: row.event_id,
  deposit_status: row.deposit_status,
  deposit_held: Number(row.deposit_held),
  has_claim_code: row.has_claim_code,
  claim_code_used_at: row.claim_code_used_at?.toISOString() ?? null,
  wallets: row.wallets.map((w) => ({
    wallet_id: w.wallet_id,
    currency: String(w.currency).trim(),
    spendable: Number(w.spendable),
    attached_to_account: w.attached_to_account,
  })),
});

export interface MediaListFilter {
  batchId?: string;
  status?: string;
  /** Organisateurs que la personne peut voir (`null` : tous ceux du prestataire). */
  organizers: string[] | null;
}

@Injectable()
export class MediaReadService {
  /** Organisateur du lot d'un bracelet du prestataire (404 s'il n'existe pas) ; `null` : bracelet sans lot. */
  async organizerOf(client: TxClient, mediaId: string): Promise<string | null> {
    const { rows } = await client.query<{ organizer_id: string | null }>(
      'SELECT b.organizer_id FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id WHERE m.id = $1',
      [mediaId],
    );
    if (!rows[0]) throw notFound();
    return rows[0].organizer_id;
  }

  /** Vue du terminal (contrat `Media`). */
  async forCounter(client: TxClient, mediaId: string) {
    const { rows } = await client.query<{
      id: string;
      kind: string;
      chip_type: string;
      nfc_uid: Buffer | null;
      key_index: number;
      status: string;
      batch_id: string | null;
      batch_kind: string | null;
      deposit_status: string;
      deposit_held: bigint;
      last_counter: bigint | null;
      wallet_ids: string[];
    }>(
      `SELECT m.id, m.kind, m.chip_type, m.nfc_uid, m.key_index, m.status, m.batch_id, b.kind AS batch_kind, m.deposit_status, m.deposit_held, m.last_counter,
              coalesce((SELECT array_agg(a.wallet_id ORDER BY a.currency) FROM media_assignment a WHERE a.media_id = m.id AND a.released_at IS NULL), '{}') AS wallet_ids
         FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id WHERE m.id = $1`,
      [mediaId],
    );
    const m = rows[0];
    if (!m) throw notFound();
    return {
      media_id: m.id,
      kind: m.kind,
      chip_type: m.chip_type,
      nfc_uid: m.nfc_uid?.toString('hex') ?? null,
      key_index: m.key_index,
      status: m.status,
      batch_id: m.batch_id,
      ...(m.batch_kind ? { batch_kind: m.batch_kind } : {}),
      deposit_status: m.deposit_status,
      deposit_held: Number(m.deposit_held),
      wallet_ids: m.wallet_ids,
      last_counter: m.last_counter === null ? null : Number(m.last_counter),
    };
  }

  async list(client: TxClient, filter: MediaListFilter, offset: number, limit: number) {
    const { rows } = await client.query<SummaryRow>(
      `SELECT ${SUMMARY}
         FROM (SELECT m.id FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id
                WHERE ($1::uuid IS NULL OR m.batch_id = $1) AND ($2::text IS NULL OR m.status = $2) AND ($3::uuid[] IS NULL OR b.organizer_id = ANY($3))
                ORDER BY m.id LIMIT $4 OFFSET $5) page
         CROSS JOIN LATERAL media_summary(page.id) s ORDER BY s.media_id`,
      [filter.batchId ?? null, filter.status ?? null, filter.organizers, limit, offset],
    );
    return rows;
  }

  async detail(client: TxClient, mediaId: string) {
    const { rows } = await client.query<SummaryRow>(`SELECT ${SUMMARY} FROM media_summary($1) s`, [
      mediaId,
    ]);
    if (!rows[0]) throw notFound();
    const history = await client.query<{
      from_status: string | null;
      to_status: string;
      reason: string | null;
      actor_id: string | null;
      approved_by: string | null;
      at: Date;
    }>(
      'SELECT from_status, to_status, reason, actor_id, approved_by, at FROM media_status_log($1)',
      [mediaId],
    );
    return {
      ...mediaAdminDto(rows[0]),
      status_history: history.rows.map((h) => ({ ...h, at: h.at.toISOString() })),
    };
  }
}
