// Accès base d'un processus des clés de bracelet (mission bracelets-nfc, research R-01, R-02). Fichier distinct de
// db.module.ts : il n'importe ni le pool de la plateforme ni PlatformTx, de sorte qu'aucun fichier de la plateforme
// n'est atteignable depuis un processus des clés (test/unit/architecture.spec.ts).
import { Global, Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, types } from 'pg';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config/config';
import { PG_POOL } from './pool.token';
import { TenantTx } from './tenant-tx';

// int8 (OID 20) → bigint, comme dans db.module.ts (les deux modules ne sont jamais chargés ensemble).
types.setTypeParser(20, (value: string) => BigInt(value));

/** Processus des clés de bracelet (mission bracelets-nfc, research R-01, R-02) : un rôle de base par processus. */
export type KeyProcess = 'tag-keys' | 'personalization' | 'tag-check' | 'key-admin';

const KEY_PROCESS_URL: Record<KeyProcess, { field: keyof AppConfig; variable: string }> = {
  'tag-keys': { field: 'tagKeysDatabaseUrl', variable: 'DATABASE_URL_TAGKEYS' },
  personalization: { field: 'personalizationDatabaseUrl', variable: 'DATABASE_URL_PERSO' },
  'tag-check': { field: 'tagCheckDatabaseUrl', variable: 'DATABASE_URL_TAGCHECK' },
  'key-admin': { field: 'keyAdminDatabaseUrl', variable: 'DATABASE_URL_KEYADMIN' },
};

class ProcessPoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Accès base d'un processus des clés : UN seul pool, celui de son rôle (`cashless_tagkeys`, `cashless_perso`,
 * `cashless_tagcheck`, `cashless_keyadmin`). `TenantTx` y est la même classe que dans l'API publique, mais ses
 * transactions s'exécutent sous ce rôle : le processus ne détient ni la chaîne de connexion du rôle applicatif ni
 * celle de la plateforme, et `PlatformTx` n'y existe pas.
 */
@Global()
@Module({})
export class ProcessDbModule {
  static forProcess(process: KeyProcess): DynamicModule {
    const { field, variable } = KEY_PROCESS_URL[process];
    return {
      module: ProcessDbModule,
      providers: [
        { provide: APP_CONFIG, useFactory: () => loadConfig() },
        {
          provide: PG_POOL,
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => {
            const connectionString = config[field] as string;
            if (!connectionString) throw new Error(`${variable} manquant : chaîne de connexion du processus ${process} obligatoire`);
            return new Pool({ connectionString, max: config.poolSize });
          },
        },
        ProcessPoolCloser,
        TenantTx,
      ],
      exports: [TenantTx, APP_CONFIG],
    };
  }
}
