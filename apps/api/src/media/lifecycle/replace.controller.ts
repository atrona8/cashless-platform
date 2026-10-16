// `POST /media/{id}/replace` (contrat `replaceMedia`) : route de guichet (terminal ET personne), idempotente par
// terminal. Le bracelet neuf est présenté par sa lecture embarquée (`new_media_tap`) ; une lecture suspecte fait échouer
// le remplacement, mais ses effets de sécurité sont validés à part.
import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { requestDevice } from '../../device-identity/device-identity.port';
import { pickLanguage } from '../../http/language';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import { objectBody, requireUuid, textField } from '../../organization/platform/platform.dto';
import { parseTap } from '../taps/taps.dto';
import { TapService } from '../taps/tap.service';
import { CounterAccess, CounterAuth, counterScope } from './counter-access';
import { counterRefusal } from './lifecycle.dto';
import { ReplaceService } from './replace.service';

@Controller('media/:media_id/replace')
export class ReplaceController {
  constructor(
    private readonly counter: CounterAccess,
    private readonly replacements: ReplaceService,
    private readonly taps: TapService,
  ) {}

  @Post()
  @HttpCode(200)
  @CounterAuth()
  @Idempotent({ scope: counterScope })
  async replace(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @Body() raw: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const id = requireUuid(mediaId);
    const language = pickLanguage(req.header('Accept-Language'));
    const body = objectBody(raw);
    // `new_media_tap_id` est sans effet : un bracelet neuf n'a pas de lecture enregistrée.
    if (body.new_media_tap === undefined || body.new_media_tap === null)
      throw counterRefusal('replace.tap_required', language);
    const tap = parseTap(body.new_media_tap);
    const reason = textField(body, 'reason', 500, 'required')!;
    try {
      return await tx.run(async (client) =>
        this.replacements.replace(
          client,
          await this.counter.authorize(client, req),
          id,
          { tap, reason },
          language,
        ),
      );
    } catch (error) {
      return this.taps.settleRefusal(error, requestDevice(req), tap);
    }
  }
}
