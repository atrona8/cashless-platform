// Cloisonnement des trois routes WP12 (NFR-011) : passerelle d'un autre événement ou d'un autre prestataire,
// révoquée, certificat de terminal, sans certificat. Aucune distinction entre « inconnu » et « étranger ».
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { connect, OWNER_URL } from '../../../support/db';
import {
  edgeTls,
  seedEdgeWorld,
  startEdge,
  type ClientCert,
  type EdgeWorld,
  type RunningEdge,
} from '../../../support/edge-fixtures';
import {
  ackBody,
  edgeSend,
  grant,
  handoverRow,
  newGateway,
  problemShape,
  requestRelease,
  type Gw,
} from './support';

jest.setTimeout(120_000);

describe('routes WP12 : cloisonnement', () => {
  let owner: Client;
  let world: EdgeWorld;
  let edge: RunningEdge;

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    world = await seedEdgeWorld(owner);
    edge = await startEdge();
  });
  afterAll(async () => {
    await edge?.close();
    await owner?.end();
  });

  const release = (epoch: number) => ({
    epoch,
    final_edge_seq: 1,
    last_chain_hash: '11'.repeat(32),
    operations_count: 1,
  });
  const routes = (id: string, epoch: number) =>
    [
      ['POST', `/edge/handovers/${id}/ack`, { epoch, replicated_posting_id: 0 }],
      ['POST', `/edge/handovers/${id}/release`, release(epoch)],
      ['GET', '/edge/replication-feed?after_posting_id=0', undefined],
    ] as const;

  it('sans certificat, certificat inconnu, certificat de terminal : 401 sur les trois routes', async () => {
    const { deviceCa, edgeCa } = await edgeTls();
    const terminal: ClientCert = await deviceCa.issue('terminal-x');
    const unknown: ClientCert = await edgeCa.issue('inconnue');
    for (const client of [undefined, terminal, unknown]) {
      for (const [method, path, body] of routes(randomUUID(), 1)) {
        const reply = await edgeSend(edge.port, method, path, {
          ...(client ? { client } : {}),
          ...(body ? { body } : {}),
        }).catch((error: Error) => ({ status: 0, body: error.message }));
        // Refus à la poignée de main (statut 0) ou 401 : jamais une réponse métier.
        expect([0, 401]).toContain(reply.status);
      }
    }
  });

  it('passerelle révoquée : 401 sur les trois routes', async () => {
    const gw = await newGateway(owner, world, { status: 'REVOKED' });
    for (const [method, path, body] of routes(randomUUID(), 1)) {
      const reply = await edgeSend(edge.port, method, path, {
        client: gw.cert,
        ...(body ? { body } : {}),
      });
      expect(reply.status).toBe(401);
    }
  });

  it('handover d’un autre événement, d’un autre prestataire ou inconnu : mêmes octets 409, rien ne change', async () => {
    const mine = await newGateway(owner, world);
    const sameOperator = await newGateway(owner, world);
    const granted = await grant(owner, world, sameOperator);
    const foreignWorld = { ...world, operatorId: world.otherOperatorId };
    const foreignEvent = await owner.query<{ id: string }>(
      'SELECT e.id FROM event e WHERE e.operator_id = $1 LIMIT 1',
      [world.otherOperatorId],
    );
    const foreign: Gw = await newGateway(owner, foreignWorld, {
      eventId: foreignEvent.rows[0]!.id,
      ledgerId: world.foreignLedgerId,
    });
    const foreignGrant = await grant(owner, foreignWorld, foreign);
    const targets = [granted.id, foreignGrant.id, randomUUID()];
    for (const route of ['ack', 'release'] as const) {
      const shapes: string[] = [];
      for (const id of targets) {
        const body =
          route === 'ack'
            ? { epoch: granted.epoch, replicated_posting_id: 0 }
            : release(granted.epoch);
        const reply = await edgeSend(edge.port, 'POST', `/edge/handovers/${id}/${route}`, {
          client: mine.cert,
          body,
        });
        expect(reply.status).toBe(409);
        expect(reply.json).toMatchObject({ code: 'HANDOVER_INVALID_STATE' });
        shapes.push(problemShape(reply));
      }
      expect(new Set(shapes).size).toBe(1);
    }
    expect((await handoverRow(owner, granted.id)).status).toBe('GRANTED');
    expect((await handoverRow(owner, foreignGrant.id)).status).toBe('GRANTED');
  });

  it('rendu d’un handover étranger : aucun passage à RELEASING', async () => {
    const mine = await newGateway(owner, world);
    const theirs = await newGateway(owner, world);
    const granted = await grant(owner, world, theirs);
    await edgeSend(edge.port, 'POST', `/edge/handovers/${granted.id}/ack`, {
      client: theirs.cert,
      body: ackBody(granted),
    }).catch(() => undefined);
    const ask = await requestRelease(owner, world, theirs).catch(() => null);
    if (!ask) return;
    const reply = await edgeSend(edge.port, 'POST', `/edge/handovers/${ask.id}/release`, {
      client: mine.cert,
      body: release(ask.epoch),
    });
    expect(reply.status).toBe(409);
    expect((await handoverRow(owner, ask.id)).status).toBe('RELEASE_REQUESTED');
  });
});
