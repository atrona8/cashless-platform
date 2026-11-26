// Profil du personnel (mission routes-backoffice, WP05). Inscrit dans `IdentityModule`.
import { Module } from '@nestjs/common';
import { StaffProfileController } from './staff-profile.controller';
import { StaffProfileService } from './staff-profile.service';

@Module({
  controllers: [StaffProfileController],
  providers: [StaffProfileService],
})
export class StaffProfileModule {}
