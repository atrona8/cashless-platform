// Action `PSP_CONFIGURATION` (mission 6, lot WP10, T050 ; FR-009, FR-011, FR-031 ; A15, A18, A30, A34) :
// activation, suspension, réactivation à deux personnes. Aucune route ne change le statut en direct.
import { randomUUID } from 'node:crypto';
import { PSP_CONFIGURATION_ROLES } from '../../../src/psp-configurations/psp-configuration-action';
import { createPspWorld, type PspWorld } from './psp-config-fixtures';

jest.setTimeout(240_000);

describe('PSP_CONFIGURATION : deux personnes', () => {
  let w: PspWorld;
  let org: string;
  beforeAll(async () => {
    w = await createPspWorld();
    org = w.fx.parties.ORG;
  });
  afterAll(async () => {
    await w?.close();
  });

  const state = async (id: string) =>
    (
      await w.owner<{
        status: string;
        version: number;
        compliance_ref: string | null;
        approved_by: string | null;
      }>(
        'SELECT status, version, compliance_ref, approved_by FROM psp_configuration WHERE psp_configuration_id = $1',
        [id],
      )
    )[0]!;
  const request = async (id: string) =>
    (
      await w.owner<{ status: string; failure_reason: string | null }>(
        'SELECT status, failure_reason FROM approval_request WHERE target_id = $1 ORDER BY requested_at DESC LIMIT 1',
        [id],
      )
    )[0]!;

  it('rôles de l’action bornés à l’OPERATOR_ADMIN', () => {
    expect([...PSP_CONFIGURATION_ROLES]).toEqual(['OPERATOR_ADMIN']);
  });

  it('activation : demande 202 (charge composée), rien d’exécuté, puis approbation par une autre personne', async () => {
    const id = await w.createConfig(w.op1);
    await w.addFeeRule(w.op1, id);
    const asked = await w.api(w.op1, 'post', `/psp-configurations/${id}/approval-requests`, {
      status: 'ACTIVE',
      compliance_ref: 'KYB-2026-0142',
    });
    expect(asked.status).toBe(202);
    expect(asked.body).toMatchObject({
      action: 'PSP_CONFIGURATION',
      status: 'PENDING',
      target_id: id,
      payload: {
        psp_configuration_id: id,
        version: 1,
        status: 'ACTIVE',
        compliance_ref: 'KYB-2026-0142',
      },
    });
    expect((await state(id)).status).toBe('DRAFT');
    const done = await w.approve(w.op2, asked.body.approval_request_id);
    expect(done.body).toMatchObject({
      status: 'EXECUTED',
      result: { status: 'ACTIVE', version: 1 },
    });
    expect(await state(id)).toMatchObject({
      status: 'ACTIVE',
      compliance_ref: 'KYB-2026-0142',
      approved_by: w.op2.userId,
    });
    const audit = await w.owner<{ after: string }>(
      `SELECT after::text AS after FROM audit_log WHERE action = 'PSP_CONFIGURATION_STATUS_CHANGED' AND object_id = $1`,
      [id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).not.toContain('secret_ref');
  });

  it('suspension puis réactivation (compliance_ref redemandée)', async () => {
    const id = await w.activeConfig();
    const s = await w.requestChange(w.op1, id, { status: 'SUSPENDED' });
    expect((await state(id)).status).toBe('ACTIVE');
    expect((await w.approve(w.op2, s.approval_request_id)).body.status).toBe('EXECUTED');
    expect((await state(id)).status).toBe('SUSPENDED');
    const noRef = await w.api(w.op1, 'post', `/psp-configurations/${id}/approval-requests`, {
      status: 'ACTIVE',
    });
    expect(noRef.status).toBe(422);
    const r = await w.requestChange(w.op3, id, { status: 'ACTIVE', compliance_ref: 'KYB-2' });
    expect((await w.approve(w.op2, r.approval_request_id)).body.status).toBe('EXECUTED');
    expect((await state(id)).status).toBe('ACTIVE');
  });

  it('sans règle de frais : l’approbation échoue (FAILED), la configuration reste DRAFT', async () => {
    const id = await w.createConfig(w.op1);
    const r = await w.requestChange(w.op1, id, { status: 'ACTIVE', compliance_ref: 'KYB' });
    const res = await w.approve(w.op2, r.approval_request_id);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.failure_reason).toMatch(/règle de frais PSP_CONFIGURATION/);
    expect((await state(id)).status).toBe('DRAFT');
  });

  it('même auteur et valideur : refusé, demande PENDING, configuration inchangée', async () => {
    const id = await w.createConfig(w.op1);
    await w.addFeeRule(w.op1, id);
    const r = await w.requestChange(w.op2, id, { status: 'ACTIVE', compliance_ref: 'KYB' });
    const res = await w.approve(w.op2, r.approval_request_id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await request(id)).status).toBe('PENDING');
    expect((await state(id)).status).toBe('DRAFT');
  });

  it('le créateur de la configuration ne l’active pas lui-même (deux personnes)', async () => {
    const id = await w.createConfig(w.op1);
    await w.addFeeRule(w.op1, id);
    const r = await w.requestChange(w.op2, id, { status: 'ACTIVE', compliance_ref: 'KYB' });
    const res = await w.approve(w.op1, r.approval_request_id);
    expect(res.body.status).toBe('FAILED');
    expect((await state(id)).status).toBe('DRAFT');
  });

  it('transitions illégales : 409 ; rôle non OPERATOR_ADMIN : 403 ; autre prestataire : 404', async () => {
    const draft = await w.createConfig(w.op1);
    const call = (who: typeof w.op1, id: string, body: object) =>
      w.api(who, 'post', `/psp-configurations/${id}/approval-requests`, body);
    expect((await call(w.op1, draft, { status: 'SUSPENDED' })).status).toBe(409);
    const active = await w.activeConfig();
    expect((await call(w.op1, active, { status: 'ACTIVE', compliance_ref: 'K' })).status).toBe(409);
    expect((await call(w.org1, draft, { status: 'ACTIVE', compliance_ref: 'K' })).status).toBe(403);
    expect((await call(w.opBAdmin, draft, { status: 'ACTIVE', compliance_ref: 'K' })).status).toBe(
      404,
    );
    expect(
      (await call(w.op1, randomUUID(), { status: 'ACTIVE', compliance_ref: 'K' })).status,
    ).toBe(404);
    expect((await call(w.op1, draft, { status: 'ACTIVE', compliance_ref: 'K', x: 1 })).status).toBe(
      422,
    );
  });

  it('deux demandes concurrentes : une seule s’exécute, l’autre FAILED', async () => {
    const id = await w.createConfig(w.op1);
    await w.addFeeRule(w.op1, id);
    const a = await w.requestChange(w.op1, id, { status: 'ACTIVE', compliance_ref: 'A' });
    const b = await w.requestChange(w.op3, id, { status: 'ACTIVE', compliance_ref: 'B' });
    expect((await w.approve(w.op2, a.approval_request_id)).body.status).toBe('EXECUTED');
    expect((await w.approve(w.op2, b.approval_request_id)).body.status).toBe('FAILED');
    expect((await state(id)).compliance_ref).toBe('A');
  });

  it('défaut unique : une seconde configuration par défaut du même moyen ne s’active pas', async () => {
    await w.activeConfig({ is_default: true, method: 'ORANGE_MONEY', provider: 'ORANGE_MONEY' });
    const id = await w.createConfig(w.op1, {
      is_default: true,
      method: 'ORANGE_MONEY',
      provider: 'ORANGE_MONEY',
    });
    await w.addFeeRule(w.op1, id);
    const r = await w.requestChange(w.op1, id, { status: 'ACTIVE', compliance_ref: 'K' });
    expect((await w.approve(w.op2, r.approval_request_id)).body.status).toBe('FAILED');
    expect((await state(id)).status).toBe('DRAFT');
  });

  it('aucune activation sans demande approuvée : la base refuse l’appel direct, aucune route de statut', async () => {
    const id = await w.createConfig(w.op1);
    await w.addFeeRule(w.op1, id);
    const r = await w.requestChange(w.op1, id, { status: 'ACTIVE', compliance_ref: 'K' });
    const { TenantTx } = await import('../../../src/db/tenant-tx');
    const tx = w.app.get(TenantTx);
    await expect(
      tx.run(w.fx.parties.OPE, (c) =>
        c.query('SELECT activate_psp_configuration($1, $2)', [id, r.approval_request_id]),
      ),
    ).rejects.toMatchObject({ code: 'CL023' });
    await expect(
      tx.run(w.fx.parties.OPE, (c) =>
        c.query(`UPDATE psp_configuration SET status = 'ACTIVE' WHERE psp_configuration_id = $1`, [
          id,
        ]),
      ),
    ).rejects.toBeDefined();
    expect((await state(id)).status).toBe('DRAFT');
    for (const method of ['patch', 'put'] as const)
      expect(
        (await w.api(w.op1, method, `/psp-configurations/${id}`, { status: 'ACTIVE' })).status,
      ).toBe(404);
    expect(org).toBeDefined();
  });
});
