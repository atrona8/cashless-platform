// Route 13 (mission 9b, WP09) : `getLedgerReconciliation`, lecture seule.
import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../identity/principal';
import { requireUuid } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { ReconciliationService } from './reconciliation.service';

const READERS: readonly Role[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN', 'SUPERVISOR'];

@Controller('ledgers')
export class ReconciliationController {
  constructor(
    private readonly access: TenantAccess,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get(':ledger_id/reconciliation')
  state(@Req() req: Request, @Param('ledger_id') ledgerId: string) {
    const actor = this.access.actor(req, READERS);
    const ledger = requireUuid(ledgerId);
    return this.access.read(actor, (client) => this.reconciliation.state(client, actor, ledger));
  }
}
