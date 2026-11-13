// Canal de contrôle de la passerelle : bascule d'autorité (attente longue) et lecture de l'autorité de débit.
import { Module } from '@nestjs/common';
import { EdgeIdentityModule } from '../auth/edge-identity.module';
import { CurrentHandoverController } from './current-handover.controller';
import { CurrentHandoverService } from './current-handover.service';
import { DebitAuthorityEdgeController } from './debit-authority-edge.controller';
import { DebitAuthorityReader } from './debit-authority-reader';
import { HandoverListener } from './handover-listener';

@Module({
  imports: [EdgeIdentityModule],
  controllers: [CurrentHandoverController, DebitAuthorityEdgeController],
  providers: [CurrentHandoverService, DebitAuthorityReader, HandoverListener],
  exports: [HandoverListener],
})
export class EdgeControlModule {}
