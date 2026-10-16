// Caution au guichet (contrat `takeDeposit`, `refundDeposit`) : routes de guichet (terminal ET personne), idempotentes.
// Prise : la lecture du bracelet est facultative. Rendu : obligatoire — on ne rend pas une caution sans le bracelet.
// La lecture présentée doit être celle de CE bracelet ; elle est consommée par l'écriture quand il y en a une.
import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { TxClient } from '../../db/tenant-tx';
import { requestDevice } from '../../device-identity/device-identity.port';
import { ProblemException } from '../../errors/problem';
import { pickLanguage, type Language } from '../../http/language';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import { requireUuid } from '../../organization/platform/platform.dto';
import { TapService, type RegisteredTap } from '../taps/tap.service';
import { CounterAccess, CounterAuth, counterScope, type CounterActor } from './counter-access';
import { DepositService } from './deposit.service';
import { counterRefusal, parseDeposit, type DepositInput } from './lifecycle.dto';

@Controller('media/:media_id/deposit')
export class DepositController {
  constructor(
    private readonly counter: CounterAccess,
    private readonly deposits: DepositService,
    private readonly taps: TapService,
  ) {}

  @Post()
  @HttpCode(200)
  @CounterAuth()
  @Idempotent({ scope: counterScope })
  take(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    return this.run(req, requireUuid(mediaId), parseDeposit(body), tx, false);
  }

  @Post('refund')
  @HttpCode(200)
  @CounterAuth()
  @Idempotent({ scope: counterScope })
  refund(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    return this.run(req, requireUuid(mediaId), parseDeposit(body), tx, true);
  }

  private async run(
    req: Request,
    mediaId: string,
    input: DepositInput,
    tx: IdempotentTx,
    refund: boolean,
  ) {
    const language = pickLanguage(req.header('Accept-Language'));
    if (refund && input.tap === null && input.tapId === null)
      throw counterRefusal('deposit.tap_required', language);
    try {
      return await tx.run(async (client) => {
        const actor = await this.counter.authorize(client, req);
        await this.visible(client, actor, mediaId);
        const tap = await this.tap(client, actor, input, mediaId, language);
        const context = {
          operatorId: actor.operatorId,
          cashDeskCode: actor.cashDeskCode,
          deviceId: actor.device.deviceId,
          audit: actor.audit,
          language,
        };
        const occurredAt = input.tap?.occurredAt ?? new Date();
        const done = refund
          ? await this.deposits.refund(client, context, mediaId, input.payment, occurredAt)
          : await this.deposits.take(client, context, mediaId, input.payment, occurredAt);
        if (tap?.tapId && done.transactionId)
          await this.taps.consume(client, tap.tapId, done.transactionId);
        return done.state;
      });
    } catch (error) {
      return this.taps.settleRefusal(error, requestDevice(req), input.tap);
    }
  }

  /** Bracelet d'un lot de l'organisateur du terminal (404 sinon : il n'existe pas pour ce guichet). */
  private async visible(client: TxClient, actor: CounterActor, mediaId: string): Promise<void> {
    const { rows } = await client.query<{ organizer_id: string | null }>(
      'SELECT b.organizer_id FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id WHERE m.id = $1',
      [mediaId],
    );
    if (!rows[0] || rows[0].organizer_id !== actor.organizerId)
      throw new ProblemException('NOT_FOUND');
  }

  private async tap(
    client: TxClient,
    actor: CounterActor,
    input: DepositInput,
    mediaId: string,
    language: Language,
  ): Promise<RegisteredTap | null> {
    const tap = input.tap
      ? await this.taps.registerOrRefuse(client, actor.device, input.tap)
      : input.tapId !== null
        ? await this.taps.byId(client, actor.device, input.tapId)
        : null;
    if (tap && tap.mediaId !== mediaId) throw counterRefusal('deposit.wrong_media', language);
    return tap;
  }
}
