// `POST /media/activations` (contrat `activateMedia`) : route de guichet (terminal ET personne), idempotente par
// terminal. Une lecture suspecte fait échouer l'activation, mais ses effets de sécurité sont validés à part.
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { requestDevice } from '../../device-identity/device-identity.port';
import { pickLanguage } from '../../http/language';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import { TapService } from '../taps/tap.service';
import { ActivationService } from './activation.service';
import { CounterAccess, CounterAuth, counterScope } from './counter-access';
import { counterRefusal, parseActivation } from './lifecycle.dto';

@Controller('media/activations')
export class ActivationController {
  constructor(
    private readonly counter: CounterAccess,
    private readonly activation: ActivationService,
    private readonly taps: TapService,
  ) {}

  @Post()
  @HttpCode(201)
  @CounterAuth()
  @Idempotent({ scope: counterScope })
  async activate(
    @Req() req: Request,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const input = parseActivation(body);
    const language = pickLanguage(req.header('Accept-Language'));
    const tap = input.tap;
    if (!tap) throw counterRefusal('activation.tap_required', language);
    try {
      return await tx.run(async (client) =>
        this.activation.activate(
          client,
          await this.counter.authorize(client, req),
          { ...input, tap },
          language,
        ),
      );
    } catch (error) {
      return this.taps.settleRefusal(error, requestDevice(req), tap);
    }
  }
}
