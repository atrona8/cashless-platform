// Accès base du processus `snapshot-signer` (WP13) : UN seul pool, celui du rôle `cashless_snapsign` (DATABASE_URL_SNAPSIGN).
// Ni chaîne de connexion de la plateforme ni du rôle applicatif, aucun `PlatformTx`. Chaîne vide refusée au démarrage
// de CE processus seulement (les autres processus n'en ont pas besoin).
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, types } from 'pg';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config/config';
import { PG_POOL } from './pool.token';
import { TenantTx } from './tenant-tx';

// int8 (OID 20) -> bigint, comme db.module.ts (les modules ne sont jamais chargés ensemble).
types.setTypeParser(20, (value: string) => BigInt(value));

class SnapshotSignerPoolCloser implements OnApplicationShutdown {
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
      useFactory: (config: AppConfig) => {
        if (!config.snapshotSignerDatabaseUrl)
          throw new Error(
            'DATABASE_URL_SNAPSIGN manquant : chaîne de connexion du processus snapshot-signer',
          );
        return new Pool({
          connectionString: config.snapshotSignerDatabaseUrl,
          max: config.poolSize,
        });
      },
    },
    SnapshotSignerPoolCloser,
    TenantTx,
  ],
  exports: [TenantTx, APP_CONFIG],
})
export class SnapshotSignerDbModule {}
