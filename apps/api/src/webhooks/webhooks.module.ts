// Réception des notifications de PSP (mission 6, lot WP12). Importé par AppModule (processus public seulement).
import { Module } from '@nestjs/common';
import { PspTopupsModule } from '../topups/psp/psp-topups.module';
import { EventDispatcher } from './event-dispatcher';
import { WebhookIntake } from './webhook-intake.service';
import { WebhookRejections } from './webhook-rejections';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [PspTopupsModule],
  controllers: [WebhooksController],
  providers: [WebhookIntake, WebhookRejections, EventDispatcher],
  exports: [EventDispatcher],
})
export class WebhooksModule {}
