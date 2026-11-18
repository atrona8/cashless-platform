// Réclamations tardives (mission 9b, WP10) : actions `LATE_CLAIM` et `ADJUSTMENT` et leurs deux
// routes. Importé par AppModule (API publique, une ligne d'import).
import { Module } from '@nestjs/common';
import { ConfigResolverModule } from '../configuration/config-resolver.module';
import { TenantModule } from '../organization/tenant/tenant.module';
import { LateAdjustmentActions } from './late-adjustment-action';
import { LateClaimActions } from './late-claim-action';
import { LateClaimsController } from './late-claims.controller';

@Module({
  imports: [TenantModule, ConfigResolverModule],
  controllers: [LateClaimsController],
  providers: [LateClaimActions, LateAdjustmentActions],
})
export class LateClaimsModule {}
