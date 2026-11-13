// Aucun colis à une STANDBY non promue (OP-N105) : ni éligibilité, ni clé de contenu servie dans le flux de
// réplication ; promue puis 30 minutes écoulées : servi. Le flux est lu avec le rôle `cashless_edge`.
import type { Client } from 'pg';
import { connect, OWNER_URL } from '../../../support/db';
import {
  addGateway,
  newEvent,
  seedEdgeWorld,
  type EdgeWorld,
} from '../../../support/edge-fixtures';
import {
  awaiting,
  backdate,
  depositContentKey,
  registerViaTool,
  runTool,
  servedPackKey,
} from './packs-world';

describe('STANDBY sans colis (WP15)', () => {
  let owner: Client;
  let world: EdgeWorld;
  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    world = await seedEdgeWorld(owner);
  });
  afterAll(async () => owner?.end());

  it('STANDBY inscrite depuis une heure : non éligible, rien dans le flux ; promue : servie après le délai', async () => {
    const event = await newEvent(owner, world);
    const primary = await addGateway(owner, world, event.eventId, {
      sha256: Buffer.from(crypto.getRandomValues(new Uint8Array(32))),
      role: 'PRIMARY',
    });
    const standby = await registerViaTool(world, event, 'STANDBY');
    await backdate(owner, standby.gatewayId, 3600);
    await backdate(owner, primary, 3600);
    expect(await awaiting()).not.toContain(standby.gatewayId);
    // Migration 0072 (défaut C) : aucun dépôt hors de la fenêtre où la page sert le colis.
    const refused = /délai de garde non écoulé ou passerelle non principale/;
    const deposit = (): Promise<void> =>
      depositContentKey(world, standby.gatewayId, standby.agreementKey);
    await expect(deposit()).rejects.toThrow(refused); // STANDBY, même après une heure
    expect(await servedPackKey(world, standby.gatewayId)).toBeNull();

    const swap = await runTool([
      'swap-roles',
      '--old',
      primary,
      '--new',
      standby.gatewayId,
      '--operator',
      world.operatorId,
      '--by',
      'Awa Diop',
    ]);
    expect(swap.code).toBe(0);
    await expect(deposit()).rejects.toThrow(refused); // promue à l'instant : délai
    expect(await servedPackKey(world, standby.gatewayId)).toBeNull();
    await backdate(owner, standby.gatewayId, 1799);
    await expect(deposit()).rejects.toThrow(refused); // 29 min 59 s
    expect(await servedPackKey(world, standby.gatewayId)).toBeNull();
    await backdate(owner, standby.gatewayId, 1801);
    await deposit();
    expect(await servedPackKey(world, standby.gatewayId)).not.toBeNull();
  });
});
