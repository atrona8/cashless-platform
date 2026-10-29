// Routes de session de caisse (mission 6, lot WP08, T037 à T040 ; contrat Guichet : `openCashSession`,
// `countCashSession`, `closeCashSession`, `getCashSession`).
//  - ouverture et comptage : terminal ET personne (`@CounterAuth`), jamais une personne seule (R-04) ;
//  - fermeture et lecture : deux chemins exclusifs (`TerminalOrPersonGuard`), terminal + personne, ou personne seule.
import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { DeviceRequest } from '../device-identity/device-identity.port';
import { deviceScope } from '../idempotency/device-key';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { CounterAuth, counterScope } from '../media/lifecycle/counter-access';
import { CashSessionReadService } from './cash-session-read.service';
import { parseCount, parseOpen } from './cash-sessions.dto';
import { CashSessionsService } from './cash-sessions.service';
import { TerminalOrPersonAuth } from './terminal-or-person.guard';

@Controller('cash-sessions')
export class CashSessionsController {
  constructor(
    private readonly sessions: CashSessionsService,
    private readonly reads: CashSessionReadService,
  ) {}

  @Post()
  @HttpCode(201)
  @CounterAuth()
  @Idempotent({ scope: counterScope, deviceSeq: true })
  open(@Req() req: Request, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const input = parseOpen(body);
    return tx.run((client) => this.sessions.open(client, req, input));
  }

  @Post(':cash_session_id/counts')
  @HttpCode(200)
  @CounterAuth()
  @Idempotent({ scope: counterScope, deviceSeq: true })
  count(
    @Req() req: Request,
    @Param('cash_session_id') sessionId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const input = parseCount(body);
    return tx.run((client) => this.sessions.count(client, req, sessionId, input));
  }

  @Post(':cash_session_id/close')
  @HttpCode(200)
  @TerminalOrPersonAuth()
  @Idempotent({
    scope: (req) => ((req as DeviceRequest).device ? deviceScope(req) : 'bo:'),
    deviceSeq: 'when-device',
    keyUuid: 'without-device',
  })
  close(
    @Req() req: Request,
    @Param('cash_session_id') sessionId: string,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const terminal = (req as DeviceRequest).device !== undefined;
    return tx.run((client) => this.sessions.close(client, req, sessionId, terminal));
  }

  @Get(':cash_session_id')
  @TerminalOrPersonAuth()
  get(@Req() req: Request, @Param('cash_session_id') sessionId: string) {
    return this.reads.getForRequest(req, sessionId);
  }
}
