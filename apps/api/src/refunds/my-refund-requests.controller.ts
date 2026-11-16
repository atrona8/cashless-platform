// `POST /me/refund-requests` et `GET /me/refund-requests` (contrat `createMyRefundRequest`, `listMyRefundRequests`,
// mission 9a, WP04). Garde festivalier ; clé d'idempotence de portée `app:<compte>:`, comme `reportMyMediaLost`.
import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { parseLimit, parseMovementCursor } from '../customer-app/me.controller';
import { requestCustomer } from '../customer-identity/customer-identity.port';
import { CustomerAuth } from '../customer-identity/customer.guard';
import { requestIdOf } from '../http/request-id.middleware';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { parseRefundRequestCreate } from './refund-requests.dto';
import { RefundRequestsService } from './refund-requests.service';

@Controller('me/refund-requests')
export class MyRefundRequestsController {
  constructor(private readonly refunds: RefundRequestsService) {}

  @Post()
  @HttpCode(201)
  @CustomerAuth()
  @Idempotent({ scope: (req: Request) => `app:${requestCustomer(req).customerId}:` })
  create(@Req() req: Request, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const customer = requestCustomer(req);
    const input = parseRefundRequestCreate(body);
    const context = {
      actorId: customer.customerId,
      actorRole: 'CUSTOMER',
      origin: `app:${customer.deviceRef}`,
      requestId: requestIdOf(req) || null,
    };
    return tx.run((client) => this.refunds.create(client, customer, input, context));
  }

  @Get()
  @CustomerAuth()
  list(@Req() req: Request, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.refunds.listMine(requestCustomer(req), {
      limit: parseLimit(limit),
      after: parseMovementCursor(cursor),
    });
  }
}
