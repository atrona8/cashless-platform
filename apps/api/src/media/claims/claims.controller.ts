// Routes du rattachement par code :
//   `POST /me/media` (`claimMedia`) : app festivalier, idempotente par compte ;
//   `POST /media/claims/confirmations` (`confirmMediaClaim`) : guichet (terminal ET personne),
//   idempotente par terminal ;
//   `POST /public/balance-lookups` (`lookupBalanceByClaimCode`) : publique, sans identité ni
//   idempotence (lecture).
// `listMyMedia` et `reportMyMediaLost` relèvent de la mission de l'app festivalier (choix du
// porteur du 13/10/2026).
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CustomerAuth } from '../../customer-identity/customer.guard';
import { requestCustomer } from '../../customer-identity/customer-identity.port';
import { pickLanguage } from '../../http/language';
import { requestIdOf } from '../../http/request-id.middleware';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import { Public } from '../../identity/public.decorator';
import { objectBody } from '../../organization/platform/platform.dto';
import { CounterAccess, CounterAuth, counterScope } from '../lifecycle/counter-access';
import { claimCodeField, parseClaim, parseConfirm } from './claims.dto';
import { ClaimsService } from './claims.service';

/** Portée d'idempotence de l'app festivalier : le compte. */
const customerScope = (req: Request): string => `app:${requestCustomer(req).customerId}:`;

@Controller()
export class ClaimsController {
  constructor(
    private readonly counter: CounterAccess,
    private readonly claims: ClaimsService,
  ) {}

  @Post('me/media')
  @HttpCode(201)
  @CustomerAuth()
  // `transient` : la réponse 202 porte le code de confirmation, rendu une fois et jamais conservé
  // (WP17 : aucun code en clair au repos). Un renvoi de la même clé reçoit 409, pas la réponse.
  @Idempotent({ scope: customerScope, transient: true })
  claim(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const input = parseClaim(body);
    const customer = requestCustomer(req);
    const language = pickLanguage(req.header('Accept-Language'));
    const audit = {
      actorId: customer.customerId,
      actorRole: 'CUSTOMER',
      origin: `app:${customer.deviceRef}`,
      requestId: requestIdOf(req) || null,
    };
    return tx.run(async (client) => {
      const result = await this.claims.claim(client, customer, input, audit, language);
      if (result.kind === 'ATTACHED') return result.media;
      res.status(202);
      const { kind: _kind, ...pending } = result;
      return pending;
    });
  }

  @Post('media/claims/confirmations')
  @HttpCode(200)
  @CounterAuth()
  @Idempotent({ scope: counterScope })
  confirm(@Req() req: Request, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const input = parseConfirm(body);
    return tx.run(async (client) =>
      this.claims.confirm(client, await this.counter.authorize(client, req), input),
    );
  }

  @Post('public/balance-lookups')
  @HttpCode(200)
  @Public()
  lookup(@Req() req: Request, @Body() body: unknown) {
    // Limite par adresse (contrat : 60 par adresse IP et par heure) ; l'agent utilisateur,
    // librement modifiable, n'entre pas dans la référence.
    return this.claims.lookup(claimCodeField(objectBody(body)), req.ip ?? 'inconnue');
  }
}
