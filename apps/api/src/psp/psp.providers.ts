// Fabriques des ports PSP. SEUL fichier de `src/` qui importe `./fake/` (borne OP-N81, testée).
//
// Production : aucun faux n'est construit. Registre vide et indisponible, coffre indisponible : pas de
// recharge en ligne tant que les adaptateurs réels ne sont pas livrés (OP-N81, ADR-131) ; routes espèces
// non concernées ; notification -> 404 côté WP12 ; travailleur inactif. Aucun paramètre d'environnement :
// rien ne permet de demander un faux en production.
import type { AppConfig } from '../config/config';
import { FakePspAdapter } from './fake/fake-psp-adapter';
import { FakePspSecretStore } from './fake/fake-psp-secret-store';
import { PspAdapterRegistry } from './psp-adapter-registry';
import type { PspSecretStore } from './psp-secret-store.port';
import { PSP_PROVIDERS } from './psp.types';
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
