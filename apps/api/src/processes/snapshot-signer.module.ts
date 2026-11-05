// Processus « snapshot-signer » (WP13 ; R-30.8) : vérifie, signe et publie les brouillons READY, alerte sur les
// trous et les RETRY de plus de 24 h. Rôle de base `cashless_snapsign`. Ports : `SignPort` seul. Ni AuditModule ni
// pool de la plateforme (l'audit SNAPSHOT_PUBLISHED est écrit par la fonction SQL de publication).
import { Module } from '@nestjs/common';
import { SnapshotSignerDbModule } from '../db/snapshot-signer-db.module';
import { KmsModule } from '../kms/kms.module';
import { SnapshotSignerModule } from '../snapshots-signer/snapshot-signer.module';
import { ProcessBaseModule } from './process-base';

@Module({
  imports: [
    SnapshotSignerDbModule,
    ProcessBaseModule,
    KmsModule.forCapabilities(['sign']),
    SnapshotSignerModule,
  ],
})
export class SnapshotSignerProcessModule {}
