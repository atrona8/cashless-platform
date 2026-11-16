// Parcours du titulaire d'une demande de remboursement (mission 9a, WP03) : code lié à la demande et route publique de
// décision. `RefundsModule` (WP04) l'importe ; les tests de WP03 le montent seuls.
import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { HolderChallengeService } from './holder-challenge.service';
import { HolderDecisionController } from './holder-decision.controller';

@Module({
  imports: [CustomerAuthModule],
  controllers: [HolderDecisionController],
  providers: [HolderChallengeService],
  exports: [HolderChallengeService],
})
export class RefundsHolderModule {}
