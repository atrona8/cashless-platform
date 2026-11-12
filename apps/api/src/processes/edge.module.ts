// Processus « edge » (mission passerelle-locale, WP10) : sert `/edge/*` et la lecture `edgeMtls` de
// `GET /ledgers/{id}/debit-authority`. Rôle de base : cashless_edge (DATABASE_URL_EDGE), UN pool, aucun droit de table.
// Autorité des passerelles propre (EDGE_CA), jamais celle des terminaux. Ni service de clés ni documentation
// interactive : il ne signe ni ne déchiffre rien. Toute route non marquée `@EdgeAuth()` est refusée.
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { ProcessDbModule } from '../db/process-db.module';
import { EdgeIdentityModule } from '../edge/auth/edge-identity.module';
import { EdgeCaModule } from '../edge/ca/edge-ca.module';
import { EdgeControlModule } from '../edge/control/edge-control.module';
import { EdgeHandoverModule } from '../edge/handover/edge-handover.module';
import { EdgeReplicationModule } from '../edge/replication/edge-replication.module';
import { EdgeSyncModule } from '../edge/sync/edge-sync.module';
import { HealthModule } from '../health/health.controller';
import { DenyUnmarkedRoutesGuard, ProcessBaseModule } from './process-base';

@Module({
  imports: [
    ProcessDbModule.forProcess('edge'),
    ProcessBaseModule,
    HealthModule,
    AuditModule,
    EdgeCaModule,
    EdgeIdentityModule,
    EdgeControlModule,
    EdgeHandoverModule,
    EdgeReplicationModule,
    EdgeSyncModule,
  ],
  providers: [
    DenyUnmarkedRoutesGuard,
    { provide: APP_GUARD, useExisting: DenyUnmarkedRoutesGuard },
  ],
})
export class EdgeProcessModule {}
