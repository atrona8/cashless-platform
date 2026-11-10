// Authentification des festivaliers par code à usage unique. L'envoyeur du code est un FAUX jusqu'à la mission 12b :
// il refuse le démarrage en production (otp-sender.ts, garde de processes/bootstrap.ts).
import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { createOtpSender, OTP_SENDER } from './otp-sender';

@Module({
  controllers: [CustomerAuthController],
  providers: [
    { provide: OTP_SENDER, inject: [APP_CONFIG], useFactory: createOtpSender },
    CustomerAuthService,
  ],
})
export class CustomerAuthModule {}
