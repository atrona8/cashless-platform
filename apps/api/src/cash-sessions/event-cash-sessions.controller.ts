// `GET /events/{event_id}/cash-sessions` (`listCashSessions`, mission 6, lot WP08, T040) : `humanBearer` seul,
// `SUPERVISOR` ou `ORGANIZER_ADMIN` de l'événement. Pagination par curseur, tri `opened_at` décroissant puis identifiant.
import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TenantTx } from '../db/tenant-tx';
import { requestPrincipal } from '../identity/principal';
import { pageRequest } from '../organization/platform/platform.dto';
import { TENANT_CONTEXT, type TenantContextProvider } from '../tenancy/tenant-context';
import { CashSessionReadService } from './cash-session-read.service';
import { parseListStatus } from './cash-sessions.dto';

@Controller('events/:event_id/cash-sessions')
export class EventCashSessionsController {
  constructor(
    private readonly reads: CashSessionReadService,
    private readonly tx: TenantTx,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
  ) {}

  @Get()
  list(
    @Req() req: Request,
    @Param('event_id') eventId: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const principal = requestPrincipal(req);
    const filter = parseListStatus(status);
    const page = pageRequest(cursor, limit);
    const { operatorId } = this.tenant.current(req);
    return this.tx.run(operatorId, (client) =>
      this.reads.list(client, principal, eventId, filter, page),
    );
  }
}
