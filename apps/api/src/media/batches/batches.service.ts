// Lots de bracelets (SPECIFICATION §7.7 ; FR-011 à FR-014) : création, modification tant que le lot est commandé,
// passages de statut, inventaire, clôture et rattrapage du préchargement. Les règles vivent dans la base (contraintes,
// `check_batch_key`, table des passages, `close_batch`, `forfeit_batch_deposits`, `preload_batch`) ; ce service les
// vérifie d'abord pour répondre par un refus clair, puis laisse la base trancher. Chaque écriture est journalisée dans
// la transaction de la requête.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { Language } from '../../http/language';
import { conflict, notFound } from '../../organization/platform/platform.dto';
import {
  BATCH_COLUMNS,
  batchDto,
  batchRefusal,
  type BatchChanges,
  type BatchCreateInput,
  type BatchStatus,
  type MediaBatchRow,
} from './batches.dto';

/** Cautions acquises par transaction : `close_batch` refuse au-delà (§7.7). */
export const FORFEIT_SLICE = 500;
export const PRELOAD_SLICE = 500;

export interface BatchListFilter {
  organizerId?: string;
  eventId?: string;
  status?: string;
  /** Organisateurs que la personne peut voir (`null` : tous ceux du prestataire). */
  organizers: string[] | null;
}

/** Les montants viennent du corps (texte) ou de la base (bigint) : toujours comparés en nombres. */
type BatchShape = Pick<
  BatchCreateInput,
  'event_id' | 'key_index' | 'key_mode' | 'reuse_policy' | 'deposit_mode'
> & { deposit_amount: string | bigint };

@Injectable()
export class BatchesService {
  constructor(private readonly audit: AuditService) {}

