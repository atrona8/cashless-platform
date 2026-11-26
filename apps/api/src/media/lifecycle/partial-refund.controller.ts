// Rendu partiel en espèces (`POST /media/{id}/partial-cash-refunds`, contrat `refundPartialCash`) : route de guichet
// (terminal ET personne), idempotente par terminal, mêmes décorateurs que la restitution. Le passage est obligatoire :
// `tap_id` OU `tap`, exactement un (sinon 400) ; il doit être celui de CE bracelet. Le jeton d'approbation sur place
// n'est exigé qu'au-delà du maximum de l'événement, sur le cumul du jour du portefeuille : la garde vérifie un jeton
// présenté, le service décide s'il le faut et le consomme dans la transaction.
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
  objectBody,
  requireUuid,
} from '../../organization/platform/platform.dto';
import { parseTap, type TapInput } from '../taps/taps.dto';
import { TapService } from '../taps/tap.service';
import { CounterAccess, CounterAuth, counterScope } from './counter-access';
import { counterRefusal } from './lifecycle.dto';
import { PartialRefundService } from './partial-refund.service';

@Controller('media/:media_id')
export class PartialRefundController {
  constructor(
    private readonly counter: CounterAccess,
    private readonly refunds: PartialRefundService,
    private readonly taps: TapService,
    private readonly audit: AuditService,
  ) {}

  @Post('partial-cash-refunds')
  @HttpCode(201)
  // Garde du jeton après celle du terminal (décorateurs appliqués de bas en haut) : portée = événement du terminal.
  @RequiresOnsiteApproval({
    operationId: 'refundPartialCash',
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
    const unknown = Object.keys(body).filter((key) => !['amount', 'tap_id', 'tap'].includes(key));
    if (unknown.length > 0) throw invalid(`${unknown.join(', ')} : champ inconnu.`);
    const amount = intField(
      body,
      'amount',
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      'required',
    );
    const tapId = intField(body, 'tap_id', 0, Number.MAX_SAFE_INTEGER, 'optional');
    const hasTap = body.tap !== undefined && body.tap !== null;
    if ((tapId === undefined) === !hasTap)
      throw invalid('tap_id ou tap : exactement un des deux est obligatoire.');
    const tap: TapInput | null = hasTap ? parseTap(body.tap) : null;
    const key = req.header('Idempotency-Key') ?? '';
    const approve = (req as OnsiteRequest).onsiteApproval
      ? (client: TxClient) => consumeOnsiteApproval(client, req, this.audit)
      : null;
    try {
      return await tx.run(async (client) => {
        const actor = await this.counter.authorize(client, req);
        const presented = tap
          ? await this.taps.registerOrRefuse(client, actor.device, tap)
          : await this.taps.byId(client, actor.device, tapId!);
        if (presented && presented.mediaId !== id)
          throw counterRefusal('return.wrong_media', language);
        return this.refunds.refund(client, actor, id, BigInt(amount!), key, language, approve);
      });
    } catch (error) {
      return this.taps.settleRefusal(error, requestDevice(req), tap);
    }
  }
}
