// Authentification des festivaliers par code à usage unique. L'envoi du code passe par la chaîne WhatsApp, SMS
// principal, SMS de repli (otp-chain.ts) ; les trois fournisseurs sont des FAUX jusqu'à la mission 12b, chacun refuse
// le démarrage en production (otp-providers.ts, garde de processes/bootstrap.ts).
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { TenantTx } from '../db/tenant-tx';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { ChainedOtpSender, TenantAttemptRecorder } from './otp-chain';
import {
  createSmsFallbackProvider,
  createSmsPrimaryProvider,
  createWhatsAppProvider,
  OTP_SMS_FALLBACK_PROVIDER,
  OTP_SMS_PRIMARY_PROVIDER,
  OTP_WHATSAPP_PROVIDER,
  type OtpProvider,
} from './otp-providers';
import { OTP_SENDER } from './otp-sender';

@Module({
  controllers: [CustomerAuthController],
  providers: [
    { provide: OTP_WHATSAPP_PROVIDER, inject: [APP_CONFIG], useFactory: createWhatsAppProvider },
    {
      provide: OTP_SMS_PRIMARY_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: createSmsPrimaryProvider,
    },
    {
      provide: OTP_SMS_FALLBACK_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: createSmsFallbackProvider,
    },
    {
      provide: OTP_SENDER,
      inject: [
        APP_CONFIG,
        OTP_WHATSAPP_PROVIDER,
        OTP_SMS_PRIMARY_PROVIDER,
        OTP_SMS_FALLBACK_PROVIDER,
        TenantTx,
      ],
      useFactory: (
        config: Pick<AppConfig, 'otpWhatsappTimeoutMs' | 'otpSmsPrimaryTimeoutMs'>,
        whatsapp: OtpProvider,
        smsPrimary: OtpProvider,
        smsFallback: OtpProvider,
        tx: TenantTx,
      ) =>
        new ChainedOtpSender({
          whatsapp,
          smsPrimary,
          smsFallback,
          whatsappTimeoutMs: config.otpWhatsappTimeoutMs,
          smsPrimaryTimeoutMs: config.otpSmsPrimaryTimeoutMs,
          recorder: new TenantAttemptRecorder(tx),
        }),
    },
    CustomerAuthService,
  ],
  // Seul le service est exporté (mission 9a : codes du titulaire, destination des remboursements).
  exports: [CustomerAuthService],
})
export class CustomerAuthModule {}
