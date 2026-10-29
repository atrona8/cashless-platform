// Ports PSP et coffre des secrets (mission 6) : faux hors production seulement.
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config';
import { createPspAdapters, createPspSecretStore } from './psp.providers';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from './psp.tokens';

@Global()
@Module({
  providers: [
    { provide: PSP_ADAPTERS, inject: [APP_CONFIG], useFactory: createPspAdapters },
    { provide: PSP_SECRET_STORE, inject: [APP_CONFIG], useFactory: createPspSecretStore },
  ],
  exports: [PSP_ADAPTERS, PSP_SECRET_STORE],
})
export class PspModule {}
