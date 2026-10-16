// Rattachement d'un bracelet par son code imprimé, confirmation au guichet, consultation anonyme
// du solde.
import { Module } from '@nestjs/common';
import { ClaimHasher } from '../../kms/claim-hash';
import { LifecycleModule } from '../lifecycle/lifecycle.module';
import { TapsModule } from '../taps/taps.module';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

@Module({
  imports: [LifecycleModule, TapsModule],
  controllers: [ClaimsController],
  providers: [ClaimHasher, ClaimsService],
})
export class ClaimsModule {}
