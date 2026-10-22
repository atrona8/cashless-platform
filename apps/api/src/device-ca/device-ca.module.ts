// Autorité des terminaux pour l'API publique (plan IC-08) : le faux hors production seulement. Aucun adaptateur réel
// dans cette mission (C-004, adaptateur KMS ou AWS Private CA après OP-N11) : en production, la fabrique refuse.
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FakeInProductionError } from '../kms/production-guard';
import { DEVICE_CA } from '../security/port-tokens';
import type { DeviceCaPort } from './device-ca.port';
import { FakeDeviceCa } from './fake-device-ca';

/**
 * Production : refus (aucun réglage ne l'évite). Hors production : autorité de test des fichiers réglés si les deux
 * le sont (le serveur HTTPS de test lui fait confiance), en mémoire si aucun ne l'est. Un seul des deux réglages :
 * refus, plutôt qu'une autorité en mémoire dont le serveur refuserait les certificats.
 */
export async function createDeviceCa(
  config: Pick<AppConfig, 'production' | 'deviceCaCertFile' | 'deviceCaFakeKeyFile'>,
): Promise<DeviceCaPort> {
  if (config.production) throw new FakeInProductionError(['l’autorité des terminaux']);
  const { deviceCaCertFile: certFile, deviceCaFakeKeyFile: keyFile } = config;
  if (certFile !== null && keyFile !== null) return FakeDeviceCa.fromFiles({ certFile, keyFile });
  if (certFile === null && keyFile === null) return FakeDeviceCa.inMemory();
  throw new Error(
    certFile === null
      ? 'DEVICE_CA_FAKE_KEY_FILE posé sans DEVICE_CA_CERT_FILE'
      : 'DEVICE_CA_CERT_FILE posé sans DEVICE_CA_FAKE_KEY_FILE : le faux de l’autorité ne peut pas émettre de certificat que le serveur accepte',
  );
}

@Module({
  providers: [{ provide: DEVICE_CA, inject: [APP_CONFIG], useFactory: createDeviceCa }],
  exports: [DEVICE_CA],
})
export class DeviceCaModule {}
