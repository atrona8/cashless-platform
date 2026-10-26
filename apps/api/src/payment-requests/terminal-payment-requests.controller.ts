// Routes du QR commerçant côté terminal (mission 5b, lot WP13, T061 ; FR-018 ; contracts/qr-payments.md) :
//   `POST /payment-requests` (`createPaymentRequest`) : trois preuves, clé `<serial>:<seq>`, réponse non conservée ;
//   `GET /payment-requests/{id}` (`getPaymentRequest`) et `POST /payment-requests/{id}/cancel`
//   (`cancelPaymentRequest`) : garde exclusive « terminal ou festivalier » (A13). Preuves de terminal présentes →
//   chemin terminal complet, SANS repli ; sinon chemin du festivalier seul (jeton de la demande en en-tête
//   `X-Payment-Request-Token`, jamais en chaîne de requête).
import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { requestCustomer } from '../customer-identity/customer-identity.port';
import { DeviceOrCallerAuth } from '../device-identity/device-or-caller.guard';
import { DeviceAuth } from '../device-identity/device.guard';
import { requestDevice, type DeviceRequest } from '../device-identity/device-identity.port';
import { deviceScope, requestDeviceSeq } from '../idempotency/device-key';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { requireUuid } from '../organization/platform/platform.dto';
import { parseWait, tokenHeader } from './payment-request.dto';
import { PaymentRequestService } from './payment-request.service';

/** Portée d'idempotence de l'annulation : le terminal prouvé, sinon le compte du festivalier. */
const cancelScope = (req: Request): string =>
  (req as DeviceRequest).device !== undefined
    ? deviceScope(req)
    : `app:${requestCustomer(req).customerId}:`;

const TOKEN_HEADER = 'X-Payment-Request-Token';

@Controller('payment-requests')
export class TerminalPaymentRequestsController {
  constructor(private readonly requests: PaymentRequestService) {}

  @Post()
  @DeviceAuth()
  // `transient` (A3) : le jeton n'est rendu qu'une fois et n'est écrit dans aucune réponse d'idempotence ;
  // un renvoi de la même clé reçoit `409`, le terminal crée une nouvelle demande.
  @Idempotent({ scope: deviceScope, deviceSeq: true, transient: true })
  create(@Req() req: Request, @IdempotentTransaction() tx: IdempotentTx) {
    return this.requests.createMerchantRequest(
      {
        device: requestDevice(req),
        seq: requestDeviceSeq(req),
        key: req.header('Idempotency-Key')!,
        body: req.body as unknown,
      },
      tx,
    );
  }

  @Get(':payment_request_id')
  @DeviceOrCallerAuth({ other: 'customer' })
  get(
    @Req() req: Request,
    @Param('payment_request_id') paymentRequestId: string,
    @Query('wait') wait?: string,
  ) {
    const id = requireUuid(paymentRequestId);
    // Chemin décidé par la garde exclusive : un terminal prouvé, sinon un festivalier authentifié.
    const device = (req as DeviceRequest).device;
    if (device) return this.requests.getForDevice(device, id, parseWait(wait));
    return this.requests.getForCustomer(
      requestCustomer(req),
      id,
      tokenHeader(req.header(TOKEN_HEADER)),
    );
  }

  @Post(':payment_request_id/cancel')
  @HttpCode(200)
  @DeviceOrCallerAuth({ other: 'customer' })
  @Idempotent({ scope: cancelScope, deviceSeq: 'when-device' })
  cancel(
    @Req() req: Request,
    @Param('payment_request_id') paymentRequestId: string,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const id = requireUuid(paymentRequestId);
    const device = (req as DeviceRequest).device;
    if (device)
      return this.requests.cancelForDevice({ device, seq: requestDeviceSeq(req), id }, tx);
    return this.requests.cancelForCustomer(id, tokenHeader(req.header(TOKEN_HEADER)), tx);
  }
}
