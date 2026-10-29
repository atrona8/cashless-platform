// `POST /topups/psp` (`initiatePspTopup`), `GET /topups/psp/{topup_id}` (`getPspTopup`) et
// `POST /topups/psp/{topup_id}/cancel` (`cancelPspTopup`) : lot WP11, T054 et T055.
//
// Les écritures déclarent `@Idempotent({ writes: false })` et enchaînent leurs transactions elles-mêmes : la
// réponse (qui porte l'adresse de paiement obtenue APRÈS le COMMIT de la première) est enregistrée seule, à la
// fin. Une reprise de la même clé ne crée pas deux recharges : l'identifiant de la recharge est déterministe.
import { Controller, Get, HttpCode, Param, Post, Req, Body } from '@nestjs/common';
import type { Request } from 'express';
import { requestCustomer } from '../../customer-identity/customer-identity.port';
import type { DeviceRequest } from '../../device-identity/device-identity.port';
import { Idempotent } from '../../idempotency/idempotent.decorator';
import { counterScope } from '../../media/lifecycle/counter-access';
import { PspTopupCallerAuth } from './psp-topup-caller.guard';
import { PspTopupsService } from './psp-topups.service';

/** Portée d'idempotence : le terminal (clé `<série>:<seq>`) ou le compte du festivalier. */
export const pspTopupScope = (req: Request): string =>
  (req as DeviceRequest).device !== undefined
    ? counterScope(req)
    : `app:${requestCustomer(req).customerId}:`;

const IDEMPOTENT_WRITE = {
  scope: pspTopupScope,
  writes: false,
  deviceSeq: 'when-device',
  keyUuid: 'without-device',
} as const;

@Controller('topups/psp')
export class PspTopupsController {
  constructor(private readonly topups: PspTopupsService) {}

  @Post()
  @HttpCode(201)
  @PspTopupCallerAuth({ allowPerson: false })
  @Idempotent(IDEMPOTENT_WRITE)
  initiate(@Req() req: Request, @Body() body: unknown) {
    return this.topups.request(req, body, pspTopupScope(req), req.header('Idempotency-Key')!);
  }

  @Get(':topup_id')
  @PspTopupCallerAuth({ allowPerson: true })
  get(@Req() req: Request, @Param('topup_id') topupId: string) {
    return this.topups.get(req, topupId);
  }

  @Post(':topup_id/cancel')
  @HttpCode(200)
  @PspTopupCallerAuth({ allowPerson: false })
  @Idempotent(IDEMPOTENT_WRITE)
  cancel(@Req() req: Request, @Param('topup_id') topupId: string) {
    return this.topups.cancel(req, topupId);
  }
}
