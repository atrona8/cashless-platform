// `POST /kyc-verifications` (`createKycVerification`, mission 10a, WP05 ; FR-001) : guichet, rôle `CASHIER` ou
// `ORGANIZER_ADMIN`, portée de l'événement du portefeuille contrôlée par le service. Clé d'idempotence `bo:`.
import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { KYC_DESK_ROLES, KycService } from './kyc.service';

@Controller('kyc-verifications')
export class KycController {
  constructor(
    private readonly access: TenantAccess,
    private readonly kyc: KycService,
  ) {}

  @Post()
  @Idempotent({ scope: 'bo:' })
  create(@Req() req: Request, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const actor = this.access.actor(req, KYC_DESK_ROLES);
    return tx.run((client) => this.kyc.create(client, actor, body));
  }
}
