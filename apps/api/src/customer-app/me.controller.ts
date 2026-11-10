// Routes de l'app festivalier : `GET /me`, `/me/wallets`, `/me/wallets/{wallet_id}/transactions`, `/me/media` et
// `POST /me/media/{media_id}/report-lost` (contrat `openapi.yaml`, inchangé). Derrière le port d'identité du festivalier (`@CustomerAuth()`),
// comme `claimMedia` : jeton d'accès Bearer, et en-têtes de test hors production seulement (OP-N43) ; le contrat
// déclare `humanBearer` : le jeton de compte est émis par `/customer-auth/*`.
import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerAuth } from '../customer-identity/customer.guard';
import { requestCustomer } from '../customer-identity/customer-identity.port';
import { requestIdOf } from '../http/request-id.middleware';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { ProblemException } from '../errors/problem';
import { LostMediaService } from './lost-media.service';
import { MeService, type MovementCursor } from './me.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (detail: string) =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });

export function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 50;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw invalid('limit : entier de 1 à 200 attendu.');
  return limit;
}

export function parseMovementCursor(raw: string | undefined): MovementCursor | null {
  if (raw === undefined || raw === '') return null;
  if (raw.length > 512) throw invalid('cursor : curseur invalide.');
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const t = value.t;
    const i = value.i;
    if (
      typeof t === 'string' &&
      !Number.isNaN(Date.parse(t)) &&
      typeof i === 'string' &&
      UUID.test(i)
    )
      return { t: new Date(t).toISOString(), i };
  } catch {
    // illisible : refusé ci-dessous
  }
  throw invalid('cursor : curseur invalide.');
}

@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly lostMedia: LostMediaService,
  ) {}

  @Get()
  @CustomerAuth()
  profile(@Req() req: Request) {
    return this.me.profile(requestCustomer(req));
  }

  @Get('wallets')
  @CustomerAuth()
  wallets(@Req() req: Request) {
    return this.me.wallets(requestCustomer(req));
  }

  @Get('wallets/:wallet_id/transactions')
  @CustomerAuth()
  transactions(
    @Req() req: Request,
    @Param('wallet_id') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    // Identifiant mal formé : même réponse qu'un portefeuille inconnu ou d'un autre compte.
    if (!UUID.test(walletId)) throw new ProblemException('NOT_FOUND');
    return this.me.transactions(requestCustomer(req), walletId, {
      limit: parseLimit(limit),
      after: parseMovementCursor(cursor),
    });
  }

  @Get('media')
  @CustomerAuth()
  media(@Req() req: Request) {
    return this.me.media(requestCustomer(req));
  }

  @Post('media/:media_id/report-lost')
  @HttpCode(200)
  @CustomerAuth()
  @Idempotent({ scope: (req: Request) => `app:${requestCustomer(req).customerId}:` })
  reportLost(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const customer = requestCustomer(req);
    // Identifiant mal formé : même réponse qu'un bracelet inconnu ou d'un autre compte.
    if (!UUID.test(mediaId)) throw new ProblemException('NOT_FOUND');
    const context = {
      actorId: customer.customerId,
      actorRole: 'CUSTOMER',
      origin: `app:${customer.deviceRef}`,
      requestId: requestIdOf(req) || null,
    };
    return tx.run((client) => this.lostMedia.reportLost(client, customer, mediaId, context));
  }
}
