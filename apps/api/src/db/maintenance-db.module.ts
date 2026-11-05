// Accès base du processus `maintenance` (mission hors-ligne-snapshots-lots, WP10, OP-N75) : UN seul pool, celui du
// rôle `cashless_maint` (les deux purges des terminaux, rien d'autre). Fichier distinct de db.module.ts et de
// psp-poller-db.module.ts : il n'importe ni le pool de la plateforme ni PlatformTx et ne lit pas la chaîne du rôle
// applicatif, de sorte que le processus ne détient aucun autre droit (test/unit/architecture.spec.ts).
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, types } from 'pg';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config/config';
import { assertMaintenanceRole } from './maintenance-role-guard';
import { PG_POOL } from './pool.token';
import { TenantTx } from './tenant-tx';

// int8 (OID 20) → bigint, comme dans db.module.ts (les deux modules ne sont jamais chargés ensemble).
types.setTypeParser(20, (value: string) => BigInt(value));

class ProcessPoolCloser implements OnApplicationShutdown {
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
      useFactory: async (config: AppConfig) => {
        const connectionString = config.maintenanceDatabaseUrl;
        if (!connectionString)
          throw new Error(
            'DATABASE_URL_MAINT manquant : chaîne de connexion du processus maintenance obligatoire',
          );
        const pool = new Pool({ connectionString, max: config.poolSize });
        try {
          // Production : refuse de démarrer si la connexion est le propriétaire ou un superutilisateur (OP-N95).
          await assertMaintenanceRole(pool, config.production);
        } catch (error) {
          await pool.end();
          throw error;
        }
        return pool;
      },
    },
    ProcessPoolCloser,
    TenantTx,
  ],
  exports: [TenantTx, APP_CONFIG],
})
export class MaintenanceDbModule {}
