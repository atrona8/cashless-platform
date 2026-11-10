// Simulation du paiement PSP (développement seulement ; OP-N121, ADR-181). Chargé par AppModule SEULEMENT si
// NODE_ENV vaut `development` ou `test` (`devPspSimulationImports`) : en production, ni module ni route (404).
// Filet : même chargé par erreur, le fabricant de notifications refuse de se construire en production.
import { Module, type Type } from '@nestjs/common';
import { APP_CONFIG } from '../config/config';
import { DEV_NOTIFICATION_FABRICATOR } from '../psp/psp.tokens';
import { createDevNotificationFabricator } from '../psp/psp.providers';
import { PspTopupsModule } from '../topups/psp/psp-topups.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PspSimulationController } from './psp-simulation.controller';
import { PspSimulationService } from './psp-simulation.service';

@Module({
  imports: [PspTopupsModule, WebhooksModule],
  controllers: [PspSimulationController],
  providers: [
    PspSimulationService,
    {
      provide: DEV_NOTIFICATION_FABRICATOR,
      inject: [APP_CONFIG],
      useFactory: createDevNotificationFabricator,
    },
  ],
})
export class DevPspSimulationModule {}

/** Liste blanche : tout autre `NODE_ENV` (production, absent, inconnu) ne charge pas le module. */
export function devPspSimulationImports(env: NodeJS.ProcessEnv = process.env): Type<unknown>[] {
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test' ? [DevPspSimulationModule] : [];
}
