// Module de la purge (WP24). Branché dans `processes/gateway.module.ts` (une ligne `imports`).
// `PurgeRuntime.enforceAtStartup()` est appelé par `startGateway` APRÈS les migrations et AVANT
// l'écoute : une purge commencée est terminée avant tout service ; une purge terminée refuse le
// démarrage. `PurgeRuntime.start()` lance le déclencheur automatique après l'écoute.
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD, ModuleRef } from '@nestjs/core';
import { AuthorityModule } from '../authority/authority.module';
import { ControlChannel } from '../authority/control-channel';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { DrainService } from '../queue/drain.service';
import { ReplicationLoop } from '../replication/replication-loop';
import { SnapshotWorker } from '../snapshots/snapshot-worker';
import { ManualPurgeController } from './manual-purge.controller';
import { PurgeGate, PurgeMarkerFile } from './purge-marker';
import { PurgeTrigger } from './purge-trigger';
import { PurgeGuard } from './purge.guard';
import {
  PURGE_GATE,
  PURGE_MARKER,
  PURGE_QUIESCE,
  PurgeService,
  type Quiescer,
} from './purge.service';

export const DEFAULT_MARKER_FILE = 'purge.marker';

export class PurgeCompletedError extends Error {
  constructor() {
    super('purge terminée : la passerelle refuse de redémarrer sur ces données');
    this.name = 'PurgeCompletedError';
  }
}

@Injectable()
export class ProcessQuiescer implements Quiescer {
  constructor(@Inject(ModuleRef) private readonly modules: ModuleRef) {}

  async quiesce(): Promise<void> {
    const stoppables: Array<{ token: unknown; stop: (target: unknown) => unknown }> = [
      { token: ReplicationLoop, stop: (t) => (t as ReplicationLoop).stop() },
      { token: DrainService, stop: (t) => (t as DrainService).stop() },
      { token: SnapshotWorker, stop: (t) => (t as SnapshotWorker).stop() },
      { token: ControlChannel, stop: (t) => (t as ControlChannel).stop() },
    ];
    for (const { token, stop } of stoppables) {
      let target: unknown;
      try {
        target = this.modules.get(token as never, { strict: false });
      } catch {
        continue;
      }
      await stop(target);
    }
  }
}

@Injectable()
export class PurgeRuntime implements OnApplicationShutdown {
  constructor(
    @Inject(PURGE_MARKER) private readonly marker: PurgeMarkerFile,
    @Inject(PurgeService) private readonly purge: PurgeService,
    @Inject(PurgeTrigger) private readonly trigger: PurgeTrigger,
    @Inject(ManualPurgeController) readonly manual: ManualPurgeController,
  ) {}

  /**
   * Marqueur STARTED : termine la purge. Marqueur DONE (ou fin de reprise) : refuse de démarrer.
   */
  async enforceAtStartup(): Promise<void> {
    const marker = this.marker.read();
    if (marker === null) return;
    if (marker.state === 'STARTED') await this.purge.resume(marker.trigger, marker.holders);
    throw new PurgeCompletedError();
  }

  start(): void {
    this.trigger.start();
  }

  onApplicationShutdown(): void {
    this.trigger.stop();
  }
}

@Global()
@Module({
  imports: [AuthorityModule],
  providers: [
    {
      provide: PURGE_MARKER,
      inject: [GATEWAY_CONFIG],
      useFactory: (config: GatewayConfig): PurgeMarkerFile =>
        new PurgeMarkerFile(config.purgeMarkerFile ?? DEFAULT_MARKER_FILE),
    },
    {
      provide: PURGE_GATE,
      inject: [PURGE_MARKER],
      useFactory: (marker: PurgeMarkerFile): PurgeGate => new PurgeGate(marker),
    },
    ProcessQuiescer,
    { provide: PURGE_QUIESCE, useExisting: ProcessQuiescer },
    PurgeService,
    PurgeTrigger,
    ManualPurgeController,
    PurgeRuntime,
    { provide: APP_GUARD, useClass: PurgeGuard },
  ],
  exports: [PurgeService, PurgeRuntime, PURGE_GATE, PURGE_MARKER],
})
export class PurgeModule {}
