// Inscription par UNE personne (OP-N105, ADR-160) : l'alerte est levée à l'instant même, l'audit porte l'étiquette,
// et un échange de rôles lève aussi une alerte. Test de borne : sans alerte, cette suite est rouge.
import type { Client } from 'pg';
import { connect, OWNER_URL } from '../../../support/db';
import {
  addGateway,
  newEvent,
  seedEdgeWorld,
  type EdgeWorld,
} from '../../../support/edge-fixtures';
import { registerViaTool, runTool } from './packs-world';

describe("alerte d'inscription et d'échange (WP15)", () => {
  let owner: Client;
  let listener: Client;
  let world: EdgeWorld;
  const alerts: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    world = await seedEdgeWorld(owner);
    listener = await connect(OWNER_URL);
    listener.on('notification', (n) => {
      if (n.channel === 'edge_alert') alerts.push(JSON.parse(n.payload ?? '{}'));
    });
    await listener.query('LISTEN edge_alert');
  });
  afterAll(async () => {
    await listener?.end();
    await owner?.end();
  });

  it("une personne inscrit : alerte EDGE_REGISTERED aussitôt, audit EDGE_GATEWAY_REGISTERED avec l'étiquette", async () => {
    const event = await newEvent(owner, world);
    const reg = await registerViaTool(world, event, 'PRIMARY');
    expect(reg.out.join('\n')).toMatch(/EDGE_REGISTERED/);
    await new Promise((r) => setTimeout(r, 200));
    expect(alerts).toContainEqual(
      expect.objectContaining({ alert: 'EDGE_REGISTERED', gateway_id: reg.gatewayId }),
    );
    const { rows } = await owner.query(
      `SELECT after FROM audit_log WHERE action = 'EDGE_GATEWAY_REGISTERED' AND object_id = $1`,
      [reg.gatewayId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({
      alert: 'EDGE_REGISTERED',
      label: 'Awa Diop',
      role: 'PRIMARY',
    });
  });

  it('swap-roles lève une alerte EDGE_ROLE_CHANGED', async () => {
    const event = await newEvent(owner, world);
    const a = await addGateway(owner, world, event.eventId, {
      sha256: Buffer.from(crypto.getRandomValues(new Uint8Array(32))),
      role: 'PRIMARY',
    });
    const b = await addGateway(owner, world, event.eventId, {
      sha256: Buffer.from(crypto.getRandomValues(new Uint8Array(32))),
      role: 'STANDBY',
    });
    const r = await runTool([
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
    await new Promise((res) => setTimeout(res, 200));
    expect(alerts).toContainEqual(
      expect.objectContaining({ alert: 'EDGE_ROLE_CHANGED', gateway_id: b }),
    );
  });
});
