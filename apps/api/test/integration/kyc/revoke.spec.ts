// Intégration (mission 10a, WP06 ; FR-005, FR-006, C-002 ; ADR-74) : `revokeKycVerification`
// (POST /kyc-verifications/{id}/revoke), action `KYC_REVOCATION` à deux personnes. Amorçage par le
// propriétaire (`create_kyc_verification`) ; la route de WP05 n'est pas utilisée pour l'amorçage.
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  KYC_REVOCATION_ROLES,
  parseKycRevocationBody,
} from '../../../src/kyc/kyc-revocation-action';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { freshPhone } from '../../support/customer-auth';
import { ownerRows as rows } from '../../support/media-fixtures';
import { createCashWorld, type CashWorld } from '../../support/cash-fixtures';
import { createTestCustomer } from '../../support/fake-customer';
import { call } from '../refunds/refund-flow-fixtures';
import { LateWorld } from '../late-claims/late-claim-fixtures';

jest.setTimeout(300_000);

const RARE = 'Z9Q7';
const REASON = 'Pièce présentée au guichet jugée falsifiée.';

describe('révocation d’une identification (POST /kyc-verifications/{id}/revoke)', () => {
  let lw: LateWorld;
  const author = () => lw.author();
  const validator = () => lw.validator();
  const revoke = (id: string, who: TestPerson | null, body: unknown = { reason: REASON }) =>
    lw.cw.bo('POST', `/kyc-verifications/${id}/revoke`, who ?? lw.w.cashierA, body, randomUUID());
  const status = async (id: string) =>
    (await rows<{ status: string }>('SELECT status FROM kyc_verification WHERE id = $1', [id]))[0]!
      .status;
  // La RLS de `kyc_verification` s'applique aussi au propriétaire : le prestataire est nommé.
  const level = (walletId: string) =>
    withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [lw.operatorId]);
      return (await db.query<{ l: string }>('SELECT wallet_kyc_level($1) AS l', [walletId]))
        .rows[0]!.l;
    });
  const requests = (id: string) =>
    rows<{ id: string; status: string; failure_code: string | null }>(
      `SELECT id, status, failure_code FROM approval_request
        WHERE action = 'KYC_REVOCATION' AND target_id = $1 ORDER BY requested_at`,
      [id],
    );

  /** Client au numéro vérifié, un portefeuille, identification posée par le propriétaire. */
  async function identified(opts: { byCustomer?: boolean } = {}) {
    const { walletId, customer } = await lw.pw.wallet();
    const kyc = await withOwner(async (db) => {
      await db.query(
        'INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES ($1, $2, $3)',
        [customer.customerId, lw.operatorId, freshPhone()],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [lw.operatorId]);
      const { rows: out } = await db.query<{ id: string }>(
        `SELECT id FROM create_kyc_verification($1, $2, 'NATIONAL_ID', 'SN', $3,
                                                 '2031-05-31', $4)`,
        [
          opts.byCustomer ? null : walletId,
          opts.byCustomer ? customer.customerId : null,
          RARE,
          lw.w.cashierA.userId,
        ],
      );
      return out[0]!.id;
    });
    return { walletId, customer, kyc };
  }

  beforeAll(async () => {
    lw = await LateWorld.create();
  }, 240_000);
  afterAll(async () => {
    await lw.close();
  });

  it('les rôles de la demande sont bornés : OPERATOR_ADMIN et ORGANIZER_ADMIN, aucun autre', () => {
    expect([...KYC_REVOCATION_ROLES].sort()).toEqual(['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']);
  });

  it('202 PENDING sans écriture : l’identification reste VERIFIED, niveau VERIFIED', async () => {
    const k = await identified();
    expect(await level(k.walletId)).toBe('VERIFIED');
    const res = await revoke(k.kyc, author());
    expect(res.status).toBe(202);
    expect(res.headers.location).toBe(`/v1/approval-requests/${res.body.approval_request_id}`);
    expect(res.body).toMatchObject({
      action: 'KYC_REVOCATION',
      status: 'PENDING',
      target_id: k.kyc,
    });
    expect(await status(k.kyc)).toBe('VERIFIED');
    expect(await level(k.walletId)).toBe('VERIFIED');
    expect(JSON.stringify(res.body)).not.toContain(RARE);
    const [req] = await requests(k.kyc);
    expect(req!.status).toBe('PENDING');
  });

  it('approbation par une autre personne : EXECUTED, KycVerification, revoked_by = auteur, valideur à l’audit, niveau NONE', async () => {
    const k = await identified();
    // Second portefeuille du même client : le niveau est celui du client.
    const second = await lw.pw.wallet({ customer: k.customer });
    expect(await level(second.walletId)).toBe('VERIFIED');
    const asked = await revoke(k.kyc, author());
    const done = await lw.approve(asked.body.approval_request_id, validator());
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('EXECUTED');
    expect(contractViolations('KycVerification', done.body.result)).toEqual([]);
    expect(done.body.result).toMatchObject({
      kyc_verification_id: k.kyc,
      status: 'REVOKED',
      revoked_by: author().userId,
      revoked_reason: REASON,
    });
    const [row] = await rows<{ status: string; revoked_by: string; revoked_reason: string }>(
      'SELECT status, revoked_by, revoked_reason FROM kyc_verification WHERE id = $1',
      [k.kyc],
    );
    expect(row).toEqual({ status: 'REVOKED', revoked_by: author().userId, revoked_reason: REASON });
    expect(row!.revoked_by).not.toBe(validator().userId);
    const audit = await rows<{ approver_id: string }>(
      `SELECT approver_id FROM audit_log
        WHERE action = 'APPROVAL_EXECUTED' AND object_id = $1`,
      [asked.body.approval_request_id],
    );
    expect(audit).toEqual([{ approver_id: validator().userId }]);
    expect(await level(k.walletId)).toBe('NONE');
    expect(await level(second.walletId)).toBe('NONE');
  });

  it('un auteur dans le corps est sans effet ; l’auteur retenu est l’acteur authentifié', async () => {
    const k = await identified();
    const asked = await revoke(k.kyc, author(), {
      reason: REASON,
      revoked_by: validator().userId,
    });
    expect(asked.status).toBe(202);
    const done = await lw.approve(asked.body.approval_request_id, validator());
    expect((done.body.result as { revoked_by: string }).revoked_by).toBe(author().userId);
  });

  it('l’auteur ne valide pas sa demande ; SUPERVISOR refusé (403) ; demande PENDING, identification VERIFIED', async () => {
    const k = await identified();
    const asked = await revoke(k.kyc, author());
    const self = await lw.approve(asked.body.approval_request_id, author());
    expect(self.status).toBeGreaterThanOrEqual(400);
    expect(self.status).toBeLessThan(500);
    const bySupervisor = await lw.approve(asked.body.approval_request_id, lw.cw.supervisor);
    expect(bySupervisor.status).toBe(403);
    const byOther = await lw.approve(asked.body.approval_request_id, lw.cw.organizerAdminOp2);
    expect([403, 404]).toContain(byOther.status);
    expect((await requests(k.kyc)).map((r) => r.status)).toEqual(['PENDING']);
    expect(await status(k.kyc)).toBe('VERIFIED');
    // Le second administrateur du prestataire peut valider.
    const done = await lw.approve(asked.body.approval_request_id, lw.cw.operatorAdmin2);
    expect(done.body.status).toBe('EXECUTED');
  });

  it('déjà révoquée : 409 à la demande sans demande créée ; révoquée entre-temps : approbation FAILED CONFLICT_STATE', async () => {
    const k = await identified();
    const asked = await revoke(k.kyc, author());
    expect(asked.status).toBe(202);
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [lw.operatorId]);
      await db.query('SELECT revoke_kyc_verification($1, $2, $3)', [
        k.kyc,
        lw.w.cashierA.userId,
        REASON,
      ]);
    });
    const done = await lw.approve(asked.body.approval_request_id, validator());
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'FAILED', failure_code: 'CONFLICT_STATE' });
    expect(await status(k.kyc)).toBe('REVOKED');
    const before = (await requests(k.kyc)).length;
    const again = await revoke(k.kyc, author());
    expect([again.status, again.body.code]).toEqual([409, 'CONFLICT_STATE']);
    expect(await requests(k.kyc)).toHaveLength(before);
  });

  it('motif de 9 caractères, corps sans motif : 422 ; inconnue ou autre prestataire : 404 ; CASHIER : 403', async () => {
    const k = await identified();
    const short = await revoke(k.kyc, author(), { reason: '123456789' });
    expect([short.status, short.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(JSON.stringify(short.body)).not.toContain('123456789');
    expect((await revoke(k.kyc, author(), {})).status).toBe(422);
    expect((await revoke(randomUUID(), author())).status).toBe(404);
    expect((await revoke('pas-un-uuid', author())).status).toBe(404);
    expect((await revoke(k.kyc, lw.cw.organizerAdminOp2)).status).toBe(404);
    expect((await revoke(k.kyc, lw.w.cashierA)).status).toBe(403);
    expect(await requests(k.kyc)).toHaveLength(0);
    expect(await status(k.kyc)).toBe('VERIFIED');
  });

  it('une seconde demande sur la même identification : 409', async () => {
    const k = await identified();
    expect((await revoke(k.kyc, author())).status).toBe(202);
    const second = await revoke(k.kyc, validator());
    expect([second.status, second.body.code]).toEqual([409, 'CONFLICT_STATE']);
    expect(await requests(k.kyc)).toHaveLength(1);
  });

  it('identification posée par client (sans portefeuille) : portée OPERATOR, OPERATOR_ADMIN seul', async () => {
    const k = await identified({ byCustomer: true });
    const byOrganizer = await revoke(k.kyc, validator());
    expect(byOrganizer.status).toBe(403);
    const asked = await revoke(k.kyc, author());
    expect(asked.status).toBe(202);
    const refused = await lw.approve(asked.body.approval_request_id, validator());
    expect(refused.status).toBe(403);
    const done = await lw.approve(asked.body.approval_request_id, lw.cw.operatorAdmin2);
    expect(done.body.status).toBe('EXECUTED');
    expect(await status(k.kyc)).toBe('REVOKED');
    expect((done.body.result as { revoked_by: string }).revoked_by).toBe(author().userId);
  });

  it('demande falsifiée par le propriétaire : target_id différent ou champ en trop, exécution refusée, rien d’écrit', async () => {
    const a = await identified();
    const b = await identified();
    const insert = (target: string, payload: Record<string, unknown>) =>
      withOwner(async (db) => {
        const { rows: out } = await db.query<{ id: string }>(
          `INSERT INTO approval_request (operator_id, action, target_id, payload, requested_by)
           VALUES ($1, 'KYC_REVOCATION', $2, $3::jsonb, $4) RETURNING id`,
          [lw.operatorId, target, JSON.stringify(payload), author().userId],
        );
        return out[0]!.id;
      });
    const payload = {
      kyc_verification_id: b.kyc,
      wallet_id: b.walletId,
      reason: REASON,
      scope_type: 'EVENT',
      scope_id: lw.eventId,
    };
    const mismatched = await insert(a.kyc, payload);
    const mism = await lw.approve(mismatched, validator());
    expect(mism.status).toBeGreaterThanOrEqual(400);
    expect(mism.status).toBeLessThan(500);
    const extra = await insert(b.kyc, { ...payload, revoked_by: validator().userId });
    expect((await lw.approve(extra, validator())).status).toBe(422);
    const short = await insert(b.kyc, { ...payload, reason: 'court' });
    expect((await lw.approve(short, validator())).status).toBe(422);
    expect(await status(a.kyc)).toBe('VERIFIED');
    expect(await status(b.kyc)).toBe('VERIFIED');
    const states = await rows<{ status: string }>(
      'SELECT status FROM approval_request WHERE id = ANY($1::uuid[])',
      [[mismatched, extra, short]],
    );
    expect(states.map((s) => s.status)).toEqual(['PENDING', 'PENDING', 'PENDING']);
  });

  it('journaux : id_last4 admis dans audit_log (result), absent des sorties standard et d’erreur', async () => {
    const k = await identified();
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
      jest.spyOn(Logger.prototype, m),
    );
    const out = jest.spyOn(process.stdout, 'write');
    const err = jest.spyOn(process.stderr, 'write');
    const asked = await revoke(k.kyc, author());
    const done = await lw.approve(asked.body.approval_request_id, validator());
    const logged = [
      ...spies.flatMap((s) => s.mock.calls.map((a) => JSON.stringify(a))),
      ...out.mock.calls.map((a) => String(a[0])),
      ...err.mock.calls.map((a) => String(a[0])),
    ].join('\n');
    spies.forEach((s) => s.mockRestore());
    out.mockRestore();
    err.mockRestore();
    expect(done.body.status).toBe('EXECUTED');
    expect(logged).not.toContain(RARE);
    const audit = await rows<{ after: unknown }>(
      `SELECT after FROM audit_log WHERE action = 'APPROVAL_EXECUTED' AND object_id = $1`,
      [asked.body.approval_request_id],
    );
    expect(JSON.stringify(audit[0]!.after)).toContain(RARE);
  });

  it('le corps : reason de 10 caractères au moins après trim, autre clé sans effet', () => {
    expect(parseKycRevocationBody({ reason: `  ${REASON}  ` })).toEqual({ reason: REASON });
    expect(() => parseKycRevocationBody({ reason: '   123456789 ' })).toThrow();
    expect(() => parseKycRevocationBody([])).toThrow();
    expect(parseKycRevocationBody({ reason: REASON, by: 'x' })).toEqual({ reason: REASON });
  });
});

