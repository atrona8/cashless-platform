// Module du PIN des vendeurs (mission 5b, lot WP08) : exporte `VendorPinHasher` (secret
// `VENDOR_PIN_SECRET` de la configuration) et refuse le démarrage si argon2 échoue à son test
// (vecteur RFC 9106, aller-retour avec le secret ; argon2-self-test.ts, A16, NFR-009).
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { runArgon2SelfTest } from './argon2-self-test';
import { VendorPinHasher } from './vendor-pin.hasher';

@Module({
  providers: [
    {
      provide: VendorPinHasher,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new VendorPinHasher(config.vendorPinSecret, config.vendorPinIdempotencySecret),
    },
  ],
  exports: [VendorPinHasher],
})
export class VendorPinModule implements OnModuleInit {
  constructor(@Inject(VendorPinHasher) private readonly hasher: VendorPinHasher) {}

  async onModuleInit(): Promise<void> {
    await runArgon2SelfTest(this.hasher);
  }
}
