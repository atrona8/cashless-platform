// Fabriques des ports PSP. SEUL fichier de `src/` qui importe `./fake/` (borne OP-N81, testée).
//
// Production : aucun faux n'est construit. Registre vide et indisponible, coffre indisponible : pas de
// recharge en ligne tant que les adaptateurs réels ne sont pas livrés (OP-N81, ADR-131) ; routes espèces
// non concernées ; notification -> 404 côté WP12 ; travailleur inactif. Aucun paramètre d'environnement :
// rien ne permet de demander un faux en production.
import type { AppConfig } from '../config/config';
import { FakeInProductionError } from '../kms/production-guard';
import { FakePspAdapter, type FakeCardInput } from './fake/fake-psp-adapter';
import { fakeEvents, signFakeNotification } from './fake/fake-notification-signer';
import { FakePspSecretStore } from './fake/fake-psp-secret-store';
import { PspAdapterRegistry } from './psp-adapter-registry';
import type { PspSecretStore } from './psp-secret-store.port';
import { Secret } from './secret';
import { PSP_PROVIDERS, type PspProviderName } from './psp.types';
import { UnavailablePspSecretStore } from './unavailable/unavailable-psp';

export function createPspAdapters(config: Pick<AppConfig, 'production'>): PspAdapterRegistry {
  if (config.production) return new PspAdapterRegistry([], false);
  return new PspAdapterRegistry(
    PSP_PROVIDERS.map((provider) => new FakePspAdapter(provider)),
    true,
  );
}

export function createPspSecretStore(config: Pick<AppConfig, 'production'>): PspSecretStore {
  return config.production ? new UnavailablePspSecretStore() : new FakePspSecretStore();
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
