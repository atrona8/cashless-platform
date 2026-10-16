// Accès base (research R-03) : deux pools `pg`, jamais exportés hors de ce module. Le pool applicatif (rôle
// cashless_app) n'est atteint que par TenantTx, qui fixe le prestataire courant ; le pool de la plateforme (rôle
// cashless_platform, contrat platform-access) que par PlatformTx, réservée aux services de plateforme.
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, types } from 'pg';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config/config';
import { PlatformTx } from './platform-tx';
import { PG_PLATFORM_POOL, PG_POOL } from './pool.token';
import { TenantTx } from './tenant-tx';

// int8 (OID 20) → bigint : les montants ne passent jamais par un flottant. numeric (1700) reste une chaîne.
types.setTypeParser(20, (value: string) => BigInt(value));

class PoolCloser implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PG_PLATFORM_POOL) private readonly platformPool: Pool,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.pool.end(), this.platformPool.end()]);
  }
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.databaseUrl, max: config.poolSize }),
    },
    {
      // Aucune connexion n'est ouverte avant la première transaction de plateforme.
      provide: PG_PLATFORM_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.platformDatabaseUrl, max: config.platformPoolSize }),
    },
    PoolCloser,
    TenantTx,
    PlatformTx,
  ],
  exports: [TenantTx, PlatformTx, APP_CONFIG],
})
export class DbModule {}
