// Module serveur du processus `vendor-pin` (mission 11a, lot WP06 ; FR-005, C-006, C-008). Seul
// endroit où le secret des PIN est lu (`vendorPinSettings`, config.ts) : l'API publique n'atteint
// pas ce fichier (test/unit/architecture.spec.ts). Au démarrage, avant d'écouter : réglages
// complets (secret, clé d'appel, base : l'absence en production refuse le démarrage) puis test
// d'argon2 (vecteur RFC 9106, aller-retour avec le secret ; échec : démarrage refusé, NFR-009).
// Aucun faux, aucun repli.
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { vendorPinSettings } from '../config/config';
import { runArgon2SelfTest } from './argon2-self-test';
import { VendorPinCallGuard } from './vendor-pin-call.guard';
import { VendorPinInternalController } from './vendor-pin-internal.controller';
import { VendorPinOpenService } from './vendor-pin-open.service';
import { VendorPinDigester } from './vendor-pin.digester';
import {
  VENDOR_PIN_CALL_KEY,
  VENDOR_PIN_SETTINGS,
  type VendorPinSettings,
} from './vendor-pin.tokens';

@Module({
  controllers: [VendorPinInternalController],
  providers: [
    { provide: VENDOR_PIN_SETTINGS, useFactory: () => vendorPinSettings() },
    {
      provide: VENDOR_PIN_CALL_KEY,
      inject: [VENDOR_PIN_SETTINGS],
      useFactory: (settings: VendorPinSettings) => settings.vendorPinCallKey,
    },
    {
      provide: VendorPinDigester,
      inject: [VENDOR_PIN_SETTINGS],
      useFactory: (settings: VendorPinSettings) => new VendorPinDigester(settings.vendorPinSecret),
    },
    VendorPinCallGuard,
    VendorPinOpenService,
  ],
})
export class VendorPinServerModule implements OnModuleInit {
  constructor(@Inject(VendorPinDigester) private readonly digester: VendorPinDigester) {}

  async onModuleInit(): Promise<void> {
    await runArgon2SelfTest(this.digester);
  }
}
