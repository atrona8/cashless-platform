// Accès base (research R-03) : un seul pool `pg`, en rôle cashless_app, jamais exporté hors de ce module.
// Seul TenantTx est exporté : toute requête passe par une transaction qui fixe le prestataire courant.
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, types } from 'pg';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config/config';
import { PG_POOL } from './pool.token';
import { TenantTx } from './tenant-tx';

// int8 (OID 20) → bigint : les montants ne passent jamais par un flottant. numeric (1700) reste une chaîne.
types.setTypeParser(20, (value: string) => BigInt(value));

class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new Pool({ connectionString: config.databaseUrl, max: config.poolSize }),
    },
    PoolCloser,
    TenantTx,
  ],
  exports: [TenantTx, APP_CONFIG],
})
export class DbModule {}
