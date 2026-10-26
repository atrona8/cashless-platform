// Paiement par bracelet ou QR client (mission 5b, lot WP11) : `createPayment`, `getPayment`, registre des
// numéros du terminal (`DeviceSeqRegistry`, exporté pour WP12 et WP13) et empreinte du jeton QR
// (`qrTokenHash`, dans `qr-token-hash.ts`). Importé par AppModule (API publique seule).
import { Module } from '@nestjs/common';
import { ConfigResolverModule } from '../configuration/config-resolver.module';
import { TapsModule } from '../media/taps/taps.module';
import { VendorsModule } from '../vendors/vendors.module';
import { DeviceSeqRegistry } from './device-seq-registry';
import { PaymentReadService } from './payment-read.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [ConfigResolverModule, TapsModule, VendorsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentReadService, DeviceSeqRegistry],
  exports: [DeviceSeqRegistry, PaymentReadService],
})
export class PaymentsModule {}
