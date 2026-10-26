// Idempotence applicative (S21) : intercepteur global, actif seulement sur les routes marquées `@Idempotent`.
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { RequestLockInterceptor } from './request-lock';
import {
  IDEMPOTENCY_SETTINGS,
  IdempotencyRepository,
  loadIdempotencySettings,
} from './idempotency.repository';

@Module({
  providers: [
    { provide: IDEMPOTENCY_SETTINGS, useFactory: () => loadIdempotencySettings() },
    IdempotencyRepository,
    // Ordre : le verrou de requête AVANT l'idempotence (request-lock.ts).
    { provide: APP_INTERCEPTOR, useClass: RequestLockInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class IdempotencyModule {}
