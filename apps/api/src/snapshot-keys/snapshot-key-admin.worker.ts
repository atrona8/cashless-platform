// Travailleur « snapshot-key-admin » (WP09, T041) : crée la clé de signature des snapshots dans le service de clés
// (KeyAdminPort, jamais `sign`) puis la fait adopter par `rotate_snapshot_signing_key`.
// Déclencheur (décision du porteur, 30/10/2026) : passage explicite de l'exploitant, `--once` avec
// SNAPSHOT_KEY_ROTATE_ACTOR=<uuid de la personne> ; sinon le travailleur ne fait rien. Cette personne est l'acteur de
// la rotation et de l'audit ; pas d'approbation à deux personnes. Une seule rotation par processus.
// Reprise sans double clé : la référence créée est consignée (audit SNAPSHOT_SIGNING_KEY_CREATED) AVANT la rotation ;
// un passage repris tant qu'elle n'est pas dans `snapshot_signing_key` la réutilise au lieu de créer une autre clé.
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { TenantTx } from '../db/tenant-tx';
import { KEY_ADMIN_PORT, type KeyAdminPort } from '../kms/kms.ports';
import { WorkerRegistry, type ProcessWorker } from '../processes/worker';
import { SnapshotKeyRotation } from './snapshot-key-rotation.service';

export const ROTATE_ACTOR_VARIABLE = 'SNAPSHOT_KEY_ROTATE_ACTOR';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiant stable dérivé de la référence : une reprise retrouve le même `kid`. */
export const signingKeyId = (kmsKeyRef: string): string =>
  `snap-${createHash('sha256').update(kmsKeyRef).digest('hex').slice(0, 24)}`;

@Injectable()
export class SnapshotKeyAdminWorker implements ProcessWorker {
  readonly name = 'snapshot-key-admin';
  private done = false;

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    private readonly rotation: SnapshotKeyRotation,
    @Inject(KEY_ADMIN_PORT) private readonly kms: KeyAdminPort,
  ) {
    registry.register(this);
  }

  private actor(): string | null {
    const value = process.env[ROTATE_ACTOR_VARIABLE]?.trim();
    return value && UUID.test(value) ? value.toLowerCase() : null;
  }

  async describe(): Promise<string[]> {
    const pending = await this.pendingRef();
    return [
      this.actor()
        ? `rotation de la clé de signature des snapshots demandée par ${this.actor()}` +
          (pending ? ` (reprise de la clé ${pending})` : '')
        : `rotation de la clé de signature des snapshots : en attente de ${ROTATE_ACTOR_VARIABLE}=<uuid>`,
    ];
  }

  async runOnce(): Promise<number> {
    const actorId = this.actor();
    if (!actorId || this.done) return 0;
    this.done = true;
    const kmsKeyRef = (await this.pendingRef()) ?? (await this.createAndNote(actorId));
    const publicKey = await this.kms.publicKey(kmsKeyRef);
    await this.rotation.rotate({
      keyId: signingKeyId(kmsKeyRef),
      publicKey,
      kmsKeyRef,
      actorId,
    });
    return 1;
  }

  /** Dernière clé créée mais pas encore adoptée par la base (arrêt entre création et rotation). */
  private pendingRef(): Promise<string | null> {
    return this.tx.unscoped(async (client) => {
      const { rows } = await client.query<{ object_id: string }>(
        `SELECT a.object_id FROM audit_log a
          WHERE a.action = 'SNAPSHOT_SIGNING_KEY_CREATED'
            AND NOT EXISTS (SELECT 1 FROM snapshot_signing_key k WHERE k.kms_key_ref = a.object_id)
          ORDER BY a.id DESC LIMIT 1`,
      );
      return rows[0]?.object_id ?? null;
    });
  }

  private async createAndNote(actorId: string): Promise<string> {
    const kmsKeyRef = await this.kms.createKey('ECC_NIST_P256');
    await this.tx.unscoped((client) =>
      this.audit.record(client, {
        operatorId: null,
        actorId,
        actorRole: null,
        origin: 'key-admin',
        requestId: null,
        action: 'SNAPSHOT_SIGNING_KEY_CREATED',
        objectType: 'snapshot_signing_key',
        objectId: kmsKeyRef,
      }),
    );
    return kmsKeyRef;
  }
}
