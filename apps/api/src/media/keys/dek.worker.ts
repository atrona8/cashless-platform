// Travailleur de la personnalisation pour les clés (contracts/key-services.md) : `ROTATE_DEK` et `RETIRE_KEY`,
// inscrits par des actions approuvées à deux. Sous le rôle cashless_perso, avec les seuls droits de calcul d'un mot
// de passe et d'ouverture d'une clé de données — jamais de déchiffrement.
//   ROTATE_DEK : ouvre une nouvelle version ACTIVE (son clair est effacé aussitôt, il ne sert pas ici), les autres
//                ne servent plus qu'à déchiffrer ; inscrit le rechiffrement, fait par le processus des clés.
//   RETIRE_KEY : `retire_dedicated_key` (clé et clés de données retirées, mots de passe effacés, bracelets en fin de
//                vie) ; inscrit la désactivation dans le service de clés, faite par la commande d'administration.
import { Inject, Injectable } from '@nestjs/common';
import { AuditService, type AuditAction } from '../../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { DATA_KEY_PORT, type DataKeyPort } from '../../kms/kms.ports';
import { zeroize } from '../../kms/zeroize';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';
import { DataKeyRepository } from './data-key.repository';
import { claimJobQuery, type TagKeyJobKind, type TagKeyJobRow } from './keys.dto';
import { SessionDataKeyProvider } from './session-data-key';

const KINDS: TagKeyJobKind[] = ['ROTATE_DEK', 'RETIRE_KEY'];
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

@Injectable()
export class DekWorker implements ProcessWorker {
  readonly name = 'data-keys';

  constructor(
    registry: WorkerRegistry,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'tagWrappingKeyRef'>,
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    private readonly dataKeys: DataKeyRepository,
    private readonly sessions: SessionDataKeyProvider,
    @Inject(DATA_KEY_PORT) private readonly kms: DataKeyPort,
  ) {
    registry.register(this);
  }

  /** Un travail au plus ; `operators` limite le passage aux travaux de ces prestataires. */
  async runOnce(operators?: readonly string[]): Promise<number> {
    const job = await this.tx.unscoped(async (client) => {
      const { rows } = await client.query<TagKeyJobRow>(claimJobQuery(KINDS, operators));
      return rows[0] ?? null;
    });
    if (!job) return 0;
    try {
      if (job.kind === 'ROTATE_DEK') await this.rotate(job);
      else await this.retire(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'échec';
      await this.tx.unscoped((client) =>
        client.query("SELECT finish_tag_key_job($1, 'FAILED', $2)", [job.id, message]),
      );
    }
    return 1;
  }

  private async rotate(job: TagKeyJobRow): Promise<void> {
    const { plaintext, encrypted } = await this.kms.generateDataKey(this.config.tagWrappingKeyRef);
    // Le clair ne sert pas à la rotation : le rechiffrement se fait dans le processus des clés, qui déchiffre.
    zeroize(plaintext);
    await this.tx.run(job.operator_id, async (client) => {
      if ((await this.dataKeys.keyStatus(client, job.operator_id, job.key_index)) !== 'ACTIVE')
        throw new Error('La clé n’est plus active');
      const version = await this.dataKeys.openVersion(
        client,
        job.operator_id,
        job.key_index,
        this.config.tagWrappingKeyRef,
        encrypted,
      );
      await this.child(client, job, 'REENCRYPT', {
        target_dek_id: version.id,
        target_version: version.version,
      });
      await this.record(client, job, 'TAG_DEK_ROTATED', {
        key_index: job.key_index,
        version: version.version,
      });
      await client.query("SELECT finish_tag_key_job($1, 'DONE', NULL, $2::jsonb)", [
        job.id,
        JSON.stringify({ version: version.version }),
      ]);
    });
    // La session ouverte sur l'ancienne version n'est plus valable.
    this.sessions.forget(job.operator_id, job.key_index);
  }

  private async retire(job: TagKeyJobRow): Promise<void> {
    await this.tx.run(job.operator_id, async (client) => {
      const { rows } = await client.query<{ retired: number }>(
        'SELECT retire_dedicated_key($1, $2) AS retired',
        [job.operator_id, job.key_index],
      );
      await this.child(client, job, 'DISABLE_KMS_KEY', {});
      await this.record(client, job, 'TAG_KEY_RETIRED', {
        key_index: job.key_index,
        retired_media: rows[0]!.retired,
      });
      await client.query("SELECT finish_tag_key_job($1, 'DONE', NULL, $2::jsonb)", [
        job.id,
        JSON.stringify({ retired_media: rows[0]!.retired }),
      ]);
    });
    this.sessions.forget(job.operator_id, job.key_index);
  }

  /** Travail suivant de la chaîne ; il hérite de l'auteur et du valideur de la demande d'origine. */
  private async child(
    client: TxClient,
    job: TagKeyJobRow,
    kind: TagKeyJobKind,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO tag_key_job (operator_id, key_index, kind, payload, approval_request_id, parent_job_id) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        job.operator_id,
        job.key_index,
        kind,
        JSON.stringify({
          ...payload,
          requested_by: text(job.payload.requested_by),
          approved_by: text(job.payload.approved_by),
        }),
        job.approval_request_id,
        job.id,
      ],
    );
  }

  private record(
    client: TxClient,
    job: TagKeyJobRow,
    action: AuditAction,
    after: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(client, {
      operatorId: job.operator_id,
      actorId: text(job.payload.requested_by),
      actorRole: 'OPERATOR_ADMIN',
      origin: 'personalization',
      requestId: null,
      action,
      objectType: 'tag_key',
      objectId: `${job.operator_id}:${job.key_index}`,
      after,
      approverId: text(job.payload.approved_by),
    });
  }
}
