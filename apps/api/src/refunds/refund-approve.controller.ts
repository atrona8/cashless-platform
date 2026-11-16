// `POST /refund-requests/{id}/approve` (`approveRefundRequest`) et `POST /refund-requests/{id}/confirm`
// (`confirmRefundRequest`) — mission 9a, WP05. Back-office, rôle `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` (décision 7),
// portée de l'événement contrôlée par les services. Clé d'idempotence `bo:`. Modèle : `reversals.controller.ts`.
import { Body, Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { respondAccepted } from '../approval/approval.service';
import { ProblemException } from '../errors/problem';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { isUuid, objectBody } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { parseConfirmBody, RefundConfirmService } from './refund-confirm.service';
import { NOTE_MAX, WALLET_REFUND_ROLES, WalletRefundActions } from './wallet-refund-action';

const invalid = (detail: string) =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });

function parseApproveBody(raw: unknown): { note?: string } {
  if (raw === undefined || raw === null) return {};
  const body = objectBody(raw);
  const unknown = Object.keys(body).filter((k) => k !== 'note');
  if (unknown.length > 0) throw invalid(`corps : champ inconnu (${unknown.join(', ')}).`);
  if (body.note === undefined) return {};
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length === 0 || note.length > NOTE_MAX)
    throw invalid(`note : texte de 1 à ${NOTE_MAX} caractères attendu.`);
  return { note };
}

@Controller('refund-requests')
export class RefundApproveController {
  constructor(
    private readonly access: TenantAccess,
    private readonly actions: WalletRefundActions,
    private readonly confirmation: RefundConfirmService,
  ) {}

  @Post(':refund_request_id/approve')
  @Idempotent({ scope: 'bo:' })
  approve(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('refund_request_id') id: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WALLET_REFUND_ROLES);
    const { note } = parseApproveBody(body);
    if (!isUuid(id)) throw new ProblemException('NOT_FOUND');
    const key = req.header('Idempotency-Key')!;
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.actions.request(client, actor, {
          refundRequestId: id,
          idempotencyKey: key,
          ...(note !== undefined ? { note } : {}),
        }),
      ),
    );
  }

  @Post(':refund_request_id/confirm')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  confirm(
    @Req() req: Request,
    @Param('refund_request_id') id: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WALLET_REFUND_ROLES);
    const input = parseConfirmBody(body);
    if (!isUuid(id)) throw new ProblemException('NOT_FOUND');
    const key = req.header('Idempotency-Key')!;
    return tx.run((client) => this.confirmation.confirm(client, actor, id, input, key));
  }
}
