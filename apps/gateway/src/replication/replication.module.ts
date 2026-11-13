// Module de réplication (WP18). Fournit `REPLICATION_CATCH_UP` (le vrai service, qui remplace le
// bouchon de WP17). Branché dans `processes/gateway.module.ts` (une ligne `imports`).
// Intervalle de la boucle : GATEWAY_REPLICATION_INTERVAL_MS (200 à 2000, défaut 1000) ; une valeur
// hors bornes refuse le démarrage (elle porterait NFR-008 au-delà de 5 s).
import { Global, Module } from '@nestjs/common';
import { REPLICATION_CATCH_UP } from '../authority/ports';
import { CentralClient } from '../central-client/central-client';
import { CentralClientModule } from '../central-client/central-client.module';
import { DELTA_PURGE } from '../queue/result-applier';
import { DeltaPurge } from './delta-purge';
import { ReplicationLoop } from './replication-loop';
import {
  DEFAULT_REPLICATION_OPTIONS,
  REPLICATION_FEED,
  REPLICATION_OPTIONS,
  ReplicationService,
  type ReplicationOptions,
} from './replication.service';

export function replicationOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ReplicationOptions {
  const raw = env.GATEWAY_REPLICATION_INTERVAL_MS;
  if (raw === undefined || raw === '') return DEFAULT_REPLICATION_OPTIONS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 200 || value > 2000) {
    throw new Error('GATEWAY_REPLICATION_INTERVAL_MS : entier de 200 à 2000 attendu');
  }
  return { ...DEFAULT_REPLICATION_OPTIONS, intervalMs: value };
}

@Global()
@Module({
  imports: [CentralClientModule],
  providers: [
    { provide: REPLICATION_OPTIONS, useFactory: () => replicationOptionsFromEnv(process.env) },
    { provide: REPLICATION_FEED, useExisting: CentralClient },
    ReplicationService,
    { provide: REPLICATION_CATCH_UP, useExisting: ReplicationService },
    // WP20 : le vidage de la file appelle la VRAIE règle de purge de WP18 (jamais le repli). Instance
    // sans dépendance, partagée avec `ReplicationService` : `DELTA_PURGE` ne dépend PAS du service
    // (sinon cycle réplication -> autorité -> file -> réplication, création bloquée sans erreur).
    DeltaPurge,
    { provide: DELTA_PURGE, useExisting: DeltaPurge },
    ReplicationLoop,
  ],
  exports: [ReplicationService, REPLICATION_CATCH_UP, DELTA_PURGE, ReplicationLoop],
})
export class ReplicationModule {}
