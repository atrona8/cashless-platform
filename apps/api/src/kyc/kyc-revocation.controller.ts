// `POST /kyc-verifications/{kyc_verification_id}/revoke` (`revokeKycVerification`, mission 10a,
// WP06 ; FR-005, C-002) : opération à deux personnes (ADR-74), `202` avec la demande
// `KYC_REVOCATION`, RIEN d'écrit sur l'identification ; une autre personne l'approuve par
// `approveApprovalRequest`. Clé d'idempotence `bo:` (UUID). Modèle : `late-claims.controller.ts`.
import { Body, Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { respondAccepted } from '../approval/approval.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { isUuid, notFound } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import {
  KYC_REVOCATION_ROLES,
  KycRevocationActions,
  parseKycRevocationBody,
} from './kyc-revocation-action';

@Controller()
export class KycRevocationController {
  constructor(
    private readonly access: TenantAccess,
    private readonly actions: KycRevocationActions,
  ) {}

  @Post('kyc-verifications/:kyc_verification_id/revoke')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:', keyUuid: true })
  revoke(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('kyc_verification_id') kycVerificationId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    // Rôle tenu quelque part (403 sinon) ; le rôle sur la portée est contrôlé par la demande.
    const actor = this.access.actor(req, KYC_REVOCATION_ROLES);
    if (!isUuid(kycVerificationId)) throw notFound();
    const { reason } = parseKycRevocationBody(body);
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.actions.request(
          client,
          actor.operatorId,
          { kycVerificationId, reason },
          { principal: actor.principal, audit: actor.audit },
        ),
      ),
    );
  }
}
