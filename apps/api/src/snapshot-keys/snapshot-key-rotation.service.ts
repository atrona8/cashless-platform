// Rotation de la clé de signature des snapshots (WP09, T041) : contrôle de la clé publique, appel de
// `rotate_snapshot_signing_key` (WP04) et audit AVEC L'ACTEUR RÉEL dans la même transaction (la base ne stocke
// ni ne vérifie `p_actor`). Aucun secret ici : le service reçoit la référence KMS et la clé publique.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { TenantTx } from '../db/tenant-tx';
import { assertSpkiP256 } from './spki-p256';

export interface RotationRequest {
  /** Identifiant (`kid`) de la nouvelle clé, 200 caractères au plus. */
  keyId: string;
  /** SPKI DER P-256, 91 octets. */
  publicKey: Buffer;
  kmsKeyRef: string;
  /** Personne qui a lancé la rotation. */
  actorId: string;
}

@Injectable()
export class SnapshotKeyRotation {
  constructor(
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
  ) {}

  /** Échecs de la base (dont `CL054`, troisième clé valide) : propagés tels quels, sans trace d'audit. */
  async rotate(request: RotationRequest): Promise<void> {
    assertSpkiP256(request.publicKey);
    await this.tx.unscoped(async (client) => {
      await client.query('SELECT rotate_snapshot_signing_key($1, $2, $3, $4)', [
        request.keyId,
        request.publicKey,
        request.kmsKeyRef,
        request.actorId,
      ]);
      await this.audit.record(client, {
        operatorId: null,
        actorId: request.actorId,
        actorRole: null,
        origin: 'key-admin',
        requestId: null,
        action: 'SNAPSHOT_SIGNING_KEY_ROTATED',
        objectType: 'snapshot_signing_key',
        objectId: request.keyId,
        after: { key_id: request.keyId, kms_key_ref: request.kmsKeyRef },
      });
    });
  }
}
