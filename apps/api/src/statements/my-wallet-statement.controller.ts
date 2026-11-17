// Route 17 `getMyWalletStatement` : relevé CSV du portefeuille du festivalier authentifié (mission 9b, WP13). Même
// garde que les autres routes `/me` (`@CustomerAuth()`) ; la route JSON `listMyWalletTransactions` reste inchangée.
import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestCustomer } from '../customer-identity/customer-identity.port';
import { CustomerAuth } from '../customer-identity/customer.guard';
import { ProblemException } from '../errors/problem';
import { isUuid } from '../organization/platform/platform.dto';
import { MyWalletStatementService } from './my-wallet-statement.service';

@Controller('me')
export class MyWalletStatementController {
  constructor(private readonly statements: MyWalletStatementService) {}

  @Get('wallets/:wallet_id/statement')
  @CustomerAuth()
  async statement(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('wallet_id') walletId: string,
  ) {
    // Identifiant mal formé : même réponse qu'un portefeuille inconnu ou d'un autre compte.
    if (!isUuid(walletId)) throw new ProblemException('NOT_FOUND');
    const csv = await this.statements.csv(requestCustomer(req), walletId);
    // En-têtes posés après la lecture : un refus (404) ne porte pas ceux d'un fichier.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${walletId}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return csv;
  }
}
