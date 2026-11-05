// `POST /v1/devices/{device_id}/seq-gaps/{seq}/waive` (`waiveSeqGap`, mission 7, lot WP20, T083) : crée la demande
// `WAIVE_SEQ_GAP` (`202`, `PENDING`), rien n'est exécuté ; une autre personne `SUPERVISOR` l'approuve par
// `approveApprovalRequest`. Idempotente (`bo:`). Modèle : `cash-deposit.controller.ts`.
import { Body, Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { respondAccepted } from '../../approval/approval.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import { requireUuid } from '../../organization/platform/platform.dto';
import { TenantAccess } from '../../organization/tenant/tenant-access';
import { SeqGapService, parseSeq, parseWaiveBody } from './seq-gap.service';
import { WAIVE_SEQ_GAP_ROLES } from './waive-seq-gap.action';

@Controller('devices')
export class SeqGapController {
  constructor(
    private readonly access: TenantAccess,
    private readonly gaps: SeqGapService,
  ) {}

  @Post(':device_id/seq-gaps/:seq/waive')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:' })
  waive(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('device_id') deviceId: string,
    @Param('seq') seq: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    // Rôle tenu quelque part (403 sinon) ; le rôle sur l'événement du terminal est contrôlé par le service.
    const actor = this.access.actor(req, WAIVE_SEQ_GAP_ROLES);
    const id = requireUuid(deviceId);
    const number = parseSeq(seq);
    const reason = parseWaiveBody(body);
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.gaps.request(
          client,
          actor.operatorId,
          { deviceId: id, seq: number, reason },
          { principal: actor.principal, audit: actor.audit },
        ),
      ),
    );
  }
}
