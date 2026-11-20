// Module du PIN des vendeurs côté API (mission 5b, lot WP08 ; mission 11a, lot WP06) : exporte
// `VendorPinHasher`, réduit au dérivé d'idempotence du PIN (ADR-126, secret
// `VENDOR_PIN_IDEMPOTENCY_SECRET`). L'API ne porte plus le secret des empreintes : il n'existe que
// dans le processus `vendor-pin` (vendor-pin-server.module.ts). Au démarrage : vecteur RFC 9106 et
// un dérivé d'essai ; échec → démarrage refusé (A16, NFR-009).
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { checkRfc9106Vector } from './argon2-self-test';
import { VendorPinHasher } from './vendor-pin.hasher';

@Module({
  providers: [
    {
      provide: VendorPinHasher,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new VendorPinHasher(config.vendorPinIdempotencySecret),
    },
  ],
  exports: [VendorPinHasher],
})
export class VendorPinModule implements OnModuleInit {
  constructor(@Inject(VendorPinHasher) private readonly hasher: VendorPinHasher) {}

  async onModuleInit(): Promise<void> {
    await checkRfc9106Vector();
    await this.hasher.ready();
  }
}
