// Routes 10 à 12 (mission 9b, WP09) : `importAccountStatement`, `listStatementLines`, `matchStatementLine`.
// Rôles ORGANIZER_ADMIN et OPERATOR_ADMIN, portée de l'événement du grand livre contrôlée par le service. Le corps
// `text/csv` est lu par `CsvBodyMiddleware` AVANT l'intercepteur d'idempotence (l'empreinte porte sur le fichier).
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { parseLimit } from '../customer-app/me.controller';
import { ProblemException } from '../errors/problem';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import type { Role } from '../identity/principal';
import type { CsvRequest } from '../media/batches/csv-body.middleware';
import { requireUuid } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import {
  parseLineCursor,
  parseLineId,
  parseListFilters,
  parseMatchBody,
  parseStatementFile,
  parseStatementHeader,
} from './statements.dto';
import { StatementsService } from './statements.service';

export const STATEMENT_ROLES: readonly Role[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'];

const bad = (detail: string) => new ProblemException('VALIDATION_FAILED', { status: 400, detail });

@Controller()
export class StatementsController {
  constructor(
    private readonly access: TenantAccess,
    private readonly statements: StatementsService,
  ) {}

  @Post('ledgers/:ledger_id/accounts/:account_id/statements')
  @HttpCode(201)
  @Idempotent({ scope: 'bo:' })
  importStatement(
    @Req() req: CsvRequest,
    @Param('ledger_id') ledgerId: string,
    @Param('account_id') accountId: string,
    @Query() query: Record<string, unknown>,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, STATEMENT_ROLES);
    const ledger = requireUuid(ledgerId);
    const account = requireUuid(accountId);
    if (req.csvTooLarge) throw bad('Fichier trop volumineux : 1 Mo au plus par envoi.');
    const header = parseStatementHeader(query);
    const csv: unknown = req.body;
    if (typeof csv !== 'string' || csv === '')
      throw bad('Corps text/csv attendu : external_ref;value_date;amount;currency.');
    const lines = parseStatementFile(csv);
    return tx.run((client) =>
      this.statements.import(client, actor, ledger, account, header, csv, lines),
    );
  }

  @Get('ledgers/:ledger_id/statement-lines')
  list(
    @Req() req: Request,
    @Param('ledger_id') ledgerId: string,
    @Query('account_id') accountId?: string,
    @Query('matched') matched?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, STATEMENT_ROLES);
    const ledger = requireUuid(ledgerId);
    const filters = parseListFilters(accountId, matched);
    const page = { limit: parseLimit(limit), after: parseLineCursor(cursor) };
    return this.access.read(actor, (client) =>
      this.statements.list(client, actor, ledger, filters, page),
    );
  }

  @Post('statement-lines/:statement_line_id/match')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  match(
    @Req() req: Request,
    @Param('statement_line_id') lineId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, STATEMENT_ROLES);
    const id = parseLineId(lineId);
    const target = parseMatchBody(body);
    return tx.run((client) => this.statements.match(client, actor, id, target));
  }
}
