// Câblage du service de clés : `KmsModule.forCapabilities(['mac', 'decrypt'])` n'exporte QUE les ports demandés. Un
// port non demandé n'est pas injectable dans le processus (research R-03, NFR-005).
// Il n'existe aujourd'hui qu'un faux (décision du porteur) : en production, la fabrique refuse de le construire.
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FakeKms } from './fake-kms';
import { KMS_PORT_TOKENS, type KmsCapability } from './kms.ports';
import { FakeInProductionError } from './production-guard';

/** Fournisseur du service de clés du processus, quel qu'il soit : lu par la garde de production. */
export const KMS_PROVIDER = Symbol('KMS_PROVIDER');

export function createKms(config: Pick<AppConfig, 'production'>): FakeKms {
  if (config.production) throw new FakeInProductionError(['le service de clés']);
  return new FakeKms();
}

@Module({})
export class KmsModule {
  static forCapabilities(capabilities: KmsCapability[]): DynamicModule {
    const ports: Provider[] = [...new Set(capabilities)].map((capability) => ({
      provide: KMS_PORT_TOKENS[capability],
      useExisting: KMS_PROVIDER,
    }));
    return {
      module: KmsModule,
      // Global AU SEIN du processus : ses modules de fonctionnalité injectent les ports que le processus a demandés,
      // et seulement ceux-là (les autres n'existent pas dans ce processus).
      global: true,
      providers: [{ provide: KMS_PROVIDER, inject: [APP_CONFIG], useFactory: createKms }, ...ports],
      // KMS_PROVIDER reste exporté pour la garde de production et les tests ; il n'ouvre aucun droit de plus à un
      // module qui l'injecterait sous son type de port.
      exports: [KMS_PROVIDER, ...ports.map((port) => (port as { provide: symbol }).provide)],
    };
  }
}
