// Accusé et rendu de l'autorité de débit (WP12).
import { Module } from '@nestjs/common';
import { EdgeIdentityModule } from '../auth/edge-identity.module';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';

@Module({
  imports: [EdgeIdentityModule],
  controllers: [HandoverController],
  providers: [HandoverService],
})
export class EdgeHandoverModule {}
