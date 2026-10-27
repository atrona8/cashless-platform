// `POST /payments` (`createPayment`) et `GET /payments/{transaction_id}` (`getPayment`) (mission 5b, lot
// WP11, T048 et T053 ; contracts/payments.md).
//
// `createPayment` : trois preuves du terminal (`@DeviceAuth()`, pas `nfcOnly` : le QR client est permis à un
// iOS ; le moyen par bracelet est refusé par le service sur un terminal non Android ou au NFC coupé), clé
// d'idempotence `<serial>:<seq>` (portée du terminal, `<serial>` contrôlé avant toute écriture). Aucun
// verrou de requête : le terminal est pris FOR UPDATE par la transaction elle-même.
// `getPayment` : garde exclusive « terminal ou personne » (A13), sans repli d'un chemin vers l'autre.
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DeviceOrCallerAuth } from '../device-identity/device-or-caller.guard';
import { DeviceAuth } from '../device-identity/device.guard';
import { requestDevice, type DeviceRequest } from '../device-identity/device-identity.port';
import { pickLanguage } from '../http/language';
import { deviceScope, requestDeviceSeq } from '../idempotency/device-key';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { requestPrincipal } from '../identity/principal';
import { requireUuid } from '../organization/platform/platform.dto';
import { PaymentReadService } from './payment-read.service';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly reads: PaymentReadService,
  ) {}

  @Post()
  @DeviceAuth()
  @Idempotent({ scope: deviceScope, deviceSeq: true })
  create(@Req() req: Request, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    return this.payments.create(
      {
        device: requestDevice(req),
        seq: requestDeviceSeq(req),
        key: req.header('Idempotency-Key')!,
        body,
        language: pickLanguage(req.header('Accept-Language')),
        authorityEpoch: req.header('X-Authority-Epoch'),
      },
      tx,
    );
  }

  @Get(':transaction_id')
  @DeviceOrCallerAuth({ other: 'person' })
  get(@Req() req: Request, @Param('transaction_id') transactionId: string) {
    const id = requireUuid(transactionId);
    const language = pickLanguage(req.header('Accept-Language'));
    // Chemin décidé par la garde exclusive : un terminal prouvé, sinon une personne authentifiée.
    const device = (req as DeviceRequest).device;
    return device
      ? this.reads.getForDevice(device, id, language)
      : this.reads.getForPerson(requestPrincipal(req), id, language);
  }
}
