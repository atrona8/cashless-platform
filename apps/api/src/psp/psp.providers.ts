// Fabriques des ports PSP. SEUL fichier de `src/` qui importe `./fake/` (borne OP-N81, testée).
//
// Réglages `PSP_ADAPTERS` et `PSP_SECRET_STORE` (`fake` | `real`) :
// - hors production : `fake` par défaut, `real` permis (bac à sable, préproduction, faux serveurs de test) ;
// - production : réglage absent = `real` ; `fake` → `FakeInProductionError` ; `real` : seuls les services de
//   `PRODUCTION_ENABLED_SERVICES` (vide aujourd'hui, D3/D6) entrent ; sinon le registre est vide (503/404) et le
//   coffre indisponible, démarrage permis (comportement de OP-N81, ADR-131).
// Orange Money : jamais de réel (D1, hors périmètre). Aucun appel réseau à la construction.
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { AppConfig } from '../config/config';
import { PRODUCTION_ENABLED_SERVICES } from '../external-services/production-enabled';
import type { ExternalService } from '../external-services/services';
import { FakeInProductionError } from '../kms/production-guard';
import { AwsSecretsManagerStore } from './aws/secrets-manager-store';
import { FakePspAdapter, type FakeCardInput } from './fake/fake-psp-adapter';
import { fakeEvents, signFakeNotification } from './fake/fake-notification-signer';
import { FakePspSecretStore } from './fake/fake-psp-secret-store';
import { PspHttpClient } from './http/psp-http';
import { PayDunyaPspAdapter } from './paydunya/paydunya-adapter';
import type { PspAdapter } from './psp-adapter.port';
import { PspAdapterRegistry } from './psp-adapter-registry';
import type { PspSecretStore } from './psp-secret-store.port';
import { Secret } from './secret';
import { StripePspAdapter } from './stripe/stripe-adapter';
import { PSP_PROVIDERS, type PspProviderName } from './psp.types';
import { UnavailablePspSecretStore } from './unavailable/unavailable-psp';
import { WavePspAdapter } from './wave/wave-adapter';

type Mode = 'fake' | 'real';
type PspConfig = Pick<AppConfig, 'production'> &
  Partial<
    Pick<AppConfig, 'externalModes' | 'pspHttpTimeoutMs' | 'pspBases' | 'waveDefaultUrls' | 'aws'>
  >;

/** Réglage absent : `real` en production, `fake` ailleurs (interfaces.md §2). */
const modeOf = (config: PspConfig, key: 'psp' | 'pspSecrets'): Mode =>
  config.externalModes?.[key] ?? (config.production ? 'real' : 'fake');

function realAdapters(
  config: PspConfig,
  http: PspHttpClient,
  allowed: (service: ExternalService) => boolean,
): PspAdapter[] {
  const full = config as Required<
    Pick<AppConfig, 'pspBases' | 'waveDefaultUrls' | 'pspHttpTimeoutMs'>
  >;
  const builders: Array<[ExternalService, () => PspAdapter]> = [
    ['psp.wave', () => new WavePspAdapter(http, full)],
    ['psp.paydunya', () => new PayDunyaPspAdapter(http, full)],
    ['psp.stripe', () => new StripePspAdapter(http, full)],
  ];
  // Seuls les services autorisés sont CONSTRUITS : en production, un réel non listé n'existe pas dans le processus.
  return builders.filter(([service]) => allowed(service)).map(([, build]) => build());
}

/**
 * `http` : client sortant partagé (fourni par `PspModule`). `enabled` : la liste du code ; le paramètre ne sert
 * qu'aux tests, jamais à un réglage.
 */
export function createPspAdapters(
  config: PspConfig,
  http?: PspHttpClient,
  enabled: readonly ExternalService[] = PRODUCTION_ENABLED_SERVICES,
): PspAdapterRegistry {
  const mode = modeOf(config, 'psp');
  if (config.production && mode === 'fake')
    throw new FakeInProductionError(['les adaptateurs PSP']);
  if (mode === 'fake')
    return new PspAdapterRegistry(
      PSP_PROVIDERS.map((provider) => new FakePspAdapter(provider)),
      true,
    );
  const allowed = (service: ExternalService): boolean =>
    !config.production || enabled.includes(service);
  if (!['psp.wave', 'psp.paydunya', 'psp.stripe'].some((s) => allowed(s as ExternalService)))
    return new PspAdapterRegistry([], false);
  const adapters = realAdapters(config, http ?? new PspHttpClient(config as AppConfig), allowed);
  // Production sans service essayé : registre vide et indisponible (503/404), comme avant les adaptateurs réels.
  return new PspAdapterRegistry(adapters, adapters.length > 0);
}

/** `client` : faux serveur local des tests. Les identifiants viennent de la chaîne par défaut du SDK. */
export function createPspSecretStore(
  config: PspConfig,
  enabled: readonly ExternalService[] = PRODUCTION_ENABLED_SERVICES,
  client?: SecretsManagerClient,
): PspSecretStore {
  const mode = modeOf(config, 'pspSecrets');
  if (config.production && mode === 'fake')
    throw new FakeInProductionError(['le coffre des secrets PSP']);
  if (mode === 'fake') return new FakePspSecretStore();
  if (config.production && !enabled.includes('psp.secrets')) return new UnavailablePspSecretStore();
  const aws = config.aws ?? { region: 'eu-west-3', endpoint: null };
  return new AwsSecretsManagerStore(
    client ??
      new SecretsManagerClient({
        region: aws.region,
        ...(aws.endpoint === null ? {} : { endpoint: aws.endpoint }),
      }),
  );
}

/** Notification de paiement que le PSP enverrait, signée, pour la route de simulation de DÉVELOPPEMENT. */
export interface DevNotificationInput {
  provider: PspProviderName;
  secret: Secret;
  outcome: 'SUCCEEDED' | 'FAILED';
  notificationId: string;
  merchantReference: string;
  paymentId: string;
  amount: number;
  currency: string;
  card?: FakeCardInput;
}

export type DevNotificationFabricator = (input: DevNotificationInput) => {
  rawBody: Buffer;
  headers: Record<string, string>;
};

/** Hors production seulement : en production, refus explicite (OP-N121, ADR-181). */
export function createDevNotificationFabricator(
  config: Pick<AppConfig, 'production'>,
): DevNotificationFabricator {
  if (config.production) throw new FakeInProductionError(['la simulation de paiement PSP']);
  return (input) => {
    const base = {
      id: input.notificationId,
      merchantReference: input.merchantReference,
      paymentId: input.paymentId,
      amount: input.amount,
      currency: input.currency,
      ...(input.card ? { card: input.card } : {}),
    };
    const event =
      input.outcome === 'SUCCEEDED' ? fakeEvents.succeeded(base) : fakeEvents.failed(base);
    const { rawBody, headers } = signFakeNotification({
      provider: input.provider,
      secret: input.secret,
      event,
    });
    return { rawBody, headers };
  };
}
