// Processus « psp-poller » (mission 6, lot WP12) : reprise des notifications conservées, interrogation des recharges
// PSP en attente, expiration et purge des corps bruts. Aucune route métier : des travailleurs, lancés une fois
// (`--once`) par l'ordonnanceur ou à intervalle. Aucun droit sur le service de clés ; pool du rôle applicatif seul
// (db/psp-poller-db.module.ts), sans PlatformTx.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PspPollerDbModule } from '../db/psp-poller-db.module';
import { PspModule } from '../psp/psp.module';
import { PspPollerModule } from '../topups/poller/poller.module';
import { ProcessBaseModule } from './process-base';

@Module({
  imports: [PspPollerDbModule, ProcessBaseModule, AuditModule, PspModule, PspPollerModule],
})
export class PspPollerProcessModule {}
