// Les quatre commandes sur une vraie base (rôle cashless_edgeadmin) : refus de la base, rotation, échange, et ce que
// le rôle ne peut PAS faire. Base : DATABASE_URL_* de l'environnement (cashless_wp15 pour ce lot).
import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import type { Client } from 'pg';
import { connect, EDGEADMIN_URL, OWNER_URL } from '../../../apps/api/test/support/db';
import {
  addGateway,
  newEvent,
  seedEdgeWorld,
  type EdgeWorld,
} from '../../../apps/api/test/support/edge-fixtures';
import { main } from '../src/main';
import { capture, fileDeps, readIfExists, registerArgv, requestJson, tmp } from './support';
import { realDeps } from '../src/main';
import { writeFileSync } from 'node:fs';

describe('edge-admin sur une vraie base', () => {
  let owner: Client;
  let world: EdgeWorld;
  const env = { EDGE_CA: 'fake', DATABASE_URL_EDGEADMIN: EDGEADMIN_URL };

  const run = async (argv: string[]) => {
    const { io, got } = capture();
    const code = await main(argv, env, io, (e, i) => ({
      ...realDeps(e, i),
      ca: fileDeps(e, i, null as never).ca,
    }));
    return { code, got, text: [...got.out, ...got.err].join('\n') };
  };
  const registerReal = async (
    overrides: Record<string, string> = {},
    event = world.eventId,
    ledger = world.ledgerId,
  ) => {
    const serial = `GW-${randomUUID().slice(0, 8)}`;
    const dir = tmp();
    const argv = await registerArgv(
      dir,
      { serial },
      {
        serial,
        operator: world.operatorId,
        event,
        ledger,
        ...overrides,
      },
    );
    return { ...(await run(argv)), dir, serial };
  };
  const sha = (raw: string) => {
    return createHash('sha256')
      .update(new X509Certificate(JSON.parse(raw).client_cert_pem).raw)
      .digest();
  };

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    world = await seedEdgeWorld(owner);
  });
  afterAll(async () => {
    await owner?.end();
  });

  it("register : passerelle créée, alerte EDGE_REGISTERED et audit avec l'étiquette ; second PRIMARY refusé", async () => {
    const first = await registerReal({}, world.otherEventId, world.otherLedgerId);
    expect(first.code).toBe(0);
    const { rows } = await owner.query(
      `SELECT after FROM audit_log WHERE action = 'EDGE_GATEWAY_REGISTERED' AND operator_id = $1`,
      [world.operatorId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.at(-1).after).toMatchObject({
      alert: 'EDGE_REGISTERED',
      label: 'Awa Diop',
      serial: first.serial,
    });
    const second = await registerReal({}, world.otherEventId, world.otherLedgerId);
    expect(second.code).toBe(2);
    expect(second.text).toMatch(/Refus de la base/);
    const stranger = await registerReal({ operator: world.otherOperatorId });
    expect(stranger.code).toBe(2);
  });

  it('revoke avec un handover ouvert : refus de la base, « reprise forcée à deux »', async () => {
    const g = await addGateway(owner, world, world.eventId, { sha256: randomBytes(32) });
    await owner.query(
      `INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch, watermark_posting_id, requested_by)
       VALUES ($1, $2, $3, 'TO_EDGE', 'ACTIVE', 1, 0, $4)`,
      [world.operatorId, world.ledgerId, g, randomUUID()],
    );
    const r = await run([
      'revoke',
      '--gateway',
      g,
      '--operator',
      world.operatorId,
      '--reason',
      'perdue',
      '--by',
      'Awa Diop',
    ]);
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/reprise forcée à deux/);
    const { rows } = await owner.query(`SELECT status FROM edge_gateway WHERE id = $1`, [g]);
    expect(rows[0].status).not.toBe('REVOKED');
  });

  it('revoke : passerelle révoquée sans handover', async () => {
    const g = await addGateway(owner, world, world.otherEventId, {
      sha256: randomBytes(32),
      role: 'STANDBY',
    });
    const r = await run([
      'revoke',
      '--gateway',
      g,
      '--operator',
      world.operatorId,
      '--reason',
      'perdue',
      '--by',
      'Awa Diop',
    ]);
    expect(r.code).toBe(0);
    const { rows } = await owner.query(`SELECT status FROM edge_gateway WHERE id = $1`, [g]);
    expect(rows[0].status).toBe('REVOKED');
  });

  it("rotate-cert : l'ancienne empreinte est refusée par identify_edge_gateway", async () => {
    const fresh = await newEvent(owner, world);
    const serial = `GW-${randomUUID().slice(0, 8)}`;
    const dir = tmp();
    const argv = await registerArgv(
      dir,
      { serial, role: 'STANDBY' },
      {
        serial,
        role: 'STANDBY',
        operator: world.operatorId,
        event: fresh.eventId,
        ledger: fresh.ledgerId,
      },
    );
    const registered = await run(argv);
    expect(registered.text).not.toMatch(/Refus/);
    expect(registered.code).toBe(0);
    const enrol = readIfExists(join(dir, 'enrolment.json'))!;
    const oldSha = sha(enrol);
    const id = JSON.parse(enrol).gateway_id as string;
    expect((await owner.query(`SELECT 1 FROM identify_edge_gateway($1)`, [oldSha])).rowCount).toBe(
      1,
    );
    const reqFile = join(dir, 'request2.json');
    writeFileSync(reqFile, await requestJson({ serial, role: 'STANDBY' }));
    const out = join(dir, 'cert2.pem');
    const r = await run([
      'rotate-cert',
      '--gateway',
      id,
      '--operator',
      world.operatorId,
      '--request',
      reqFile,
      '--out',
      out,
      '--by',
      'Awa Diop',
    ]);
    expect(r.code).toBe(0);
    await expect(
      owner.query(`SELECT 1 FROM identify_edge_gateway($1)`, [oldSha]),
    ).rejects.toThrow();
  });

  it('swap-roles : rôles échangés, alerte EDGE_ROLE_CHANGED, délai qui repart', async () => {
    const { eventId } = await newEvent(owner, world);
    const a = await addGateway(owner, world, eventId, { sha256: randomBytes(32), role: 'PRIMARY' });
    const b = await addGateway(owner, world, eventId, { sha256: randomBytes(32), role: 'STANDBY' });
    const r = await run([
      'swap-roles',
      '--old',
      a,
      '--new',
      b,
      '--operator',
      world.operatorId,
      '--by',
      'Awa Diop',
    ]);
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/30 minutes|délai/);
    const roles = await owner.query(`SELECT id, role FROM edge_gateway WHERE id IN ($1, $2)`, [
      a,
      b,
    ]);
    expect(Object.fromEntries(roles.rows.map((x) => [x.id, x.role]))).toEqual({
      [a]: 'STANDBY',
      [b]: 'PRIMARY',
    });
    const alert = await owner.query(
      `SELECT 1 FROM audit_log WHERE action = 'EDGE_GATEWAY_ROLE_CHANGED' AND object_id = $1 AND after->>'alert' = 'EDGE_ROLE_CHANGED'`,
      [b],
    );
    expect(alert.rowCount).toBe(1);
  });

  it("le rôle cashless_edgeadmin ne peut rien d'autre", async () => {
    const admin = await connect(EDGEADMIN_URL);
    try {
      const denied = async (sql: string) => {
        await expect(admin.query(sql)).rejects.toMatchObject({ code: '42501' });
      };
      await denied('SELECT * FROM edge_gateway');
      await denied(`SELECT set_edge_gateway_role('${randomUUID()}', 'PRIMARY', 'x')`);
      await denied(
        `SELECT grant_edge_authority('${randomUUID()}', '${randomUUID()}', '${randomUUID()}')`,
      );
      await denied('SELECT * FROM audit_log');
    } finally {
      await admin.end();
    }
  });
});