describe('plafonds après révocation (US2, FR-006)', () => {
  let c: CashWorld;
  beforeAll(async () => {
    c = await createCashWorld();
  }, 240_000);
  afterAll(async () => {
    await c.close();
  });

  it('recharge au-delà du plafond non identifié : acceptée identifié, 422 WALLET_LIMIT_EXCEEDED après la révocation approuvée', async () => {
    const m = await c.fresh(c.batches.plain);
    const { walletId } = await c.activate(m);
    const op = c.w.ops.a;
    const kyc = await withOwner(async (db) => {
      const customer = await createTestCustomer(db, op);
      await db.query(
        'INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES ($1, $2, $3)',
        [customer.customerId, op, freshPhone()],
      );
      await db.query('UPDATE wallet SET customer_id = $2 WHERE id = $1', [
        walletId,
        customer.customerId,
      ]);
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [op]);
      const { rows: out } = await db.query<{ id: string }>(
        `SELECT id FROM create_kyc_verification($1, NULL, 'NATIONAL_ID', 'SN', $2, '2031-05-31', $3)`,
        [walletId, RARE, c.w.cashierA.userId],
      );
      return out[0]!.id;
    });
    const restore = await c.setCaps({ maxBalance: 1000, monthly: null });
    try {
      const accepted = await c.topup(c.topupBody(m, 5000));
      expect(accepted.status).toBe(201);
      const asked = await call(
        c.app,
        c.w.operatorAdminA,
        `/kyc-verifications/${kyc}/revoke`,
        { reason: REASON },
        randomUUID(),
      );
      expect(asked.status).toBe(202);
      const done = await call(
        c.app,
        c.w.organizerAdminA,
        `/approval-requests/${asked.body.approval_request_id}/approve`,
        {},
        randomUUID(),
      );
      expect(done.body.status).toBe('EXECUTED');
      expect(
        await rows('SELECT 1 FROM kyc_verification WHERE id = $1 AND status = $2', [
          kyc,
          'REVOKED',
        ]),
      ).toHaveLength(1);
      const before = await c.counts();
      const refused = await c.topup(c.topupBody(m, 5000));
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('WALLET_LIMIT_EXCEEDED');
      expect(await c.counts()).toEqual(before);
    } finally {
      await restore();
    }
  });
});
