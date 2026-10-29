// `POST /topups/psp` (`initiatePspTopup`), `GET /topups/psp/{topup_id}` (`getPspTopup`) et
// `POST /topups/psp/{topup_id}/cancel` (`cancelPspTopup`) : lot WP11, T054 et T055.
//
// Les écritures déclarent `@Idempotent({ writes: false })` : la première transaction (préparation) et l'appel
// au PSP se font hors de l'`IdempotentTx` (dans le service, jamais un appel réseau sous transaction) ; la DERNIÈRE
// transaction (référence du PSP, ou annulation) est l'`IdempotentTx` de la route, qui y enregistre la réponse
// (RISK-2 : le contrôleur n'injecte pas `TenantTx`, le garde de test/unit/idempotency-guard.spec.ts tient). Une
// réponse rendue sans cette dernière transaction (rejeu, annulation déjà faite) est enregistrée seule. Une reprise de la même clé ne crée pas deux recharges : l'identifiant de la recharge est déterministe.
import { Controller, Get, HttpCode, Param, Post, Req, Body } from '@nestjs/common';
import type { Request } from 'express';
import { requestCustomer } from '../../customer-identity/customer-identity.port';
import type { DeviceRequest } from '../../device-identity/device-identity.port';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
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
  initiate(
    @Req() req: Request,
    @Body() body: unknown,
    @IdempotentTransaction() idem: IdempotentTx,
  ) {
    return this.topups.request(req, body, pspTopupScope(req), req.header('Idempotency-Key')!, idem);
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
  cancel(
    @Req() req: Request,
    @Param('topup_id') topupId: string,
    @IdempotentTransaction() idem: IdempotentTx,
  ) {
    return this.topups.cancel(req, topupId, idem);
  }
}
