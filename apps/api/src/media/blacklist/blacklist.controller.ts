// Liste noire (`POST /operators/{operator_id}/media/{media_id}/blacklist`, contrat
// `blacklistMedia`) et demande de sortie à deux (`…/reinstatement`, `requestMediaReinstatement`,
// 202 avec la demande d'approbation). Rôle `SUPERVISOR` sur l'événement ou l'organisateur du
// bracelet. Aucune route ne remet un bracelet en service : seule l'approbation de la demande,
// par une autre personne, le fait (`ApprovalController`).
import { Body, Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApprovalService, respondAccepted } from '../../approval/approval.service';
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
import { BLACKLIST_ROLE, BlacklistService } from './blacklist.service';

/** Corps `MediaReason` : un motif, rien d'autre. */
function reasonOf(raw: unknown): string {
  const body = objectBody(raw);
  const unknown = Object.keys(body).filter((key) => key !== 'reason');
  if (unknown.length > 0) throw invalid(`${unknown.join(', ')} : champ inconnu.`);
  return textField(body, 'reason', 500, 'required')!;
}

@Controller('operators/:operator_id/media/:media_id')
export class BlacklistController {
  constructor(
    private readonly access: TenantAccess,
    private readonly blacklists: BlacklistService,
    private readonly approvals: ApprovalService,
  ) {}

  @Post('blacklist')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  blacklist(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, [BLACKLIST_ROLE]);
    const id = requireUuid(mediaId);
    const reason = reasonOf(body);
    return tx.run(async (client) => this.blacklists.blacklist(client, actor, id, reason));
  }

  @Post('reinstatement')
  @Idempotent({ scope: 'bo:' })
  requestReinstatement(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('media_id') mediaId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, [BLACKLIST_ROLE]);
    const id = requireUuid(mediaId);
    const reason = reasonOf(body);
    return tx.run(async (client) => {
      // Portée et épisode de liste noire figés à la demande ; bracelet en liste noire et sans
      // autre demande en attente (BlacklistService.reinstatable).
      const { scope, blacklistHistoryId } = await this.blacklists.reinstatable(client, actor, id);
      const request = await this.approvals.request(
        client,
        actor.operatorId,
        {
          action: 'REINSTATE_MEDIA',
          targetId: id,
          payload: {
            media_id: id,
            reason,
            scope_type: scope.type,
            scope_id: scope.id,
            blacklist_history_id: blacklistHistoryId,
          },
        },
        { principal: actor.principal, audit: actor.audit },
      );
      return respondAccepted(res, request);
    });
  }
}
