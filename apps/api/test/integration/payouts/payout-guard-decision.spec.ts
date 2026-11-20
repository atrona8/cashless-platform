// Intégration et unité : crochet `guardDecision` des versements (mission durcissements-serveur,
// lot WP10, OP-N137 (a) et (b) ; FR-013, FR-014).
import { ApprovalService } from '../../../src/approval/approval.service';
import type { TestPerson } from '../../support/fake-idp';
import { ownerRows } from '../../support/media-fixtures';
import { PayoutWorld } from './payout-fixtures';

jest.setTimeout(120_000);

describe('crochet guardDecision (versements)', () => {
  let p: PayoutWorld;
  beforeAll(async () => {
    p = await PayoutWorld.create();
  }, 240_000);
  afterAll(async () => {
    await p.close();
  });

  const operatorLine = () => ({
    beneficiary_party_id: p.w.ops.a,
    amount: 1_000,
    currency: 'XOF',
    method: 'WAVE',
    msisdn: '+221770000009',
  });
  const statusOf = async (id: string, who = p.w.organizerAdminA) =>
    (await p.bo('GET', `/approval-requests/${id}`, who)).body.status;
  const count = async (action: string, id: string) =>
    (
      await ownerRows<{ n: number }>(
        'SELECT count(*)::int AS n FROM audit_log WHERE action = $1 AND object_id = $2',
        [action, id],
      )
    )[0]!.n;
  const reject = (id: string, who: TestPerson) =>
    p.bo('POST', `/approval-requests/${id}/reject`, who, { note: 'Non conforme' });

  async function mixedRequest() {
    await p.fund('L-OPE-CASSE', 4_000);
    const m = await p.merchant(5_000);
    const both = await p.holdingBoth();
    const asked = await p.request([p.line(m, 1_000), operatorLine()], both);
    expect(asked.status).toBe(202);
    return { id: String(asked.body.approval_request_id), both };
  }

  it('FR-013 : approbation d’un lot mixte par une seule classe : 403, PENDING, rien écrit ; puis un détenteur des deux exécute la même demande', async () => {
    const { id, both } = await mixedRequest();
    const before = await p.txCount('PAYOUT_INITIATED');
    for (const one of [p.organizerAdmin2, p.operatorAdmin2]) {
      const res = await p.approve(id, one);
      expect(res.status).toBe(403);
    }
    expect(await statusOf(id, both)).toBe('PENDING');
    expect(await count('APPROVAL_FAILED', id)).toBe(0);
    expect(await p.payoutsOf(id)).toHaveLength(0);
    expect(await p.txCount('PAYOUT_INITIATED')).toBe(before);
    const ok = await p.approve(id, await p.holdingBoth());
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('EXECUTED');
    expect(await p.payoutsOf(id)).toHaveLength(2);
  });

  it('FR-014 : refus d’un lot mixte par une seule classe : 403, PENDING ; par un détenteur des deux : REJECTED', async () => {
    const { id, both } = await mixedRequest();
    expect((await reject(id, p.organizerAdmin2)).status).toBe(403);
    expect((await reject(id, p.operatorAdmin2)).status).toBe(403);
    expect(await statusOf(id, both)).toBe('PENDING');
    expect(await count('APPROVAL_REJECTED', id)).toBe(0);
    const res = await reject(id, await p.holdingBoth());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
  });

  it('attribution révoquée avant la décision : 403 par le crochet, demande PENDING, rien écrit', async () => {
    const { id } = await mixedRequest();
    const approver = await p.holdingBoth();
    // Le contrôle d'`execute` (défense en profondeur) ne joue que pour une révocation entre le crochet
    // et l'exécution, dans la même transaction : non reproductible par la route.
    await ownerRows(
      `UPDATE role_assignment SET revoked_at = clock_timestamp(), revoked_by = user_id
        WHERE user_id = $1 AND role = 'OPERATOR_ADMIN'`,
      [approver.userId],
    );
    const res = await p.approve(id, approver);
    expect(res.status).toBe(403);
    expect(await statusOf(id)).toBe('PENDING');
    expect(await p.payoutsOf(id)).toHaveLength(0);
  });

  it('unité : le crochet est appelé pour APPROVE et REJECT, jamais s’il n’est pas défini', async () => {
    const calls: string[] = [];
    const guard = jest.fn(async (_ctx: unknown, decision: string) => {
      calls.push(decision);
    });
    const payload = { x: 1 };
    const row = { id: '00000000-0000-4000-8000-000000000001', action: 'PAYOUT', payload };
    const make = (guardDecision?: typeof guard) => {
      const definition = {
        requiredRole: 'ORGANIZER_ADMIN',
        scopeOf: () => ({ type: 'ORGANIZER', id: 'o' }),
        validate: (raw: unknown) => raw,
        guardDecision,
      };
      const client = { query: jest.fn(async () => ({ rows: [row] })) };
      const service = Object.create(ApprovalService.prototype) as Record<string, unknown>;
      service.registry = { get: () => definition };
      service.roleOn = async () => 'ORGANIZER_ADMIN';
      const run = (decision: 'APPROVE' | 'REJECT') =>
        (
          service as unknown as {
            prepareDecision: (...a: unknown[]) => Promise<unknown>;
          }
        ).prepareDecision(client, row.id, { principal: {} }, decision);
      return run;
    };
    const withGuard = make(guard);
    await withGuard('APPROVE');
    await withGuard('REJECT');
    expect(calls).toEqual(['APPROVE', 'REJECT']);
    const without = make(undefined);
    await expect(without('APPROVE')).resolves.toBeDefined();
    await expect(without('REJECT')).resolves.toBeDefined();
    expect(calls).toHaveLength(2);
  });
});
