// Recherches du personnel (contrat `searchMedia`, `getWalletOverview`, `searchCustomerByPhone`). Jeton du
// personnel seulement (garde d'authentification globale) ; rôles et portée contrôlés dans `SearchService`.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('media')
  media(@Req() req: Request, @Query() query: Record<string, unknown>) {
    return this.search.searchMedia(req, query);
  }

  @Get('wallets/:wallet_id')
  wallet(@Req() req: Request, @Param('wallet_id') walletId: string) {
    return this.search.walletOverview(req, walletId);
  }

  @Post('customers')
  @HttpCode(200)
  customers(@Req() req: Request, @Body() body: unknown) {
    return this.search.searchCustomer(req, body);
  }
}
