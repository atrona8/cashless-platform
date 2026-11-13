// `GET` et `POST /ledgers/{ledger_id}/debit-authority` côté humains (`getDebitAuthority` en `humanBearer`,
// `requestDebitAuthorityChange` ; mission passerelle-locale, lot WP11, T047). La lecture par la passerelle (`edgeMtls`)
// est servie par le processus `edge` (WP10, WP12), pas ici.
import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { respondAccepted } from '../approval/approval.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { requireUuid } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import {
  CHANGE_ROLES,
  DebitAuthorityService,
  READ_ROLES,
  parseChange,
} from './debit-authority.service';

@Controller('ledgers')
export class DebitAuthorityController {
  constructor(
    private readonly access: TenantAccess,
    private readonly authority: DebitAuthorityService,
  ) {}

  @Get(':ledger_id/debit-authority')
  read(@Req() req: Request, @Param('ledger_id') ledgerId: string) {
    const actor = this.access.actor(req, READ_ROLES);
    const id = requireUuid(ledgerId);
    return this.access.read(actor, (client) => this.authority.read(client, actor.principal, id));
  }

  @Post(':ledger_id/debit-authority')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:', keyUuid: true })
  change(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('ledger_id') ledgerId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, CHANGE_ROLES);
    const id = requireUuid(ledgerId);
    const input = parseChange(body);
    return tx.run(async (client) => {
      const result = await this.authority.change(client, actor.operatorId, id, input, {
        principal: actor.principal,
        audit: actor.audit,
      });
      return result.kind === 'APPROVAL' ? respondAccepted(res, result.request) : result.state;
    });
  }
}
