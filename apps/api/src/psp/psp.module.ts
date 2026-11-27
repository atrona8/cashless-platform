// Ports PSP et coffre des secrets (mission 6, puis 12b-1) : faux hors production par défaut, adaptateurs réels sur
// demande ; en production, seuls les services essayés (`PRODUCTION_ENABLED_SERVICES`) sont actifs.
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PspHttpClient } from './http/psp-http';
import { createPspAdapters, createPspSecretStore } from './psp.providers';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from './psp.tokens';

@Global()
@Module({
  providers: [
    {
      provide: PspHttpClient,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new PspHttpClient(config),
    },
    {
      provide: PSP_ADAPTERS,
      inject: [APP_CONFIG, PspHttpClient],
      useFactory: (config: AppConfig, http: PspHttpClient) => createPspAdapters(config, http),
    },
    {
      provide: PSP_SECRET_STORE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPspSecretStore(config),
    },
  ],
  exports: [PSP_ADAPTERS, PSP_SECRET_STORE],
})
export class PspModule {}
