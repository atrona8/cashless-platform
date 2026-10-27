// `POST /payments/{transaction_id}/reversal` (`reversePayment` ; mission 5b, lot WP12, T055 à T057 ;
// contracts/payments.md). Module séparé de `payments/` (WP11) pour que les deux lots ne se marchent pas dessus.
//
// Garde exclusive « terminal ou personne » (WP08, A13) : certificat client ou en-tête `Signature` présent → les
// trois preuves du terminal, SANS repli ; sinon chemin de la personne (ADR-129, contrat `humanBearer`) : un
// SUPERVISOR ou ORGANIZER_ADMIN de l'événement de la vente (ADR-122) crée la demande `SALE_REVERSAL` (source
// BACKOFFICE) et reçoit `202` avec la demande, SANS aucune écriture au grand livre ; une seconde personne distincte
// l'approuve (`approveApprovalRequest`), ce qui exécute l'annulation (`sale-reversal-action.ts`).
//
// Terminal : `Idempotency-Key` = `<serial>:<seq>` (`<serial>` = celui du terminal authentifié, contrôlé avant toute
// écriture), `vendor_session_id` requis. Sans `X-Approval-Token` : le vendeur de la vente, dans la fenêtre. Avec le
// jeton d'un `SUPERVISOR` de l'événement de la vente : variante de la garde du jeton sur place (appelant terminal),
// qui lève les contrôles de vendeur et de fenêtre, pas ceux du terminal. Personne : `Idempotency-Key` = UUID libre.
// Décorateurs appliqués de bas en haut : garde de terminal ou de personne, puis garde du jeton (inactive pour la
// personne).
import { Body, Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  consumeDeviceOnsiteApproval,
  deviceOnsiteState,
  RequiresDeviceOnsiteApproval,
} from '../approval/onsite/device-onsite-approval';
import { AuditService } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { DeviceOrCallerAuth } from '../device-identity/device-or-caller.guard';
import { requestDevice, type DeviceRequest } from '../device-identity/device-identity.port';
import { respondAccepted } from '../approval/approval.service';
import { ProblemException } from '../errors/problem';
import { deviceScope, requestDeviceSeq } from '../idempotency/device-key';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { isUuid } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { parseReversalRequest } from './reversal.dto';
import { ReversalService } from './reversal.service';
import { SALE_REVERSAL_ROLES, SaleReversalActions } from './sale-reversal-action';

/** Portée du jeton sur place : l'événement de la VENTE (jamais celui du terminal) ; vente introuvable → 404. */
async function saleEvent(req: Request, client: TxClient) {
  const id = req.params.transaction_id;
  if (!isUuid(id)) throw new ProblemException('NOT_FOUND');
  const { rows } = await client.query<{ event_id: string | null }>(
    'SELECT event_id FROM journal_transaction WHERE id = $1',
    [id],
  );
  const eventId = rows[0]?.event_id;
  if (!eventId) throw new ProblemException('NOT_FOUND');
  return { type: 'EVENT', id: eventId } as const;
}

@Controller('payments')
export class ReversalsController {
  constructor(
    private readonly reversals: ReversalService,
    private readonly audit: AuditService,
    private readonly access: TenantAccess,
    private readonly saleReversals: SaleReversalActions,
  ) {}

  @Post(':transaction_id/reversal')
  @HttpCode(201)
  @RequiresDeviceOnsiteApproval({
    operationId: 'reversePayment',
    role: 'SUPERVISOR',
    scope: saleEvent,
  })
  @DeviceOrCallerAuth({ other: 'person' })
  @Idempotent({
    scope: (req) => ((req as DeviceRequest).device ? deviceScope(req) : 'bo:'),
    deviceSeq: 'when-device',
    keyUuid: 'without-device',
  })
  reverse(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('transaction_id') transactionId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    if (!(req as DeviceRequest).device) return this.request(req, res, transactionId, body, tx);
    return this.reversals.reverse(
      {
        device: requestDevice(req),
        seq: requestDeviceSeq(req),
        key: req.header('Idempotency-Key')!,
        transactionId,
        body,
        authorityEpoch: req.header('X-Authority-Epoch'),
        onsite: deviceOnsiteState(req),
        consume: (client, target) => consumeDeviceOnsiteApproval(client, req, this.audit, target),
      },
      tx,
    );
  }

  /** Chemin de la personne (ADR-129) : demande `SALE_REVERSAL` créée, `202`, rien au grand livre. */
  private request(
    req: Request,
    res: Response,
    transactionId: string,
    body: unknown,
    tx: IdempotentTx,
  ) {
    // Rôle tenu quelque part (403 sinon) ; le rôle sur l'événement de la VENTE est contrôlé par la demande.
    const actor = this.access.actor(req, SALE_REVERSAL_ROLES);
    const input = parseReversalRequest(body);
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.saleReversals.request(
          client,
          actor.operatorId,
          {
            transactionId,
            reason: input.reason,
            ...(input.comment ? { comment: input.comment } : {}),
          },
          { principal: actor.principal, audit: actor.audit },
        ),
      ),
    );
  }
}
