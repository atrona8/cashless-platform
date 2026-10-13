// Événements (mission configuration-parties-evenements, WP09) : création avec grand livre, lecture, modification,
// configuration résolue, et les deux actions à deux de modification d'un événement en service. Les participations
// (sous-module) et les statuts (events/status/, déclarés ici car ils s'appuient sur EventsService) le complètent.
import { Module } from '@nestjs/common';
import { TenantModule } from '../organization/tenant/tenant.module';
import { EventApprovalActions } from './event-approval-actions';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { ParticipationsModule } from './participations/participations.module';
import { GoLiveAction } from './status/go-live-action';
import { StatusController } from './status/status.controller';
import { StatusService } from './status/status.service';

@Module({
  imports: [TenantModule, ParticipationsModule],
  controllers: [EventsController, StatusController],
  providers: [EventsService, EventApprovalActions, StatusService, GoLiveAction],
  exports: [EventsService],
})
export class EventsModule {}
