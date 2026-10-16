// `POST /media/{id}/cash-due-refunds` (contrat `refundCashDue`) : route de guichet (terminal ET personne), idempotente
// par terminal. Le bracelet est présenté (lecture `tap` ou `tap_id`, consommée par l'écriture). Le jeton d'approbation
// sur place n'est exigé qu'au-delà du maximum de l'événement : la garde vérifie un jeton présenté, le service décide
// s'il le faut et le consomme dans la transaction. `approved_by` d'un corps n'est jamais lu (ADR-74).
import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  consumeOnsiteApproval,
  RequiresOnsiteApproval,
  type OnsiteRequest,
} from '../../approval/onsite/onsite-approval';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { requestDevice } from '../../device-identity/device-identity.port';
import { pickLanguage } from '../../http/language';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import {
  intField,
  invalid,
  isUuid,
  objectBody,
  requireUuid,
} from '../../organization/platform/platform.dto';
import { parseTap, type TapInput } from '../taps/taps.dto';
import { TapService } from '../taps/tap.service';
import { CashDueService } from './cash-due.service';
import { CounterAccess, CounterAuth, counterScope } from './counter-access';
import { counterRefusal } from './lifecycle.dto';

@Controller('media/:media_id/cash-due-refunds')
export class CashDueController {
  constructor(
    private readonly counter: CounterAccess,
    private readonly cashDue: CashDueService,
    private readonly taps: TapService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(201)
  // Garde du jeton après celle du terminal (décorateurs appliqués de bas en haut) : la portée est l'événement du terminal.
  @RequiresOnsiteApproval({
    operationId: 'refundCashDue',
    role: 'SUPERVISOR',
    optional: true,
    scope: (req) => ({ type: 'EVENT', id: requestDevice(req).eventId ?? '' }),
  })
  @CounterAuth()
  @Idempotent({ scope: counterScope })
  async refund(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @Body() raw: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const id = requireUuid(mediaId);
    const language = pickLanguage(req.header('Accept-Language'));
    const body = objectBody(raw);
    const tapId = intField(body, 'tap_id', 0, Number.MAX_SAFE_INTEGER, 'optional') ?? null;
    const tap: TapInput | null =
      body.tap === undefined || body.tap === null ? null : parseTap(body.tap);
    if ((tap === null) === (tapId === null))
      throw invalid('tap ou tap_id : exactement une lecture du bracelet attendue.');
    if (body.cash_session_id !== undefined && body.cash_session_id !== null) {
      if (!isUuid(body.cash_session_id)) throw invalid('cash_session_id : identifiant attendu.');
      throw counterRefusal('cash_due.no_session', language, 'CONFLICT_STATE', 409);
    }
    const approve = (req as OnsiteRequest).onsiteApproval
      ? (client: TxClient) => consumeOnsiteApproval(client, req, this.audit)
      : null;
    try {
      return await tx.run(async (txClient) => {
        const actor = await this.counter.authorize(txClient, req);
        const presented = tap
          ? await this.taps.registerOrRefuse(txClient, actor.device, tap)
          : await this.taps.byId(txClient, actor.device, tapId!);
        if (presented.mediaId !== id) throw counterRefusal('return.wrong_media', language);
        const done = await this.cashDue.refund(
          txClient,
          actor,
          id,
          { idempotencyKey: req.header('Idempotency-Key')!, approve },
          language,
        );
        if (presented.tapId) await this.taps.consume(txClient, presented.tapId, done.transactionId);
        return done.result;
      });
    } catch (error) {
      return this.taps.settleRefusal(error, requestDevice(req), tap);
    }
  }
}
