// Accès base du processus `psp-poller` (mission 6, lot WP12, arbitrage du 27/10/2026) : UN seul pool, celui du rôle
// applicatif `cashless_app` (les fonctions des notifications et de l'interrogation lui sont accordées nommément,
// contrat des droits). Aucune chaîne de connexion de la plateforme, aucun `PlatformTx` dans ce processus. Un rôle
// dédié serait une amélioration possible (hors carte, signalée au porteur).
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, types } from 'pg';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config/config';
import { PG_POOL } from './pool.token';
import { TenantTx } from './tenant-tx';

// int8 (OID 20) -> bigint, comme db.module.ts (les deux modules ne sont jamais chargés ensemble).
types.setTypeParser(20, (value: string) => BigInt(value));

class PspPollerPoolCloser implements OnApplicationShutdown {
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
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.databaseUrl, max: config.poolSize }),
    },
    PspPollerPoolCloser,
    TenantTx,
  ],
  exports: [TenantTx, APP_CONFIG],
})
export class PspPollerDbModule {}
