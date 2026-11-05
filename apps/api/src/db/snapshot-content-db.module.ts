// Accès base du processus `snapshot-content` (mission hors-ligne-snapshots-lots, WP11) : UN seul
// pool, celui du rôle
// `cashless_snapcontent` (DATABASE_URL_SNAPCONTENT). Ni chaîne du rôle applicatif ni de la
// plateforme, aucun
// `PlatformTx`. Une chaîne vide (production sans réglage) est refusée au démarrage de CE processus
// seulement.
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, types } from 'pg';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config/config';
import { AdvisorySession } from './advisory-session';
import { PG_POOL } from './pool.token';
import { TenantTx } from './tenant-tx';

// int8 (OID 20) -> bigint, comme db.module.ts (les deux modules ne sont jamais chargés ensemble).
types.setTypeParser(20, (value: string) => BigInt(value));

class SnapshotContentPoolCloser implements OnApplicationShutdown {
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
        if (!config.snapshotContentDatabaseUrl)
          throw new Error(
            'DATABASE_URL_SNAPCONTENT manquant : chaîne de connexion du processus ' +
              'snapshot-content obligatoire',
          );
        return new Pool({
          connectionString: config.snapshotContentDatabaseUrl,
          max: config.poolSize,
        });
      },
    },
    SnapshotContentPoolCloser,
    TenantTx,
    AdvisorySession,
  ],
  exports: [TenantTx, AdvisorySession, APP_CONFIG],
})
export class SnapshotContentDbModule {}
