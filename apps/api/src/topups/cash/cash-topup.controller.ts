// `POST /topups/cash` (`createCashTopup`, lot WP09, T044 et T046) : terminal `TOPUP_DESK` ET personne
// `CASHIER`/`SUPERVISOR` (`X-Staff-Authorization`), clé `<série>:<seq>` contrôlée avant la réservation.
// La caution due est prise APRÈS la validation du crédit, dans une transaction distincte (`afterCredit`).
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { requestDevice } from '../../device-identity/device-identity.port';
import { pickLanguage } from '../../http/language';
import { deviceScope, requestDeviceSeq } from '../../idempotency/device-key';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import { CounterAuth } from '../../media/lifecycle/counter-access';
import { CashTopupService } from './cash-topup.service';

@Controller('topups/cash')
export class CashTopupController {
  constructor(private readonly topups: CashTopupService) {}

  @Post()
  @HttpCode(201)
  @CounterAuth()
  @Idempotent({ scope: deviceScope, deviceSeq: true })
  async create(
    @Req() req: Request,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const done = await this.topups.create(
      {
        req,
        device: requestDevice(req),
        seq: requestDeviceSeq(req),
        key: req.header('Idempotency-Key')!,
        body,
        language: pickLanguage(req.header('Accept-Language')),
      },
      tx,
    );
    // Crédit validé (COMMIT fait par `tx.run`) : la caution due se prend maintenant, ailleurs.
    await this.topups.afterCredit(done.operatorId, done.mediaId, done.audit);
    return done.result;
  }
}
