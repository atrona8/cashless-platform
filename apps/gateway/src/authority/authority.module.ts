// Module de l'autorité (WP17). Branché dans `processes/gateway.module.ts` (une ligne `imports`).
//
// Jetons fournis par ce lot (défauts) :
//  - `AUTHORITY` (AuthorityService) ;
//  - `QUEUE_PROBE` : lecture de la base locale (WP20 peut fournir la sienne) ;
//  - `REPLICATION_CATCH_UP` : fourni par `ReplicationModule` (WP18). Le bouchon de WP17 n'est plus
//    déclaré ici ; sans WP18, `ControlChannel` retombe sur un refus et la garde de production
//    refuse le démarrage (`evaluateProviderRules`).
// `DRAIN_SIGNAL` (WP20) est facultatif.
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { AdminListener } from '../admin/admin-listener';
import { LocalOrdersController } from '../admin/local-orders.controller';
import { CentralClientModule } from '../central-client/central-client.module';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { AUTHORITY, AuthorityService } from './authority.service';
import { ControlChannel } from './control-channel';
import { DbQueueProbe } from './db-ports';
import { QUEUE_PROBE } from './ports';

/**
 * Démarre l'autorité APRÈS migrations, horloge et enrôlement (appelé par `startGateway`) : reprise
 * (A13), écouteur d'administration, canal de contrôle.
 */
@Injectable()
export class AuthorityRuntime implements OnApplicationShutdown {
  constructor(
    @Inject(AuthorityService) private readonly authority: AuthorityService,
    @Inject(ControlChannel) private readonly channel: ControlChannel,
    @Inject(AdminListener) private readonly admin: AdminListener,
    @Inject(LocalOrdersController) private readonly orders: LocalOrdersController,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {
    this.orders.registerOrderHandler('LOCAL_UNSTALE', (body) => this.authority.localUnstale(body));
  }

  async start(): Promise<{ adminPort: number }> {
    await this.authority.recover();
    const adminPort = await this.admin.start();
    if (this.config.centralUrl !== null && this.config.centralClientCertFile !== null) {
      this.channel.start();
    }
    return { adminPort };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.channel.stop();
    await this.admin.stop();
  }
}

@Global()
@Module({
  imports: [CentralClientModule],
  providers: [
    AuthorityService,
    { provide: AUTHORITY, useExisting: AuthorityService },
    ControlChannel,
    LocalOrdersController,
    AdminListener,
    AuthorityRuntime,
    DbQueueProbe,
    { provide: QUEUE_PROBE, useExisting: DbQueueProbe },
  ],
  exports: [
    AUTHORITY,
    AuthorityService,
    ControlChannel,
    LocalOrdersController,
    AuthorityRuntime,
    QUEUE_PROBE,
  ],
})
export class AuthorityModule {}
