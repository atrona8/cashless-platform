// Processus « snapshot-content » (mission hors-ligne-snapshots-lots, WP11) : détecte les
// changements par grand
// livre, construit le contenu d'un snapshot et l'inscrit NON signé en brouillon. Rôle de base
// `cashless_snapcontent`
// (pool propre), droits de clé `decrypt` + `dataKey` (branchés par WP12) ; ni signature ni
// publication.
import { Module } from '@nestjs/common';
import { SnapshotContentDbModule } from '../db/snapshot-content-db.module';
import { KmsModule } from '../kms/kms.module';
import { SnapshotContentModule } from '../snapshots-content/snapshot-content.module';
import { ProcessBaseModule } from './process-base';

@Module({
  imports: [
    SnapshotContentDbModule,
    ProcessBaseModule,
    KmsModule.forCapabilities(['decrypt', 'dataKey']),
    SnapshotContentModule,
  ],
})
export class SnapshotContentProcessModule {}
