// Délai de 30 minutes avant les colis (OP-N105) : jamais de colis à 29 min 59 s, colis à 30 min 1 s ; un échange de
// rôles remet le délai à zéro ; le réglage ne peut pas être nul (la base le refuse : un processus ne le change pas).
import type { Client } from 'pg';
import { connect, EDGEADMIN_URL, OWNER_URL } from '../../../support/db';
import { newEvent, seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import { awaiting, backdate, registerViaTool, runTool } from './packs-world';

describe('délai avant les colis (WP15)', () => {
  let owner: Client;
  let world: EdgeWorld;
  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    world = await seedEdgeWorld(owner);
  });
  afterAll(async () => owner?.end());

  it('aucun colis à 29 min 59 s, colis à 30 min 1 s', async () => {
    const event = await newEvent(owner, world);
    const { gatewayId } = await registerViaTool(world, event, 'PRIMARY');
    expect(await awaiting()).not.toContain(gatewayId); // inscrite à l'instant
    await backdate(owner, gatewayId, 1799);
    expect(await awaiting()).not.toContain(gatewayId);
    await backdate(owner, gatewayId, 1801);
    expect(await awaiting()).toContain(gatewayId);
  });

  it('swap-roles remet le délai à zéro pour la nouvelle PRIMARY', async () => {
    const event = await newEvent(owner, world);
    const primary = await registerViaTool(world, event, 'PRIMARY');
    const second = (await registerViaTool(world, event, 'STANDBY')).gatewayId;
    await backdate(owner, primary.gatewayId, 7200);
    await backdate(owner, second, 7200);
    expect(await awaiting()).toContain(primary.gatewayId);
    const r = await runTool([
      'swap-roles',
      '--old',
      primary.gatewayId,
      '--new',
      second,
      '--operator',
      world.operatorId,
      '--by',
      'Awa Diop',
    ]);
    expect(r.code).toBe(0);
    const now = await awaiting();
    expect(now).not.toContain(second);
    expect(now).not.toContain(primary.gatewayId); // devenue STANDBY
    await backdate(owner, second, 1801);
    expect(await awaiting()).toContain(second);
  });

  it('un délai nul est refusé par la base (jamais de colis immédiat)', async () => {
    const admin = await connect(EDGEADMIN_URL);
    try {
      await admin.query('BEGIN');
      await expect(
        admin.query(`SELECT set_edge_setting('pack_delay_seconds', 0, 'test')`),
      ).rejects.toBeDefined();
      await admin.query('ROLLBACK');
    } finally {
      await admin.end();
    }
  });
});
