// Restitution (`POST /media/{id}/release`, contrat `releaseMedia`) et remise en stock d'un bracelet rendu d'un lot
// réattribuable (`POST /media/{id}/reassignment`, `reassignPoolMedia`) : routes de guichet (terminal ET personne),
// idempotentes par terminal. La lecture du bracelet est facultative à la restitution ; présentée, elle doit être celle
// de CE bracelet. `refund_deposit_by` et `settle_balance` (enchaînement du guichet, mission 9) sont refusés.
import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
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
import { CounterAccess, CounterAuth, counterScope, requireCashSession } from './counter-access';
import { counterRefusal, parseCashSessionId } from './lifecycle.dto';
import { ReleaseService } from './release.service';

const HEX32 = /^[0-9a-f]{64}$/;

@Controller('media/:media_id')
export class ReleaseController {
  constructor(
    private readonly counter: CounterAccess,
    private readonly releases: ReleaseService,
    private readonly taps: TapService,
  ) {}

  @Post('release')
  @HttpCode(200)
  @CounterAuth()
  @Idempotent({ scope: counterScope })
  async release(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @Body() raw: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const id = requireUuid(mediaId);
    const language = pickLanguage(req.header('Accept-Language'));
    const body = raw === undefined || raw === null || raw === '' ? {} : objectBody(raw);
    if ((body.refund_deposit_by ?? null) !== null || (body.settle_balance ?? null) !== null)
      throw counterRefusal('release.no_chaining', language);
    const tapId = intField(body, 'tap_id', 0, Number.MAX_SAFE_INTEGER, 'optional') ?? null;
    const tap: TapInput | null =
      body.tap === undefined || body.tap === null ? null : parseTap(body.tap);
    const cashSessionId = parseCashSessionId(body);
    try {
      return await tx.run(async (client) => {
        const actor = await this.counter.authorize(client, req);
        // Session indiquée : validée (session ouverte du terminal) et renvoyée ; la libération n'écrit aucune espèce.
        if (cashSessionId !== null) requireCashSession(actor, language, cashSessionId);
        const presented = tap
          ? await this.taps.registerOrRefuse(client, actor.device, tap)
          : tapId !== null
            ? await this.taps.byId(client, actor.device, tapId)
            : null;
        if (presented && presented.mediaId !== id)
          throw counterRefusal('return.wrong_media', language);
        const done = await this.releases.release(client, actor, id, language);
        return cashSessionId === null ? done : { ...done, cash_session_id: cashSessionId };
      });
    } catch (error) {
      return this.taps.settleRefusal(error, requestDevice(req), tap);
    }
  }

  @Post('reassignment')
  @HttpCode(200)
  @CounterAuth()
  @Idempotent({ scope: counterScope })
  reassign(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @Body() raw: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const id = requireUuid(mediaId);
    const language = pickLanguage(req.header('Accept-Language'));
    const body = objectBody(raw);
    const unknown = Object.keys(body).filter((key) => key !== 'new_token_hash');
    if (unknown.length > 0) throw invalid(`${unknown.join(', ')} : champ inconnu.`);
    if (typeof body.new_token_hash !== 'string' || !HEX32.test(body.new_token_hash))
      throw invalid('new_token_hash : 64 chiffres hexadécimaux en minuscules attendus.');
    const newTokenHash = Buffer.from(body.new_token_hash, 'hex');
    return tx.run(async (client) =>
      this.releases.reassign(
        client,
        await this.counter.authorize(client, req),
        id,
        newTokenHash,
        language,
      ),
    );
  }
}
