// Modèles de téléphone (mission 11b, WP09). Importé par DevicesModule (API publique seule).
import { Module } from '@nestjs/common';
import { PlatformModule } from '../../organization/platform/platform.module';
import { PhoneModelsController } from './phone-models.controller';
import { PhoneModelsService } from './phone-models.service';

@Module({
  imports: [PlatformModule],
  controllers: [PhoneModelsController],
  providers: [PhoneModelsService],
})
export class PhoneModelsModule {}
