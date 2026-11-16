// `GET /refund-requests` et `POST /refund-requests/{id}/reject` (contrat `listRefundRequests`, `rejectRefundRequest`,
// mission 9a, WP04) : back-office, rôle `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` (décision 7), portée de l'événement
// contrôlée par le service. Clé d'idempotence `bo:`.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { parseLimit, parseMovementCursor } from '../customer-app/me.controller';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { isUuid } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { ProblemException } from '../errors/problem';
import { parseEventFilter, parseRejectBody, parseStatusFilter } from './refund-requests.dto';
import { REFUND_BACKOFFICE_ROLES, RefundRequestsService } from './refund-requests.service';

@Controller('refund-requests')
export class RefundRequestsController {
  constructor(
    private readonly access: TenantAccess,
    private readonly refunds: RefundRequestsService,
  ) {}

  @Get()
  list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('event_id') eventId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, REFUND_BACKOFFICE_ROLES);
    const filters = { status: parseStatusFilter(status), eventId: parseEventFilter(eventId) };
    const page = { limit: parseLimit(limit), after: parseMovementCursor(cursor) };
    return this.access.read(actor, (client) =>
      this.refunds.listBackOffice(client, actor, filters, page),
    );
  }

  @Post(':refund_request_id/reject')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  reject(
    @Req() req: Request,
    @Param('refund_request_id') id: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, REFUND_BACKOFFICE_ROLES);
    const { reason } = parseRejectBody(body);
    if (!isUuid(id)) throw new ProblemException('NOT_FOUND');
    return tx.run((client) => this.refunds.reject(client, actor, id, reason));
  }
}
