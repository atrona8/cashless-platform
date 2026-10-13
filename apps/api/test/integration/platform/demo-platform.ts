// Route et action de plateforme de démonstration (tests seulement) : prouvent le socle de plateforme sans route
// métier. POST /v1/__test/platform-operators crée un prestataire (écriture de plateforme idempotente) ;
// POST /v1/__test/platform-demands crée une demande `PLATFORM_CONTRACT_VERSION` (202). L'exécution écrit une version
// de configuration de plateforme témoin ; avec `fail: true`, elle échoue APRÈS avoir écrit.
import { Body, Controller, Module, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApprovalActionDefinition } from '../../../src/approval/action-registry';
import { registerApprovalActions } from '../../../src/approval/action-registry';
import { ApprovalService, respondAccepted } from '../../../src/approval/approval.service';
import { auditContext } from '../../../src/audit/audit-context';
import { ProblemException } from '../../../src/errors/problem';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../../src/idempotency/idempotent.decorator';
import { requestPrincipal } from '../../../src/identity/principal';
import { Roles } from '../../../src/identity/roles.decorator';

export interface DemoPlatformPayload {
  note: string;
  fail?: boolean;
}

export const demoPlatformContractVersion: ApprovalActionDefinition<DemoPlatformPayload> = {
  action: 'PLATFORM_CONTRACT_VERSION',
  requiredRole: 'PLATFORM_ADMIN',
  platform: true,
  scopeOf: () => ({ type: 'PLATFORM' }),
  validate(raw) {
    const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    if (typeof p.note !== 'string' || p.note === '') {
      throw new ProblemException('VALIDATION_FAILED', { status: 422, detail: 'note attendue.' });
    }
    return { note: p.note, fail: p.fail === true };
  },
  async execute(client, { payload }) {
    await client.query(
      `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
       SELECT NULL, 'PLATFORM', p.id, 1, clock_timestamp(), jsonb_build_object('note', $1::text)
         FROM party p WHERE p.kind = 'PLATFORM' ORDER BY p.created_at, p.id LIMIT 1`,
      [payload.note],
    );
    if (payload.fail) throw new ProblemException('VALIDATION_FAILED', { status: 422, detail: 'Échec de démonstration.' });
    return { result: { done: true } };
  },
};

const PLATFORM = () => ({ type: 'PLATFORM' as const });

@Controller('__test')
class DemoPlatformController {
  constructor(private readonly approvals: ApprovalService) {}

  @Post('platform-operators')
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  @Idempotent({ scope: 'plt:', platform: true })
  createOperator(@Body() body: { legal_name?: string }, @IdempotentTransaction() tx: IdempotentTx) {
    return tx.run(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO party (kind, legal_name, country_code) VALUES ('OPERATOR', $1, 'SN') RETURNING id`,
        [body.legal_name ?? ''],
      );
      return { operator_id: rows[0]!.id, legal_name: body.legal_name };
    });
  }

  /** Même option de plateforme, sans garde de rôle : l'intercepteur refuse seul une personne d'un prestataire. */
  @Post('platform-unguarded')
  @Idempotent({ scope: 'plt:', platform: true })
  unguarded(@IdempotentTransaction() tx: IdempotentTx) {
    return tx.run(async () => ({ done: true }));
  }

  @Post('platform-demands')
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  @Idempotent({ scope: 'plt:', platform: true })
  demand(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: DemoPlatformPayload,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = { principal: requestPrincipal(req), audit: auditContext(req) };
    return tx.run(async (client) => {
      const created = await this.approvals.request(
        client,
        null,
        { action: 'PLATFORM_CONTRACT_VERSION', targetId: null, payload: body },
        actor,
      );
      return respondAccepted(res, created);
    });
  }
}

@Module({ imports: [registerApprovalActions(demoPlatformContractVersion)], controllers: [DemoPlatformController] })
export class DemoPlatformModule {}
