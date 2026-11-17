// `POST /refund-requests` (`createRefundRequest`, mission 9b, WP11 ; FR-017) : back-office, rôle `OPERATOR_ADMIN` ou
// `ORGANIZER_ADMIN`, portée de l'événement du portefeuille contrôlée par le service. Clé d'idempotence `bo:`.
import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { RefundBackofficeCreateService } from './refund-backoffice-create.service';
import { parseRefundRequestBackofficeCreate } from './refund-requests.dto';
import { REFUND_BACKOFFICE_ROLES } from './refund-requests.service';

@Controller('refund-requests')
export class RefundBackofficeCreateController {
  constructor(
    private readonly access: TenantAccess,
    private readonly creation: RefundBackofficeCreateService,
  ) {}

  @Post()
  @Idempotent({ scope: 'bo:' })
  create(@Req() req: Request, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const actor = this.access.actor(req, REFUND_BACKOFFICE_ROLES);
    const input = parseRefundRequestBackofficeCreate(body);
    return tx.run((client) => this.creation.create(client, actor, input));
  }
}
