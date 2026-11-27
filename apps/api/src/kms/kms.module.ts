// Câblage du service de clés : `KmsModule.forCapabilities(['mac', 'decrypt'])` n'exporte QUE les ports demandés. Un
// port non demandé n'est pas injectable dans le processus (research R-03, NFR-005).
// `KMS_BACKEND=fake` (défaut hors production) : le faux ; `real` : AWS KMS (WP09). En production, la fabrique refuse
// le faux (`FakeInProductionError`) et refuse le réel tant que `kms` n'est pas dans `PRODUCTION_ENABLED_SERVICES`
// (`UntriedInProductionError`). Aucun appel à KMS au démarrage : une panne se voit à l'usage, comme avec le faux.
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PRODUCTION_ENABLED_SERVICES } from '../external-services/production-enabled';
import type { ExternalService } from '../external-services/services';
import { AwsKms } from './aws/aws-kms';
import { createAwsKmsClient } from './aws/aws-kms-client';
import { FakeKms } from './fake-kms';
import { KMS_PORT_TOKENS, type KmsCapability } from './kms.ports';
import { FakeInProductionError, KMS_PROVIDER, UntriedInProductionError } from './production-guard';

// Le jeton est défini dans `production-guard.ts` : le démarrage commun (`processes/bootstrap.ts`, chargé par TOUS les
// processus, public compris) le lit sans importer ce module ni, par lui, le client AWS KMS (WP10, T046 b).
export { KMS_PROVIDER };

type KmsConfig = Pick<AppConfig, 'production'> & Partial<Pick<AppConfig, 'externalModes' | 'aws'>>;

/** Réglage absent : `real` en production, `fake` ailleurs (interfaces.md §2). */
function kmsMode(config: KmsConfig): 'fake' | 'real' {
  return config.externalModes?.kms ?? (config.production ? 'real' : 'fake');
}

/**
 * `capabilities` : les ports du processus (le réel n'expose que ceux-là). `enabled` : la liste du code ; le
 * paramètre ne sert qu'aux tests, jamais à un réglage.
 */
export function createKms(
  config: KmsConfig,
  capabilities: readonly KmsCapability[] = [],
  enabled: readonly ExternalService[] = PRODUCTION_ENABLED_SERVICES,
): object {
  const mode = kmsMode(config);
  if (mode === 'fake') {
    if (config.production) throw new FakeInProductionError(['le service de clés']);
    return new FakeKms();
  }
  if (config.production && !enabled.includes('kms')) throw new UntriedInProductionError('kms');
  const aws = config.aws ?? { region: 'eu-west-3', endpoint: null };
  const ports = new AwsKms(createAwsKmsClient({ aws })).forCapabilities(capabilities);
  // `service` et `isFake` : la garde de production lit ces deux marques ; l'objet reste un simple jeu de fermetures.
  return Object.freeze({ ...ports, isFake: false, service: 'kms' as const });
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
      providers: [
        {
          provide: KMS_PROVIDER,
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => createKms(config, capabilities),
        },
        ...ports,
      ],
      // KMS_PROVIDER reste exporté pour la garde de production et les tests ; il n'ouvre aucun droit de plus à un
      // module qui l'injecterait sous son type de port.
      exports: [KMS_PROVIDER, ...ports.map((port) => (port as { provide: symbol }).provide)],
    };
  }
}
