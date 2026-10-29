// Routes de demande des contestations (mission 6, lot WP13 ; contrat WP01) : `requestLateChargeback`
// (`POST /chargebacks/{chargeback_id}/approval-requests`) et `requestWalletUnblock`
// (`POST /wallets/{wallet_id}/unblock/approval-requests`). Opérations à deux personnes (ADR-74) : `202` avec la
// demande, RIEN d'écrit au grand livre ni sur le portefeuille ; une autre personne l'approuve par les routes générales
// `approval-requests`. Corps vide ; l'événement et le prestataire sont lus en base. Modèle : `reversals.controller.ts`.
import { Body, Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { respondAccepted } from '../approval/approval.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { parseEmptyBody } from './chargebacks.dto';
import { LATE_CHARGEBACK_ROLES, LateChargebackActions } from './late-chargeback-action';
import { WALLET_UNBLOCK_ROLE, WalletUnblockActions } from './wallet-unblock-action';

@Controller()
export class ChargebacksController {
  constructor(
    private readonly access: TenantAccess,
    private readonly lateChargebacks: LateChargebackActions,
    private readonly unblocks: WalletUnblockActions,
  ) {}

  @Post('chargebacks/:chargeback_id/approval-requests')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:', keyUuid: true })
  requestLateChargeback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('chargeback_id') chargebackId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    // Rôle tenu quelque part (403 sinon) ; le rôle sur l'événement de la recharge est contrôlé par la demande.
    const actor = this.access.actor(req, LATE_CHARGEBACK_ROLES);
    parseEmptyBody(body);
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.lateChargebacks.request(
          client,
          actor.operatorId,
          { chargebackId },
          { principal: actor.principal, audit: actor.audit },
        ),
      ),
    );
  }

  @Post('wallets/:wallet_id/unblock/approval-requests')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:', keyUuid: true })
  requestWalletUnblock(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('wallet_id') walletId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, [WALLET_UNBLOCK_ROLE]);
    parseEmptyBody(body);
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.unblocks.request(
          client,
          actor.operatorId,
          { walletId },
          { principal: actor.principal, audit: actor.audit },
        ),
      ),
    );
  }
}
