// Clés de bracelet côté API publique (SPECIFICATION §7.3, §7.4, §7.7 ; contracts/key-services.md). L'API publique
// n'a aucun droit sur le service de clés : elle lit l'état des clés, vérifie qu'une demande est recevable et inscrit
// des travaux, que les processus qui en ont le droit exécutent.
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../../db/tenant-tx';
import {
  conflict,
  notFound,
  unprocessable,
  type PageRequest,
} from '../../organization/platform/platform.dto';
import {
  TAG_KEY_COLUMNS,
  TAG_KEY_JOB_COLUMNS,
  type TagKeyCheckRunRow,
  type TagKeyJobKind,
  type TagKeyJobRow,
  type TagKeyRequestInput,
  type TagKeyRow,
} from './keys.dto';

export interface DataKeyVersionRow {
  version: number;
  status: 'ACTIVE' | 'DECRYPT_ONLY' | 'RETIRED';
  created_at: Date;
}

export interface JobActors {
  requested_by: string;
  approved_by: string;
}

@Injectable()
export class KeysService {
  async list(client: TxClient, page: PageRequest): Promise<TagKeyRow[]> {
    const { rows } = await client.query<TagKeyRow>(
      `SELECT ${TAG_KEY_COLUMNS} FROM tag_key WHERE operator_id = current_setting('app.operator_id')::uuid ORDER BY key_index DESC LIMIT $1 OFFSET $2`,
      [page.limit + 1, page.offset],
    );
    return rows;
  }

