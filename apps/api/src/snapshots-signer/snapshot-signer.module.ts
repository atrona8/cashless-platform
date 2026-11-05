// Signature et alertes des snapshots hors ligne (processus `snapshot-signer`, WP13). Aucun audit, aucun autre port
// que `SignPort` (fourni par `KmsModule.forCapabilities(['sign'])` du processus).
import { Module } from '@nestjs/common';
import { SeqGapAgeWorker } from './seq-gap-age.worker';
import { SnapshotSignerRepository } from './snapshot-signer.repository';
import { SnapshotSignerWorker } from './snapshot-signer.worker';

@Module({ providers: [SnapshotSignerRepository, SnapshotSignerWorker, SeqGapAgeWorker] })
export class SnapshotSignerModule {}
