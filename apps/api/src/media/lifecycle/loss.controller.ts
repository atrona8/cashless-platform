// Perte déclarée (`POST /operators/{operator_id}/media/{id}/loss`, contrat `reportMediaLost`) et bracelet retrouvé
// (`…/recovery`, `recoverMedia`) : routes d'un prestataire, idempotentes. Rôles `CASHIER`, `SUPERVISOR`.
import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import {
  invalid,
  objectBody,
  requireUuid,
  textField,
} from '../../organization/platform/platform.dto';
import { TenantAccess } from '../../organization/tenant/tenant-access';
import { LOSS_ROLES, LossService } from './loss.service';

@Controller('operators/:operator_id/media/:media_id')
export class LossController {
  constructor(
    private readonly access: TenantAccess,
    private readonly losses: LossService,
  ) {}

  @Post('loss')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  reportLost(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @Body() raw: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, LOSS_ROLES);
    const id = requireUuid(mediaId);
    const body = objectBody(raw);
    const unknown = Object.keys(body).filter((key) => key !== 'reason');
    if (unknown.length > 0) throw invalid(`${unknown.join(', ')} : champ inconnu.`);
    const reason = textField(body, 'reason', 500, 'required')!;
    return tx.run(async (client) => this.losses.reportLost(client, actor, id, reason));
  }

  @Post('recovery')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  recover(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, LOSS_ROLES);
    const id = requireUuid(mediaId);
    return tx.run(async (client) => this.losses.recover(client, actor, id));
  }
}
