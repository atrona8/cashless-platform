// `GET /events/{event_id}/sales` (`listEventSales`) et `GET /sales/{transaction_id}` (`getSale`) : lecture des
// ventes pour le back-office (mission routes-backoffice 11b, WP06). Jeton du personnel seul (garde globale) ;
// rôles et portée contrôlés par `SalesService` (portée dans la requête SQL). Lecture seule : aucune ligne d'audit.
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { SaleQuery } from './sales.dto';
import { SalesService } from './sales.service';

@Controller()
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('events/:event_id/sales')
  list(@Req() req: Request, @Param('event_id') eventId: string, @Query() query: SaleQuery) {
    return this.sales.list(req, eventId, query);
  }

  @Get('sales/:transaction_id')
  get(@Req() req: Request, @Param('transaction_id') transactionId: string) {
    return this.sales.get(req, transactionId);
  }
}
