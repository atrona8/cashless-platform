// Module de la file (WP20). Branché dans `processes/gateway.module.ts` (une ligne `imports`).
//
// Fournit :
//  - `EDGE_QUEUE` (`EdgeQueue.append`), consommé par les lots 21 à 23 ;
//  - `DRAIN_SIGNAL` (`DrainService.requestDrain`), consommé par l'autorité (WP17) ;
//  - `DrainService`, et `QueueRuntime` (démarrage du vidage, appelé par `startGateway`).
// `DELTA_PURGE` (règle de purge des deltas) est facultatif ici : à l'intégration, WP18 le fournit
// par `{ provide: DELTA_PURGE, useFactory: (r: ReplicationService) => r.purge, inject: [...] }`.
// Sans lui, seuls `REJECTED` et `VOID` annulent leurs deltas (`resultOnlyDeltaPurge`, sûr).
//
// Pas de cycle d'injection : `DrainService` ne dépend pas de l'autorité ; `QueueRuntime` branche
// ses réactions (`notifyQueueDrained`, révocation, époque) au démarrage.
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { AuthorityService } from '../authority/authority.service';
import { ControlChannel } from '../authority/control-channel';
import { DRAIN_SIGNAL } from '../authority/ports';
import { CentralClientModule } from '../central-client/central-client.module';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { DrainService } from './drain.service';
import { EDGE_QUEUE, EdgeQueue } from './edge-queue';

@Injectable()
export class QueueRuntime implements OnApplicationShutdown {
  constructor(
    @Inject(DrainService) private readonly drain: DrainService,
    @Inject(AuthorityService) private readonly authority: AuthorityService,
    @Inject(ControlChannel) private readonly channel: ControlChannel,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {
    this.drain.bindHooks({
      onDrained: () => this.channel.notifyQueueDrained(),
      onCertificateRejected: () => this.authority.markRevoked(),
      onCentralEpoch: (epoch) => this.authority.observeEpoch(epoch, 'central'),
    });
  }

  /** Après migrations, horloge, enrôlement et reprise de l'autorité. */
  start(): void {
    if (this.config.centralUrl !== null && this.config.centralClientCertFile !== null) {
      this.drain.start();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain.stop();
  }
}

@Global()
@Module({
  imports: [CentralClientModule],
  providers: [
    EdgeQueue,
    { provide: EDGE_QUEUE, useExisting: EdgeQueue },
    DrainService,
    { provide: DRAIN_SIGNAL, useExisting: DrainService },
    QueueRuntime,
  ],
  exports: [EDGE_QUEUE, EdgeQueue, DRAIN_SIGNAL, DrainService, QueueRuntime],
})
export class QueueModule {}
