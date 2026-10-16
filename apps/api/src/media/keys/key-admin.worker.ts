// Travailleur de la commande d'administration des clés (décision du porteur n° 6 ; contracts/key-services.md) :
// exécute les travaux `CREATE_KEY` et `DISABLE_KMS_KEY` inscrits par des actions approuvées à deux. C'est le seul
// code qui reçoit `KeyAdminPort` ; il tourne sous le rôle de base cashless_keyadmin, sans aucun accès aux bracelets.
// Reprise sans double effet : la référence de la clé créée est notée dans l'avancement du travail AVANT l'insertion
// de `tag_key` ; un travail repris après une panne réutilise cette référence au lieu de créer une seconde clé.
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { KEY_ADMIN_PORT, type KeyAdminPort } from '../../kms/kms.ports';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';
import { claimJobQuery, KEY_ADMIN_KINDS, TAG_KEY_JOB_COLUMNS, type TagKeyJobRow } from './keys.dto';

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

@Injectable()
export class KeyAdminWorker implements ProcessWorker {
  readonly name = 'key-admin';

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    @Inject(KEY_ADMIN_PORT) private readonly kms: KeyAdminPort,
  ) {
    registry.register(this);
  }

  async describe(): Promise<string[]> {
    const rows = await this.tx.unscoped(async (client) => {
      const result = await client.query<TagKeyJobRow>(
        `SELECT ${TAG_KEY_JOB_COLUMNS} FROM tag_key_job WHERE kind = ANY($1) AND status <> 'DONE' ORDER BY created_at, id`,
        [KEY_ADMIN_KINDS],
      );
      return result.rows;
    });
    return rows.map(
      (job) =>
        `${job.created_at.toISOString()}  ${job.kind}  prestataire ${job.operator_id}  index ${job.key_index}  ${job.status}${job.last_error ? `  (${job.last_error})` : ''}`,
    );
  }

  /** Un travail au plus ; `operators` limite le passage aux travaux de ces prestataires. */
  async runOnce(operators?: readonly string[]): Promise<number> {
    const job = await this.tx.unscoped(async (client) => {
      const { rows } = await client.query<TagKeyJobRow>(claimJobQuery(KEY_ADMIN_KINDS, operators));
      return rows[0] ?? null;
    });
    if (!job) return 0;
    try {
      if (job.kind === 'CREATE_KEY') await this.createKey(job);
      else await this.disableKey(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'échec';
      await this.tx.unscoped((client) =>
        client.query("SELECT finish_tag_key_job($1, 'FAILED', $2)", [job.id, message]),
      );
    }
    return 1;
  }

  private async createKey(job: TagKeyJobRow): Promise<void> {
    let kmsKeyRef = text(job.progress.kms_key_ref);
    if (!kmsKeyRef) {
      kmsKeyRef = await this.kms.createKey('HMAC_256');
      // Noté avant toute écriture de `tag_key` : une reprise ne crée pas une seconde clé dans le service de clés.
      const progress = JSON.stringify({ ...job.progress, kms_key_ref: kmsKeyRef });
      await this.tx.unscoped((client) =>
        client.query("SELECT finish_tag_key_job($1, 'RUNNING', NULL, $2::jsonb)", [
          job.id,
          progress,
        ]),
      );
    }
    const scope = job.payload.scope === 'DEDICATED' ? 'DEDICATED' : 'SHARED';
    const ref = kmsKeyRef;
    await this.tx.run(job.operator_id, async (client) => {
      await client.query(
        `INSERT INTO tag_key (operator_id, key_index, kms_key_ref, scope, dedicated_event_id) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (operator_id, key_index) DO NOTHING`,
        [
          job.operator_id,
          job.key_index,
          ref,
          scope,
          scope === 'DEDICATED' ? text(job.payload.dedicated_event_id) : null,
        ],
      );
      if (scope === 'SHARED') {
        // Nouvelle série : les clés partagées précédentes ne servent plus qu'à lire les bracelets existants (§7.3).
        await client.query(
          `UPDATE tag_key SET status = 'DECRYPT_ONLY' WHERE operator_id = $1 AND scope = 'SHARED' AND status = 'ACTIVE' AND key_index <> $2`,
          [job.operator_id, job.key_index],
        );
      }
      await this.record(client, job, 'TAG_KEY_CREATED', {
        key_index: job.key_index,
        scope,
        dedicated_event_id: text(job.payload.dedicated_event_id),
      });
      await client.query("SELECT finish_tag_key_job($1, 'DONE')", [job.id]);
    });
  }

  private async disableKey(job: TagKeyJobRow): Promise<void> {
    const kmsKeyRef = await this.tx.run(job.operator_id, async (client) => {
      const { rows } = await client.query<{ kms_key_ref: string }>(
        'SELECT kms_key_ref FROM tag_key WHERE operator_id = $1 AND key_index = $2',
        [job.operator_id, job.key_index],
      );
      return rows[0]?.kms_key_ref ?? null;
    });
    if (!kmsKeyRef) throw new Error('Clé introuvable');
    await this.kms.disableKey(kmsKeyRef);
    await this.tx.run(job.operator_id, async (client) => {
      await client.query(
        'UPDATE tag_key SET kms_disabled_at = coalesce(kms_disabled_at, clock_timestamp()) WHERE operator_id = $1 AND key_index = $2',
        [job.operator_id, job.key_index],
      );
      await this.record(client, job, 'TAG_KEY_KMS_DISABLED', { key_index: job.key_index });
      await client.query("SELECT finish_tag_key_job($1, 'DONE')", [job.id]);
    });
  }

  /** L'auteur et le valideur sont ceux de la demande approuvée, portés par le travail. */
  private record(
    client: TxClient,
    job: TagKeyJobRow,
    action: 'TAG_KEY_CREATED' | 'TAG_KEY_KMS_DISABLED',
    after: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(client, {
      operatorId: job.operator_id,
      actorId: text(job.payload.requested_by),
      actorRole: 'OPERATOR_ADMIN',
      origin: 'key-admin',
      requestId: null,
      action,
      objectType: 'tag_key',
      objectId: `${job.operator_id}:${job.key_index}`,
      after,
      approverId: text(job.payload.approved_by),
    });
  }
}
