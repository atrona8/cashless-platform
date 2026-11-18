// Routes des réclamations tardives (mission 9b, WP10 ; FR-016) : `postLateClaim`
// (`POST /ledgers/{ledger_id}/late-claims`) et `postLateAdjustment` (`POST
// /ledgers/{ledger_id}/late-adjustments`, route 14). Opérations à deux personnes (ADR-74) : `202`
// avec la demande, RIEN d'écrit au grand livre ; une autre personne l'approuve par les routes
// générales `approval-requests`. Clé d'idempotence `bo:` (UUID). Modèle :
// `chargebacks/chargebacks.controller.ts`.
import { Body, Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { respondAccepted } from '../approval/approval.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { LATE_ADJUSTMENT_ROLES, LateAdjustmentActions } from './late-adjustment-action';
import { LATE_CLAIM_ROLES, LateClaimActions } from './late-claim-action';
import { parseLateAdjustmentBody, parseLateClaimBody } from './late-claims.dto';

@Controller()
export class LateClaimsController {
  constructor(
    private readonly access: TenantAccess,
    private readonly claims: LateClaimActions,
    private readonly adjustments: LateAdjustmentActions,
  ) {}

  @Post('ledgers/:ledger_id/late-claims')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:', keyUuid: true })
  postLateClaim(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('ledger_id') ledgerId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    // Rôle tenu quelque part (403 sinon) ; le rôle sur l'événement est contrôlé par la demande.
    const actor = this.access.actor(req, LATE_CLAIM_ROLES);
    const claim = parseLateClaimBody(body);
    const key = req.header('Idempotency-Key')!;
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.claims.request(
          client,
          actor.operatorId,
          { ledgerId, claim, idempotencyKey: key },
          { principal: actor.principal, audit: actor.audit },
        ),
      ),
    );
  }

  @Post('ledgers/:ledger_id/late-adjustments')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:', keyUuid: true })
  postLateAdjustment(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('ledger_id') ledgerId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, LATE_ADJUSTMENT_ROLES);
    const adjustment = parseLateAdjustmentBody(body);
    const key = req.header('Idempotency-Key')!;
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.adjustments.request(
          client,
          actor.operatorId,
          { ledgerId, adjustment, idempotencyKey: key },
          { principal: actor.principal, audit: actor.audit },
        ),
      ),
    );
  }
}
