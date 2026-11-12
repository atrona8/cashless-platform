// Travailleurs de maintenance du central pour les passerelles (WP12) : silence et rendu bloqué. Importé par
// `processes/maintenance.module.ts` seulement (rôle `cashless_maint`).
import { Module } from '@nestjs/common';
import { EdgeReleaseStuckWorker } from './edge-release-stuck.worker';
import { EdgeSilenceWorker } from './edge-silence.worker';

@Module({ providers: [EdgeSilenceWorker, EdgeReleaseStuckWorker] })
export class EdgeMaintenanceModule {}
