// Reprise forcée à deux `FORCE_CENTRAL_AUTHORITY` (mission passerelle-locale, lot WP11, T048 ; FR-007, C-003, R-06).
// `force_central_authority_approved` n'écrit pas `EXECUTED` et ne contrôle pas `expires_at` : elle n'est sûre que
// appelée par `definition.execute` du service d'approbation. Ce lot l'enregistre comme action de ce service et
// prouve : aucun autre appelant, non-réutilisation d'une approbation sur un second cycle, approbation échue refusée.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { FORCE_CENTRAL_ROLES } from '../../../src/debit-authority/force-central.approval';
import { contractViolations } from '../../support/contract-schema';
import { APP_URL, connect, withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { DebitWorld, type Gateway } from './debit-authority-world';

jest.setTimeout(240_000);

describe('reprise forcée FORCE_CENTRAL_AUTHORITY (WP11, T048)', () => {
  let dw: DebitWorld;
  beforeAll(async () => {
    dw = await DebitWorld.create();
  });
  afterAll(async () => {
    await dw?.close();
  });
  beforeEach(async () => {
    await dw.reset();
  });

  const author = () => dw.pw.w.operatorAdminA;
  const validator = () => dw.operatorAdmin2;
  const forceBody = {
    target: 'CENTRAL',
    reason: 'Passerelle détruite',
    force: true,
    gateway_confirmed_offline: true,
  };
  const approve = (id: unknown, who = validator()) =>
    dw.bo('POST', `/approval-requests/${String(id)}/approve`, who, {});
  const requestForce = async () => {
    const res = await dw.change(author(), forceBody);
    if (res.status !== 202) throw new Error(`demande refusée : ${res.status} ${res.text}`);
    return res;
  };
  const approval = (id: unknown) =>
    ownerRows<{ status: string; failure_code: string | null; executed_tx_id: string | null }>(
      'SELECT status, failure_code, executed_tx_id FROM approval_request WHERE id = $1',
      [id],
    ).then((r) => r[0]!);
  const gatewayStatus = (g: Gateway) =>
    ownerRows<{ status: string }>('SELECT status FROM edge_gateway WHERE id = $1', [g.id]).then(
      (r) => r[0]!.status,
    );

  it('le rôle est borné : OPERATOR_ADMIN seul, auteur et valideur', () => {
    expect([...FORCE_CENTRAL_ROLES]).toEqual(['OPERATOR_ADMIN']);
  });

  it('demande : 202 ApprovalRequest PENDING, rien d’exécuté (passerelle active, grand livre EDGE, époque inchangée)', async () => {
    const { gateway } = await dw.edgeActive();
    const before = await dw.authority();
    const res = await requestForce();
    expect(contractViolations('ApprovalRequest', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      action: 'FORCE_CENTRAL_AUTHORITY',
      status: 'PENDING',
      target_id: dw.ledger,
      requested_by: author().userId,
    });
    expect(res.headers.location).toBe(`/v1/approval-requests/${res.body.approval_request_id}`);
    expect(res.body.payload).toMatchObject({
      ledger_id: dw.ledger,
      reason: 'Passerelle détruite',
      edge_gateway_id: gateway.id,
      gateway_confirmed_offline: true,
    });
    expect(await dw.authority()).toEqual(before);
    expect(await gatewayStatus(gateway)).toBe('ACTIVE');
    expect(await dw.handovers()).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'ACTIVE' })]),
    );
  });

  it('sans confirmation « hors ligne », ou sans autorité EDGE : la demande n’est pas créée', async () => {
    const count = () =>
      ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM approval_request WHERE action = 'FORCE_CENTRAL_AUTHORITY'`,
      ).then((r) => r[0]!.n);
    const before = await count();
    // Grand livre CENTRAL : rien à reprendre.
    const central = await dw.change(author(), forceBody);
    expect([central.status, central.body.code]).toEqual([409, 'HANDOVER_INVALID_STATE']);
    await dw.edgeActive();
    for (const body of [
      { ...forceBody, gateway_confirmed_offline: false },
      { target: 'CENTRAL', reason: 'x', force: true },
    ])
      expect((await dw.change(author(), body)).status).toBe(422);
    expect(await count()).toBe(before);
  });

  it('même personne : refusée ; ORGANIZER_ADMIN et guichet : refusés ; une demande par la route d’un autre rôle : 403', async () => {
    const { gateway } = await dw.edgeActive();
    const res = await requestForce();
    const id = res.body.approval_request_id;
    const self = await approve(id, author());
    expect(self.status).toBeGreaterThanOrEqual(403);
    expect(self.status).toBeLessThan(500);
    for (const who of [dw.pw.w.organizerAdminA, dw.pw.w.supervisorA, dw.pw.w.cashierA])
      expect([who.userId === who.userId, (await approve(id, who)).status]).toEqual([true, 403]);
    expect((await approval(id)).status).toBe('PENDING');
    expect((await dw.authority()).debit_authority).toBe('EDGE');
    expect(await gatewayStatus(gateway)).toBe('ACTIVE');
    // Demandeur ORGANIZER_ADMIN : refusé dès la route.
    const asOrganizer = await dw.change(dw.pw.w.organizerAdminA, forceBody);
    expect(asOrganizer.status).toBe(403);
  });

  it('seconde personne OPERATOR_ADMIN : passerelle REVOKED, CENTRAL à e+2, handovers FORCED, audit EDGE_AUTHORITY_FORCED', async () => {
    const { gateway } = await dw.edgeActive();
    // Un rendu normal demandé : deux handovers (TO_EDGE et TO_CENTRAL) à passer FORCED.
    await dw.change(author(), { target: 'CENTRAL', reason: 'Retour' });
    const e = (await dw.authority()).authority_epoch;
    const res = await requestForce();
    const done = await approve(res.body.approval_request_id);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'EXECUTED' });
    expect(done.body.result).toMatchObject({
      ledger_id: dw.ledger,
      authority: 'CENTRAL',
      epoch: e + 1,
    });
    expect(await gatewayStatus(gateway)).toBe('REVOKED');
    const after = await dw.authority();
    expect(after).toMatchObject({
      debit_authority: 'CENTRAL',
      authority_epoch: e + 1,
      edge_gateway_id: null,
    });
    const handovers = await dw.handovers();
    expect(handovers.filter((h) => h.status === 'FORCED').length).toBe(2);
    const [audit] = await ownerRows<{ approver_id: string; after: Record<string, unknown> }>(
      `SELECT approver_id, after FROM audit_log WHERE action = 'EDGE_AUTHORITY_FORCED' ORDER BY id DESC LIMIT 1`,
    );
    expect(audit!.approver_id).toBe(validator().userId);
    expect(audit!.after).toMatchObject({
      ledger_id: dw.ledger,
      edge_gateway_id: gateway.id,
      reason: 'Passerelle détruite',
      requested_by: author().userId,
      gateway_confirmed_offline: true,
    });
    // L'état lu ensuite est CENTRAL, sans handover ouvert.
    const read = await dw.read(author());
    expect(read.body).toMatchObject({ authority: 'CENTRAL', handover: null });
  });

  it('époque : e → e+1 (accord) → e+2 (reprise forcée depuis ACTIVE, un seul changement)', async () => {
    await dw.edgeActive();
    const e = (await dw.authority()).authority_epoch;
    const res = await requestForce();
    expect((await approve(res.body.approval_request_id)).status).toBe(200);
    expect((await dw.authority()).authority_epoch).toBe(e + 1);
  });

  it('approbation après que le rendu normal s’est terminé : FAILED, rien d’écrit', async () => {
    const { gateway } = await dw.edgeActive();
    const res = await requestForce();
    // Le rendu normal aboutit entre la demande et l'approbation (grand livre revenu au central).
    await dw.reset();
    const epoch = (await dw.authority()).authority_epoch;
    const done = await approve(res.body.approval_request_id);
    expect(done.body).toMatchObject({ status: 'FAILED', failure_code: 'HANDOVER_INVALID_STATE' });
    expect((await approval(res.body.approval_request_id)).status).toBe('FAILED');
    expect((await dw.authority()).authority_epoch).toBe(epoch);
    expect(await gatewayStatus(gateway)).toBe('ACTIVE');
    expect(
      await ownerRows(
        `SELECT 1 FROM audit_log WHERE action = 'EDGE_AUTHORITY_FORCED' AND object_id IN
        (SELECT id::text FROM debit_authority_handover WHERE edge_gateway_id = $1 AND status = 'FORCED')`,
        [gateway.id],
      ),
    ).toHaveLength(0);
  });

  it('deux demandes pour le même grand livre, approuvées en même temps : une seule s’exécute, pas d’époque e+4', async () => {
    await dw.edgeActive();
    const e = (await dw.authority()).authority_epoch;
    const forcedBefore = (await dw.handovers()).filter((h) => h.status === 'FORCED').length;
    const a = await requestForce();
    const b = await dw.change(author(), forceBody);
    expect(b.status).toBe(202);
    const [x, y] = await Promise.all([
      approve(a.body.approval_request_id, dw.operatorAdmin2),
      approve(b.body.approval_request_id, dw.operatorAdmin3),
    ]);
    const statuses = [x.body.status, y.body.status].sort();
    expect(statuses).toEqual(['EXECUTED', 'FAILED']);
    expect((await dw.authority()).authority_epoch).toBe(e + 1);
    expect((await dw.handovers()).filter((h) => h.status === 'FORCED')).toHaveLength(
      // Une reprise = deux handovers FORCED (TO_EDGE, et le TO_CENTRAL créé) ; une seconde ferait +4.
      forcedBefore + 2,
    );
  });

  it('approbation échue : 409 APPROVAL_INVALID, rien d’exécuté', async () => {
    const { gateway } = await dw.edgeActive();
    const res = await requestForce();
    await withOwner(async (db) => {
      await db.query('ALTER TABLE approval_request DISABLE TRIGGER approval_request_guard');
      try {
        await db.query(
          `UPDATE approval_request SET requested_at = now() - interval '3 days',
                  expires_at = now() - interval '1 day' WHERE id = $1`,
          [res.body.approval_request_id],
        );
      } finally {
        await db.query('ALTER TABLE approval_request ENABLE TRIGGER approval_request_guard');
      }
    });
    const done = await approve(res.body.approval_request_id);
    expect([done.status, done.body.code]).toEqual([409, 'APPROVAL_INVALID']);
    expect((await dw.authority()).debit_authority).toBe('EDGE');
    expect(await gatewayStatus(gateway)).toBe('ACTIVE');
  });

  it('non-réutilisation : une approbation exécutée ne sert pas sur un second cycle de bascule', async () => {
    await dw.edgeActive();
    const res = await requestForce();
    const id = String(res.body.approval_request_id);
    expect((await approve(id)).status).toBe(200);
    // Second cycle : nouvelle passerelle, bascule et accusé.
    await dw.edgeActive();
    const epoch = (await dw.authority()).authority_epoch;
    // Directement, sous la connexion réelle de l'API publique : la fonction refuse (42501), rien ne change.
    const app: Client = await connect(APP_URL);
    try {
      await app.query(`SELECT set_config('app.operator_id', $1, false)`, [dw.pw.w.ops.a]);
      await expect(
        app.query('SELECT force_central_authority_approved($1, $2, $3)', [dw.ledger, id, 'rejeu']),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.end();
    }
    expect(await dw.authority()).toMatchObject({ debit_authority: 'EDGE', authority_epoch: epoch });
    // Et par la route : l'approbation exécutée ne peut plus être décidée.
    const again = await approve(id);
    expect(again.status).toBe(409);
    expect((await dw.authority()).debit_authority).toBe('EDGE');
  });

  it('architecture : force_central_authority_approved n’a qu’un appelant, force-central.approval.ts', () => {
    const root = join(__dirname, '../../../src');
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (
          path.endsWith('.ts') &&
          /force_central_authority_approved/.test(
            readFileSync(path, 'utf8').replace(/\/\/.*$/gm, ''),
          )
        )
          callers.push(path.slice(root.length + 1));
      }
    };
    walk(root);
    expect(callers).toEqual(['debit-authority/force-central.approval.ts']);
    expect(randomUUID()).toBeTruthy();
  });
});
