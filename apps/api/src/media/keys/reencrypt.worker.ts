// Rechiffrement après une rotation (SPECIFICATION §7.4 ; contracts/key-services.md), dans le processus des clés de
// bracelet : le seul qui peut déchiffrer une clé de données. Par tranches de 500 bracelets, chacune dans sa
// transaction : un travail interrompu reprend où il s'était arrêté, sans perte ni double effet (NFR-008).
// Par tranche : un déchiffrement par clé de données rencontrée (les anciennes et la nouvelle), puis pour chaque
// bracelet : ouvrir, resceller sous la nouvelle clé avec un nonce neuf et la même AAD, ROUVRIR ce qui vient d'être
// scellé, comparer, écrire. Un mot de passe illisible fait échouer la tranche entière : rien n'est écrit à moitié.
// La cible est relue à chaque passage : un travail repris après une nouvelle ouverture de session suit la version active.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { openPwdPack, pwdPackAad, sealPwdPack } from '@cashless/tag-format';
import { AuditService } from '../../audit/audit.service';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { DECRYPT_PORT, type DecryptPort } from '../../kms/kms.ports';
import { zeroize } from '../../kms/zeroize';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';
import { DataKeyRepository } from './data-key.repository';
import { DekCache } from './dek-cache';
import { TagKeyJobGate } from './job-gate';
import { claimJobQuery, type TagKeyJobRow } from './keys.dto';

export const REENCRYPT_BATCH = 500;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

interface MediaSecretRow {
  id: string;
  nfc_uid: Buffer;
  pwd_pack_enc: Buffer;
  pwd_pack_dek_id: string;
}

