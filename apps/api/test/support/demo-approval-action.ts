// Action à deux personnes de démonstration (tests seulement) : prouve le mécanisme générique sans action métier.
// `ADJUSTMENT` exigé de l'ORGANIZER_ADMIN de l'organisateur du payload ; l'exécution écrit une ligne témoin
// (config_version, note) et rend `{ done: true }` ; avec `fail: true`, elle échoue APRÈS avoir écrit (preuve du
// ROLLBACK TO SAVEPOINT). Route : POST /v1/__test/demo-adjustments → 202 avec la demande.
import { Body, Controller, Inject, Module, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApprovalActionDefinition } from '../../src/approval/action-registry';
import { registerApprovalActions } from '../../src/approval/action-registry';
import { ApprovalService, respondAccepted } from '../../src/approval/approval.service';
import { auditContext } from '../../src/audit/audit-context';
import { ProblemException } from '../../src/errors/problem';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../src/idempotency/idempotent.decorator';
import { requestPrincipal } from '../../src/identity/principal';
import { TENANT_CONTEXT, type TenantContextProvider } from '../../src/tenancy/tenant-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DemoPayload {
  organizer_id: string;
  note: string;
  fail?: boolean;
}

export const demoAdjustment: ApprovalActionDefinition<DemoPayload> = {
  action: 'ADJUSTMENT',
  requiredRole: 'ORGANIZER_ADMIN',
  scopeOf: (payload) => ({ type: 'ORGANIZER', id: payload.organizer_id }),
  validate(raw) {
    const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    if (typeof p.organizer_id !== 'string' || !UUID.test(p.organizer_id) || typeof p.note !== 'string' || p.note === '') {
      throw new ProblemException('VALIDATION_FAILED', { status: 422, detail: 'organizer_id et note attendus.' });
    }
    return { organizer_id: p.organizer_id, note: p.note, fail: p.fail === true };
  },
  async execute(client, { payload }) {
    await client.query(
      `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
       VALUES (current_setting('app.operator_id')::uuid, 'ORGANIZER', $1,
               1 + (SELECT count(*) FROM config_version WHERE scope_id = $1), now(), jsonb_build_object('note', $2::text))`,
      [payload.organizer_id, payload.note],
    );
    if (payload.fail) throw new ProblemException('VALIDATION_FAILED', { status: 422, detail: 'Échec de démonstration.' });
    return { result: { done: true } };
  },
};

@Controller('__test')
class DemoAdjustmentController {
  constructor(
    private readonly approvals: ApprovalService,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
  ) {}

  @Post('demo-adjustments')
  @Idempotent({ scope: 'bo:' })
  create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: DemoPayload,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const { operatorId } = this.tenant.current(req);
    const actor = { principal: requestPrincipal(req), audit: auditContext(req) };
    return tx.run(async (client) => {
      const created = await this.approvals.request(client, operatorId, { action: 'ADJUSTMENT', targetId: body.organizer_id ?? null, payload: body }, actor);
      return respondAccepted(res, created);
    });
  }
}

@Module({ imports: [registerApprovalActions(demoAdjustment)], controllers: [DemoAdjustmentController] })
export class DemoApprovalModule {}
