// Lectures de l'app festivalier servies par l'API publique (voir me.service.ts pour les limites jusqu'à la 10a).
import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { LostMediaService } from './lost-media.service';
import { MeService } from './me.service';

@Module({
  controllers: [MeController],
  providers: [MeService, LostMediaService],
})
export class MeModule {}
