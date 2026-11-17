// Routes 5 à 8 (mission 9b, lot WP08 ; contrat `listPayoutEntitlements`, `requestPayoutBatch`,
// `listPayouts`,
// `exportPayoutBatch`). La demande est à deux personnes (ADR-74) : `202`, rien d'écrit.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { respondAccepted } from '../approval/approval.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { PAYOUT_ROLES, PayoutActions } from './payout-action';
import { parseBatchBody, parseBatchFilter, parsePageLimit, parseStatusFilter } from './payouts.dto';
import { PayoutsService } from './payouts.service';

@Controller('ledgers/:ledger_id')
export class PayoutBatchesController {
  constructor(
    private readonly access: TenantAccess,
    private readonly actions: PayoutActions,
    private readonly payouts: PayoutsService,
  ) {}

  @Get('payout-entitlements')
  listEntitlements(
    @Req() req: Request,
    @Param('ledger_id') ledgerId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, PAYOUT_ROLES);
    const page = { cursor, limit: parsePageLimit(limit) };
    return this.access.read(actor, (client) =>
      this.payouts.listEntitlements(client, actor, ledgerId, page),
    );
  }

  @Post('payout-batches/approval-requests')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:', keyUuid: true })
  requestBatch(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('ledger_id') ledgerId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    // Rôle tenu quelque part (403 sinon) ; le rôle de chaque classe de bénéficiaire est contrôlé
    // par la demande.
    const actor = this.access.actor(req, PAYOUT_ROLES);
    const lines = parseBatchBody(body);
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.actions.request(
          client,
          actor.operatorId,
          { ledgerId, lines },
          { principal: actor.principal, audit: actor.audit },
        ),
      ),
    );
  }

  @Get('payouts')
  listPayouts(
    @Req() req: Request,
    @Param('ledger_id') ledgerId: string,
    @Query('status') status?: string,
    @Query('approval_request_id') batch?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, PAYOUT_ROLES);
    const filters = {
      status: parseStatusFilter(status),
      approvalRequestId: parseBatchFilter(batch),
    };
    const page = { cursor, limit: parsePageLimit(limit) };
    return this.access.read(actor, (client) =>
      this.payouts.listPayouts(client, actor, ledgerId, filters, page),
    );
  }

  /** Non rejouée par l'idempotence (WP01) : chaque export est audité. */
  @Get('payout-batches/:approval_request_id/export')
  async exportBatch(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('ledger_id') ledgerId: string,
    @Param('approval_request_id') batchId: string,
  ): Promise<string> {
    const actor = this.access.actor(req, PAYOUT_ROLES);
    const csv = await this.access.read(actor, (client) =>
      this.payouts.exportBatch(client, actor, ledgerId, batchId),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return csv;
  }
}
