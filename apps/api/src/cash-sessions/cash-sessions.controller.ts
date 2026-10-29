// Routes de session de caisse (mission 6, lot WP08, T037 à T040 ; contrat Guichet : `openCashSession`,
// `countCashSession`, `closeCashSession`, `getCashSession`).
//  - ouverture et comptage : terminal ET personne (`@CounterAuth`), jamais une personne seule (R-04) ;
//  - fermeture et lecture : deux chemins exclusifs (`TerminalOrPersonGuard`), terminal + personne, ou personne seule.
import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TenantTx } from '../db/tenant-tx';
import { requestDevice, type DeviceRequest } from '../device-identity/device-identity.port';
import { deviceScope } from '../idempotency/device-key';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { requestPrincipal } from '../identity/principal';
import { CounterAccess, CounterAuth, counterScope } from '../media/lifecycle/counter-access';
import { Inject } from '@nestjs/common';
import { TENANT_CONTEXT, type TenantContextProvider } from '../tenancy/tenant-context';
import { CashSessionReadService } from './cash-session-read.service';
import { parseCount, parseOpen } from './cash-sessions.dto';
import { CashSessionsService } from './cash-sessions.service';
import { TerminalOrPersonAuth } from './terminal-or-person.guard';

@Controller('cash-sessions')
export class CashSessionsController {
  constructor(
    private readonly sessions: CashSessionsService,
    private readonly reads: CashSessionReadService,
    private readonly counter: CounterAccess,
    private readonly tx: TenantTx,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
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
  async get(@Req() req: Request, @Param('cash_session_id') sessionId: string) {
    const principal = requestPrincipal(req);
    const terminal = (req as DeviceRequest).device !== undefined;
    const operatorId = terminal
      ? requestDevice(req).operatorId
      : this.tenant.current(req).operatorId;
    return this.tx.run(operatorId, async (client) => {
      const actor = terminal ? await this.counter.authorize(client, req) : null;
      return this.reads.get(client, principal, sessionId, actor?.device.deviceId ?? null);
    });
  }
}
