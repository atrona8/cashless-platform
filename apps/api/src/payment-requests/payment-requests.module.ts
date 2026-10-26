// Demandes de paiement QR (mission 5b, lot WP13) : QR commerçant (terminal et festivalier) et création du QR
// client par le festivalier. L'encaissement du QR client par le terminal est dans `PaymentsModule` (WP11).
// Importé par AppModule (API publique seule).
import { Module } from '@nestjs/common';
import { ConfigResolverModule } from '../configuration/config-resolver.module';
import { PaymentsModule } from '../payments/payments.module';
import { VendorsModule } from '../vendors/vendors.module';
import { CustomerPaymentRequestsController } from './customer-payment-requests.controller';
import { PaymentRequestService } from './payment-request.service';
import { TerminalPaymentRequestsController } from './terminal-payment-requests.controller';

@Module({
  imports: [ConfigResolverModule, PaymentsModule, VendorsModule],
  controllers: [TerminalPaymentRequestsController, CustomerPaymentRequestsController],
  providers: [PaymentRequestService],
})
export class PaymentRequestsModule {}
