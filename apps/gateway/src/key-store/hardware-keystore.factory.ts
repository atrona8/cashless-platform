// Fabrique du port matériel selon `HARDWARE_KEYSTORE`. `fake` : le faux (jamais en production,
// garde de démarrage).
// `hardware` : l'adaptateur réel, qui n'existe pas dans cette mission (12b) ; il s'enregistre par
// `registerHardwareKeystoreAdapter`. Sans adaptateur, le démarrage échoue : il n'y a pas de repli
// sur le faux.
import type { GatewayConfig } from '../config/config';
import { FakeHardwareKeystore } from './fake-hardware-keystore';
import type { HardwareKeystore } from './hardware-keystore.port';

export class KeystoreAdapterMissingError extends Error {
  constructor() {
    super('HARDWARE_KEYSTORE=hardware : aucun adaptateur matériel installé (mission 12b)');
    this.name = 'KeystoreAdapterMissingError';
  }
}

let adapter: (() => HardwareKeystore) | null = null;

export function registerHardwareKeystoreAdapter(factory: () => HardwareKeystore): void {
  adapter = factory;
}

export function createHardwareKeystore(
  config: Pick<GatewayConfig, 'hardwareKeystore'> & Partial<Pick<GatewayConfig, 'devKeyFile'>>,
): HardwareKeystore {
  if (config.hardwareKeystore === 'fake')
    return new FakeHardwareKeystore({ keyFile: config.devKeyFile ?? null });
  if (adapter === null) throw new KeystoreAdapterMissingError();
  return adapter();
}