  async row(client: TxClient, keyIndex: number): Promise<TagKeyRow> {
    const { rows } = await client.query<TagKeyRow>(
      `SELECT ${TAG_KEY_COLUMNS} FROM tag_key WHERE operator_id = current_setting('app.operator_id')::uuid AND key_index = $1`,
      [keyIndex],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  /** Versions de clé de données d'une clé : statut seulement (l'API publique ne lit pas la clé chiffrée). */
  async dataKeyVersions(client: TxClient, keyIndex: number): Promise<DataKeyVersionRow[]> {
    const { rows } = await client.query<DataKeyVersionRow>(
      `SELECT version, status, created_at FROM tag_data_key
        WHERE operator_id = current_setting('app.operator_id')::uuid AND key_index = $1 ORDER BY version DESC`,
      [keyIndex],
    );
    return rows;
  }

  async jobs(
    client: TxClient,
    page: PageRequest,
    filter: { keyIndex?: number; openOnly?: boolean } = {},
  ): Promise<TagKeyJobRow[]> {
    const { rows } = await client.query<TagKeyJobRow>(
      `SELECT ${TAG_KEY_JOB_COLUMNS} FROM tag_key_job
        WHERE operator_id = current_setting('app.operator_id')::uuid
          AND ($3::int IS NULL OR key_index = $3) AND (NOT $4::boolean OR status <> 'DONE')
        ORDER BY created_at DESC, id LIMIT $1 OFFSET $2`,
      [page.limit + 1, page.offset, filter.keyIndex ?? null, filter.openOnly ?? false],
    );
    return rows;
  }

  async job(client: TxClient, jobId: string): Promise<TagKeyJobRow> {
    const { rows } = await client.query<TagKeyJobRow>(
      `SELECT ${TAG_KEY_JOB_COLUMNS} FROM tag_key_job WHERE id = $1 AND operator_id = current_setting('app.operator_id')::uuid`,
      [jobId],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  /** Remet en attente un travail en échec ; 409 s'il n'est pas en échec. */
  async retry(client: TxClient, jobId: string): Promise<TagKeyJobRow> {
    const job = await this.job(client, jobId);
    if (job.status !== 'FAILED') throw conflict('Seul un travail en échec se relance.');
    await client.query('SELECT retry_tag_key_job($1)', [jobId]);
    return this.job(client, jobId);
  }

  async checkRuns(client: TxClient, page: PageRequest): Promise<TagKeyCheckRunRow[]> {
    const { rows } = await client.query<TagKeyCheckRunRow>(
      `SELECT id, operator_id, started_at, finished_at, sampled, mismatches, status, detail FROM tag_key_check_run
        WHERE operator_id = current_setting('app.operator_id')::uuid ORDER BY started_at DESC, id LIMIT $1 OFFSET $2`,
      [page.limit + 1, page.offset],
    );
    return rows;
  }

  // ----- Recevabilité des demandes : contrôlée à la demande ET à l'exécution (l'état peut changer entre les deux) -----

  /** Une clé dédiée est réservée à un événement du prestataire. */
  async assertCreatable(client: TxClient, input: TagKeyRequestInput): Promise<void> {
    if (input.scope !== 'DEDICATED') return;
    const { rowCount } = await client.query(
      "SELECT 1 FROM event WHERE id = $1 AND operator_id = current_setting('app.operator_id')::uuid",
      [input.dedicated_event_id],
    );
    if (rowCount !== 1)
      throw unprocessable('dedicated_event_id : événement de ce prestataire attendu.');
  }

  async assertRotatable(client: TxClient, keyIndex: number): Promise<void> {
    const key = await this.row(client, keyIndex);
    if (key.status !== 'ACTIVE')
      throw conflict('La clé n’est pas active : sa clé de données ne tourne plus.');
    await this.assertNoOpenJob(
      client,
      keyIndex,
      ['ROTATE_DEK', 'REENCRYPT'],
      'Une rotation est déjà en cours pour cette clé.',
    );
  }

  /** Retrait : clé dédiée, non retirée, dont tous les lots sont clos (règle de `retire_dedicated_key`, §7.7). */
  async assertRetirable(client: TxClient, keyIndex: number): Promise<void> {
    const key = await this.row(client, keyIndex);
    if (key.scope !== 'DEDICATED') throw conflict('Seule une clé dédiée à un événement se retire.');
    if (key.status === 'RETIRED') throw conflict('Cette clé est déjà retirée.');
    const { rows } = await client.query<{ open: number }>(
      `SELECT count(*)::int AS open FROM media_batch
        WHERE operator_id = current_setting('app.operator_id')::uuid AND key_index = $1 AND status <> 'CLOSED'`,
      [keyIndex],
    );
    if (rows[0]!.open > 0)
      throw conflict('Tous les lots de cette clé doivent être clos avant son retrait.');
    await this.assertNoOpenJob(
      client,
      keyIndex,
      ['RETIRE_KEY', 'DISABLE_KMS_KEY'],
      'Le retrait de cette clé est déjà en cours.',
    );
  }

  private async assertNoOpenJob(
    client: TxClient,
    keyIndex: number,
    kinds: TagKeyJobKind[],
    detail: string,
  ): Promise<void> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM tag_key_job WHERE operator_id = current_setting('app.operator_id')::uuid AND key_index = $1
          AND kind = ANY($2) AND status <> 'DONE'`,
      [keyIndex, kinds],
    );
    if ((rowCount ?? 0) > 0) throw conflict(detail);
  }

  // ----- Inscription des travaux (à l'approbation) -----

  /** Index de la prochaine clé : au-dessus de toute clé existante et de toute création en attente. */
  async nextKeyIndex(client: TxClient): Promise<number> {
    const { rows } = await client.query<{ next: number }>(
      `SELECT 1 + greatest(
                coalesce((SELECT max(key_index) FROM tag_key WHERE operator_id = current_setting('app.operator_id')::uuid), 0),
                coalesce((SELECT max(key_index) FROM tag_key_job WHERE operator_id = current_setting('app.operator_id')::uuid AND kind = 'CREATE_KEY'), 0)
              ) AS next`,
    );
    const next = rows[0]!.next;
    if (next > 65535) throw conflict('Plus aucun index de clé disponible pour ce prestataire.');
    return next;
  }

  /** Inscrit un travail. Sa charge utile décrit quoi faire et qui l'a demandé ; elle ne porte jamais de secret. */
  async enqueue(
    client: TxClient,
    job: {
      keyIndex: number;
      kind: TagKeyJobKind;
      payload: Record<string, unknown>;
      approvalRequestId: string;
      actors: JobActors;
    },
  ): Promise<TagKeyJobRow> {
    const { rows } = await client.query<TagKeyJobRow>(
      `INSERT INTO tag_key_job (operator_id, key_index, kind, payload, approval_request_id)
       VALUES (current_setting('app.operator_id')::uuid, $1, $2, $3::jsonb, $4) RETURNING ${TAG_KEY_JOB_COLUMNS}`,
      [
        job.keyIndex,
        job.kind,
        JSON.stringify({ ...job.payload, ...job.actors }),
        job.approvalRequestId,
      ],
    );
    return rows[0]!;
  }
}