  async row(client: TxClient, batchId: string, lock = false): Promise<MediaBatchRow> {
    const { rows } = await client.query<MediaBatchRow>(
      `SELECT ${BATCH_COLUMNS} FROM media_batch WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [batchId],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  async list(
    client: TxClient,
    filter: BatchListFilter,
    offset: number,
    limit: number,
  ): Promise<MediaBatchRow[]> {
    const { rows } = await client.query<MediaBatchRow>(
      `SELECT ${BATCH_COLUMNS} FROM media_batch
        WHERE ($1::uuid IS NULL OR organizer_id = $1) AND ($2::uuid IS NULL OR event_id = $2) AND ($3::text IS NULL OR status = $3)
          AND ($4::uuid[] IS NULL OR organizer_id = ANY($4))
        ORDER BY created_at DESC, id LIMIT $5 OFFSET $6`,
      [
        filter.organizerId ?? null,
        filter.eventId ?? null,
        filter.status ?? null,
        filter.organizers,
        limit,
        offset,
      ],
    );
    return rows;
  }

  /** Organisateurs des événements donnés (portée d'un SUPERVISOR ou d'un CASHIER d'événement). */
  async organizersOfEvents(client: TxClient, eventIds: string[]): Promise<string[]> {
    if (eventIds.length === 0) return [];
    const { rows } = await client.query<{ organizer_id: string }>(
      'SELECT DISTINCT organizer_id FROM event WHERE id = ANY($1::uuid[])',
      [eventIds],
    );
    return rows.map((row) => row.organizer_id);
  }

  async create(
    client: TxClient,
    operatorId: string,
    input: BatchCreateInput,
    actor: AuditContext,
    language: Language,
  ) {
    await this.assertShape(client, operatorId, input.organizer_id, input, language, true);
    const { rows } = await client.query<MediaBatchRow>(
      `INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index, print_order_ref, preload_promo_amount,
                                deposit_amount, deposit_mode, key_mode, reuse_policy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${BATCH_COLUMNS}`,
      [
        operatorId,
        input.organizer_id,
        input.event_id,
        input.kind,
        input.quantity,
        input.key_index,
        input.print_order_ref,
        input.preload_promo_amount,
        input.deposit_amount,
        input.deposit_mode,
        input.key_mode,
        input.reuse_policy,
      ],
    );
    const created = batchDto(rows[0]!);
    await this.audit.record(client, {
      ...actor,
      operatorId,
      action: 'MEDIA_BATCH_CREATED',
      objectType: 'media_batch',
      objectId: created.batch_id,
      after: created,
    });
    return created;
  }

  /** Modifie un lot encore `ORDERED` ; la quantité est figée dès que le fichier de commande existe. */
  async update(
    client: TxClient,
    row: MediaBatchRow,
    changes: BatchChanges,
    actor: AuditContext,
    language: Language,
  ) {
    if (row.status !== 'ORDERED')
      throw conflict(`Un lot ${row.status} ne se modifie plus : seul un lot ORDERED se modifie.`);
    if (
      changes.quantity !== undefined &&
      changes.quantity !== row.quantity &&
      row.claim_codes_issued_at !== null
    ) {
      throw conflict(
        'Le fichier de commande des codes a déjà été produit : la quantité ne se modifie plus.',
      );
    }
    await this.assertShape(
      client,
      row.operator_id,
      row.organizer_id,
      { ...row, ...changes },
      language,
      false,
    );
    const keys = Object.keys(changes) as (keyof BatchChanges)[];
    const { rows } = await client.query<MediaBatchRow>(
      `UPDATE media_batch SET ${keys.map((key, i) => `"${key}" = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING ${BATCH_COLUMNS}`,
      [row.id, ...keys.map((key) => changes[key])],
    );
    const before = batchDto(row);
    const after = batchDto(rows[0]!);
    await this.audit.record(client, {
      ...actor,
      operatorId: row.operator_id,
      action: 'MEDIA_BATCH_UPDATED',
      objectType: 'media_batch',
      objectId: row.id,
      before,
      after,
    });
    return after;
  }

  /** Passage de statut par `set_media_batch_status` ; un passage non prévu est refusé avec les passages permis. */
  async setStatus(
    client: TxClient,
    row: MediaBatchRow,
    to: BatchStatus,
    reason: string | null,
    actor: AuditContext,
    language: Language,
  ) {
    if (to === 'SUSPENDED' && !reason) throw batchRefusal('batch.suspend_reason', language);
    if (to !== row.status) {
      const { rows } = await client.query<{ to_status: string }>(
        'SELECT to_status FROM media_batch_transition WHERE from_status = $1 ORDER BY to_status',
        [row.status],
      );
      const allowed = rows.map((r) => r.to_status).filter((status) => status !== 'CLOSED');
      if (!allowed.includes(to)) {
        throw new ProblemException('MEDIA_STATE_INVALID', {
          status: 409,
          detail: `Passage ${row.status} → ${to} non prévu. Passages permis depuis ${row.status} : ${allowed.join(', ') || 'aucun'} (et la clôture).`,
          extensions: { from: row.status, allowed },
        });
      }
    }
    await client.query('SELECT set_media_batch_status($1, $2, $3, $4)', [
      row.id,
      to,
      reason,
      actor.actorId,
    ]);
    const updated = await this.row(client, row.id);
    if (to !== row.status) {
      await this.audit.record(client, {
        ...actor,
        operatorId: row.operator_id,
        action: 'MEDIA_BATCH_STATUS_CHANGED',
        objectType: 'media_batch',
        objectId: row.id,
        before: { status: row.status },
        after: { status: to, reason },
      });
    }
    return batchDto(updated);
  }

  async inventory(client: TxClient, batchId: string) {
    const { rows } = await client.query<Record<string, string>>(
      `SELECT ordered, registered, in_stock, issued, active, suspended, blacklisted, replaced, returned, end_of_life, missing_from_registry
         FROM batch_inventory WHERE batch_id = $1`,
      [batchId],
    );
    const row = rows[0];
    if (!row) throw notFound();
    return {
      batch_id: batchId,
      ordered: Number(row.ordered),
      registered: Number(row.registered),
      in_stock: Number(row.in_stock),
      issued: Number(row.issued),
      active: Number(row.active),
      suspended: Number(row.suspended),
      blacklisted: Number(row.blacklisted),
      replaced: Number(row.replaced),
      released: Number(row.returned),
      retired: Number(row.end_of_life),
      missing: Number(row.missing_from_registry),
    };
  }

  /**
   * Un pas de clôture : acquiert une tranche de cautions ; s'il n'en reste plus, retire les bracelets, clôt le lot et
   * invalide les codes jamais associés. Tant que `remaining_deposits` > 0, le lot n'est pas clos et l'appelant
   * relance (avec une nouvelle clé d'idempotence). Sur un lot déjà clos : rien à faire, même réponse.
   */
  async close(client: TxClient, row: MediaBatchRow, actor: AuditContext) {
    if (row.status === 'CLOSED')
      return {
        status: 'CLOSED' as const,
        remaining_deposits: 0,
        retired_media: 0,
        invalidated_claim_codes: 0,
      };
    const forfeited = await client.query<{ remaining: number }>(
      'SELECT forfeit_batch_deposits($1, $2)::int AS remaining',
      [row.id, FORFEIT_SLICE],
    );
    const remaining = forfeited.rows[0]!.remaining;
    let result: {
      status: BatchStatus;
      remaining_deposits: number;
      retired_media: number;
      invalidated_claim_codes: number;
    };
    if (remaining > 0) {
      result = {
        status: row.status,
        remaining_deposits: remaining,
        retired_media: 0,
        invalidated_claim_codes: 0,
      };
    } else {
      // L'historique du lot porte l'auteur de la clôture.
      await client.query('SELECT media_set_actor($1, $2)', [actor.actorId, 'Clôture du lot']);
      const closed = await client.query<{ retired: number }>(
        'SELECT close_batch($1)::int AS retired',
        [row.id],
      );
      const invalidated = await client.query<{ n: number }>(
        'SELECT invalidate_unassociated_codes($1)::int AS n',
        [row.id],
      );
      result = {
        status: 'CLOSED',
        remaining_deposits: 0,
        retired_media: closed.rows[0]!.retired,
        invalidated_claim_codes: invalidated.rows[0]!.n,
      };
    }
    await this.audit.record(client, {
      ...actor,
      operatorId: row.operator_id,
      action: 'MEDIA_BATCH_CLOSURE',
      objectType: 'media_batch',
      objectId: row.id,
      before: { status: row.status },
      after: result,
    });
    return result;
  }

  /** Pose les crédits offerts sur les bracelets actifs qui ne les ont pas reçus, par tranche ; rend le nombre traité. */
  async catchUpPreload(client: TxClient, row: MediaBatchRow, actor: AuditContext) {
    if (Number(row.preload_promo_amount) === 0)
      throw conflict('Ce lot ne prévoit pas de préchargement.');
    const { rows } = await client.query<{ processed: number }>(
      'SELECT preload_batch($1, $2)::int AS processed',
      [row.id, PRELOAD_SLICE],
    );
    const processed = rows[0]!.processed;
    if (processed > 0) {
      await this.audit.record(client, {
        ...actor,
        operatorId: row.operator_id,
        action: 'MEDIA_BATCH_PRELOAD_CAUGHT_UP',
        objectType: 'media_batch',
        objectId: row.id,
        after: { processed },
      });
    }
    return { processed };
  }

  /** Règles de forme d'un lot (contraintes de `media_batch` et `check_batch_key`), vérifiées avant l'écriture. */
  private async assertShape(
    client: TxClient,
    operatorId: string,
    organizerId: string,
    batch: BatchShape,
    language: Language,
    creating: boolean,
  ): Promise<void> {
    if ((Number(batch.deposit_amount) === 0) !== (batch.deposit_mode === null))
      throw batchRefusal('batch.deposit_mode', language);
    if (batch.key_mode === 'DEDICATED' && batch.event_id === null)
      throw batchRefusal('batch.dedicated_event', language);
    if (batch.key_mode === 'DEDICATED' && batch.reuse_policy !== 'SINGLE_USE')
      throw batchRefusal('batch.dedicated_single_use', language);
    if (!creating) return;
    if (batch.event_id !== null) {
      const event = await client.query('SELECT 1 FROM event WHERE id = $1 AND organizer_id = $2', [
        batch.event_id,
        organizerId,
      ]);
      if (event.rowCount !== 1) throw batchRefusal('batch.event_unknown', language);
    }
    const { rows } = await client.query<{
      status: string;
      scope: string;
      dedicated_event_id: string | null;
    }>(
      'SELECT status, scope, dedicated_event_id FROM tag_key WHERE operator_id = $1 AND key_index = $2',
      [operatorId, batch.key_index],
    );
    const key = rows[0];
    const vars = { key_index: batch.key_index };
    if (!key) throw batchRefusal('batch.key_unknown', language, vars);
    if (key.status !== 'ACTIVE')
      throw batchRefusal('batch.key_inactive', language, { ...vars, status: key.status });
    if (batch.key_mode === 'SHARED' && key.scope !== 'SHARED')
      throw batchRefusal('batch.key_shared', language, vars);
    if (
      batch.key_mode === 'DEDICATED' &&
      (key.scope !== 'DEDICATED' || key.dedicated_event_id !== batch.event_id)
    ) {
      throw batchRefusal('batch.key_dedicated', language, vars);
    }
  }
}
