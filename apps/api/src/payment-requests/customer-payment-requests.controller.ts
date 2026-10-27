// Routes du festivalier pour les demandes de paiement QR (mission 5b, lot WP13, T062 et T063 ; FR-018, FR-019,
// FR-020 ; contracts/qr-payments.md). Derrière le port d'identité du festivalier (`@CustomerAuth()`) : seul le
// faux existe, refusé en production (`createCustomerIdentity`) ; utilisable en production avec la mission 10.
//   `POST /payment-requests/{id}/pay` (`payPaymentRequest`) : idempotente par compte, la réponse ne porte aucun
//   jeton ;
//   `POST /me/customer-qr-tokens` (`createCustomerQrToken`) : `transient`, jeton rendu une seule fois.
// Écart déjà signalé, non tranché ici : `humanBearer` au contrat contre `CustomerAuth` (comme `claimMedia`, R-08).
import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerAuth } from '../customer-identity/customer.guard';
import { requestCustomer } from '../customer-identity/customer-identity.port';
import { pickLanguage } from '../http/language';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { ProblemException } from '../errors/problem';
import { isUuid } from '../organization/platform/platform.dto';
import { PaymentRequestService } from './payment-request.service';

/** Portée d'idempotence de l'app festivalier : le compte. */
const customerScope = (req: Request): string => `app:${requestCustomer(req).customerId}:`;

@Controller()
export class CustomerPaymentRequestsController {
  constructor(private readonly requests: PaymentRequestService) {}

  @Post('payment-requests/:payment_request_id/pay')
  @HttpCode(200)
  @CustomerAuth()
  @Idempotent({ scope: customerScope })
  pay(
    @Req() req: Request,
    @Param('payment_request_id') paymentRequestId: string,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    // Identifiant mal formé : le même refus que toute demande inconnue (le contrat n'a pas de 404 ici, FR-020).
    if (!isUuid(paymentRequestId)) throw new ProblemException('PAYMENT_REQUEST_NOT_PENDING');
    return this.requests.pay(
      requestCustomer(req),
      paymentRequestId,
      req.body as unknown,
      pickLanguage(req.header('Accept-Language')),
      tx,
    );
  }

  @Post('me/customer-qr-tokens')
  @CustomerAuth()
  // `transient` (A3) : le jeton n'est rendu qu'une fois et n'est écrit dans aucune réponse d'idempotence.
  @Idempotent({ scope: customerScope, transient: true })
  createToken(@Req() req: Request, @IdempotentTransaction() tx: IdempotentTx) {
    return this.requests.createCustomerQr(requestCustomer(req), req.body as unknown, tx);
  }
}
