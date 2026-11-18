// Route 9 (mission 9b, lot WP08 ; contrat `confirmPayout`) : résultat d'un versement payé hors
// système. Aucune règle
// de deux personnes sur le résultat (FR-012) ; le rôle est celui de la nature du bénéficiaire de la
// ligne.
import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { PAYOUT_ROLES } from './payout-action';
import { parseConfirmBody } from './payouts.dto';
import { PayoutsService } from './payouts.service';

@Controller('payouts')
export class PayoutsController {
  constructor(
    private readonly access: TenantAccess,
    private readonly payouts: PayoutsService,
  ) {}

  @Post(':payout_id/confirm')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  confirm(
    @Req() req: Request,
    @Param('payout_id') id: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, PAYOUT_ROLES);
    const input = parseConfirmBody(body);
    return tx.run((client) => this.payouts.confirm(client, actor, id, input));
  }
}
