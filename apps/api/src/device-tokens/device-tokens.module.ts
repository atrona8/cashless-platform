// Jetons d'appareil (plan IC-08) : signataire (le faux hors production seulement) et service de fabrication et de
// vérification. Importé par l'API publique (émission, vérification) et par le processus des clés de bracelet
// (vérification). Aucun adaptateur réel dans cette mission (C-004, adaptateur KMS après OP-N11) : en production, la
// fabrique refuse.
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FakeInProductionError } from '../kms/production-guard';
import { DeviceTokenService } from './device-token.service';
import { FakeTokenSigner } from './fake-token-signer';
import { TOKEN_SIGNER, type TokenSignerPort } from './token-signer.port';

// Un seul faux par processus Node : les deux processus HTTP d'un même test (API publique, clés de bracelet)
// vérifient avec la même clé publique que celle qui signe (plan IC-08, risques).
let sharedFake: Promise<FakeTokenSigner> | null = null;

/** Production : refus (aucun réglage ne l'évite). Hors production : faux signataire en mémoire. */
export function createTokenSigner(config: Pick<AppConfig, 'production'>): Promise<TokenSignerPort> {
  if (config.production) throw new FakeInProductionError(['le signataire des jetons d’appareil']);
  sharedFake ??= FakeTokenSigner.create();
  return sharedFake;
}

@Module({
  providers: [
    { provide: TOKEN_SIGNER, inject: [APP_CONFIG], useFactory: createTokenSigner },
    DeviceTokenService,
  ],
  exports: [TOKEN_SIGNER, DeviceTokenService],
})
export class DeviceTokensModule {}
