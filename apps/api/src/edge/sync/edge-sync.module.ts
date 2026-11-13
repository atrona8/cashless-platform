// Réception `EDGE_SYNC` du processus `edge` (WP13). Aucun port de clé, aucun `KmsModule`, aucun droit de table :
// l'accès central et la preuve du bracelet passent par des fonctions SQL étroites (migration 0066, décision 39).
import { Module } from '@nestjs/common';
import { EdgeIdentityModule } from '../auth/edge-identity.module';
import { EDGE_SYNC_CENTRAL } from './edge-sync-central.port';
import { EdgeSyncController } from './edge-sync.controller';
import { EdgeSyncService } from './edge-sync.service';
import { EdgeSyncWriter } from './edge-sync.writer';
import { PgEdgeSyncCentral, PgTapProofVerifier } from './pg-edge-sync-central';
import { TAP_PROOF_VERIFIER } from './tap-proof.port';

@Module({
  imports: [EdgeIdentityModule],
  controllers: [EdgeSyncController],
  providers: [
    EdgeSyncService,
    EdgeSyncWriter,
    { provide: EDGE_SYNC_CENTRAL, useClass: PgEdgeSyncCentral },
    { provide: TAP_PROOF_VERIFIER, useClass: PgTapProofVerifier },
  ],
})
export class EdgeSyncModule {}