@Injectable()
export class ReencryptWorker implements ProcessWorker {
  readonly name = 'reencrypt';

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    private readonly dataKeys: DataKeyRepository,
    private readonly cache: DekCache,
    private readonly gate: TagKeyJobGate,
    @Inject(DECRYPT_PORT) private readonly kms: DecryptPort,
  ) {
    registry.register(this);
  }

  alarm(): number {
    return this.gate.alarm();
  }

  /** Un travail au plus ; `operators` limite le passage aux travaux de ces prestataires. */
  async runOnce(operators?: readonly string[]): Promise<number> {
    const job = await this.tx.unscoped(async (client) => {
      const { rows } = await client.query<TagKeyJobRow>(claimJobQuery(['REENCRYPT'], operators));
      return rows[0] ?? null;
    });
    if (!job) return 0;
    // Rotation approuvée à deux, terminée, dont ce rechiffrement est la suite (SEC-1) : sinon rien
    // n'est déchiffré.
    if (!(await this.gate.admit(job, 'tag-keys'))) return 1;
    let targetDekId = text(job.payload.target_dek_id);
    let done = typeof job.progress.reencrypted === 'number' ? job.progress.reencrypted : 0;
    try {
      // La cible est la version ACTIVE du moment : si une session de personnalisation en a ouvert une depuis la
      // rotation, c'est sous celle-là que tout converge (celle de la rotation, restée sans bracelet, est retirée).
      targetDekId =
        (await this.tx.run(job.operator_id, (client) =>
          this.dataKeys.activeVersion(client, job.operator_id, job.key_index),
        )) ?? targetDekId;
      if (!targetDekId) throw new Error('Travail de rechiffrement sans clé de données cible');
      const target = targetDekId;
      for (;;) {
        const count = await this.tx.run(job.operator_id, (client) =>
          this.batch(client, job, target),
        );
        if (count === 0) break;
        done += count;
        // Avancement noté après chaque tranche validée ; le verrou du travail est prolongé d'autant.
        const progress = JSON.stringify({ reencrypted: done });
        await this.tx.unscoped((client) =>
          client.query("SELECT finish_tag_key_job($1, 'RUNNING', NULL, $2::jsonb)", [
            job.id,
            progress,
          ]),
        );
      }
      await this.tx.run(job.operator_id, async (client) => {
        // Plus aucun bracelet sous une ancienne version : elles sont retirées.
        const { rows } = await client.query<{ id: string }>(
          `UPDATE tag_data_key d SET status = 'RETIRED'
            WHERE d.operator_id = $1 AND d.key_index = $2 AND d.status = 'DECRYPT_ONLY'
              AND NOT EXISTS (SELECT 1 FROM media m WHERE m.pwd_pack_dek_id = d.id) RETURNING d.id`,
          [job.operator_id, job.key_index],
        );
        for (const row of rows) this.cache.evict(row.id);
        await this.audit.record(client, {
          operatorId: job.operator_id,
          actorId: text(job.payload.requested_by),
          actorRole: 'OPERATOR_ADMIN',
          origin: 'tag-keys',
          requestId: null,
          action: 'TAG_DEK_REENCRYPTED',
          objectType: 'tag_key',
          objectId: `${job.operator_id}:${job.key_index}`,
          after: { key_index: job.key_index, reencrypted: done, retired_versions: rows.length },
          approverId: text(job.payload.approved_by),
        });
        await client.query("SELECT finish_tag_key_job($1, 'DONE', NULL, $2::jsonb)", [
          job.id,
          JSON.stringify({ reencrypted: done, retired_versions: rows.length }),
        ]);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'échec';
      await this.tx.unscoped((client) =>
        client.query("SELECT finish_tag_key_job($1, 'FAILED', $2, $3::jsonb)", [
          job.id,
          message,
          JSON.stringify({ reencrypted: done }),
        ]),
      );
    }
    return 1;
  }

  /** Une tranche : rend le nombre de bracelets rechiffrés (0 : il n'en reste plus). */
  private async batch(client: TxClient, job: TagKeyJobRow, targetDekId: string): Promise<number> {
    const { rows } = await client.query<MediaSecretRow>(
      `SELECT id, nfc_uid, pwd_pack_enc, pwd_pack_dek_id FROM media
        WHERE operator_id = $1 AND key_index = $2 AND pwd_pack_enc IS NOT NULL AND pwd_pack_dek_id <> $3
        ORDER BY id LIMIT $4 FOR UPDATE`,
      [job.operator_id, job.key_index, targetDekId, REENCRYPT_BATCH],
    );
    if (rows.length === 0) return 0;
    // Clés de données de la tranche, déchiffrées une fois chacune et effacées à la fin : pas de cache ici.
    const keys = new Map<string, Buffer>();
    const key = async (dekId: string): Promise<Buffer> => {
      const known = keys.get(dekId);
      if (known) return known;
      const stored = await this.dataKeys.encrypted(client, dekId);
      if (!stored) throw new Error('Clé de données introuvable');
      const plaintext = await this.kms.decrypt(stored.wrappingKeyRef, stored.encrypted);
      keys.set(dekId, plaintext);
      return plaintext;
    };
    try {
      const target = await key(targetDekId);
      for (const media of rows) {
        const aad = pwdPackAad({
          mediaId: media.id,
          operatorId: job.operator_id,
          keyIndex: job.key_index,
          uid: media.nfc_uid,
        });
        const pwdPack = openPwdPack({
          dek: await key(media.pwd_pack_dek_id),
          blob: media.pwd_pack_enc,
          aad,
        });
        try {
          const sealed = sealPwdPack({ dek: target, nonce: randomBytes(12), pwdPack, aad });
          // Vérification avant écriture : ce qui vient d'être scellé se rouvre en la même valeur.
          const check = openPwdPack({ dek: target, blob: sealed, aad });
          const same = timingSafeEqual(check, pwdPack);
          zeroize(check);
          if (!same) throw new Error('Rechiffrement incohérent');
          await client.query(
            'UPDATE media SET pwd_pack_enc = $2, pwd_pack_dek_id = $3 WHERE id = $1',
            [media.id, sealed, targetDekId],
          );
        } finally {
          zeroize(pwdPack);
        }
      }
      return rows.length;
    } finally {
      zeroize(...keys.values());
    }
  }
}
