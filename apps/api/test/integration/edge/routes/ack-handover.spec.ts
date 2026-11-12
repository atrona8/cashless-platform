// `ackEdgeHandover` (WP12, T052 ; FR-006, A03, A17, NFR-011) : GRANTED vers ACTIVE par l'enveloppe `edge_ack_handover`,
// accusé répété sans écriture, refus uniformes.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { connect, OWNER_URL } from '../../../support/db';
import {
  seedEdgeWorld,
  startEdge,
  type EdgeWorld,
  type RunningEdge,
} from '../../../support/edge-fixtures';
import {
  ackBody,
  applyReference,
  edgeSend,
  grant,
  handoverRow,
  ledgerEpoch,
  newGateway,
  problemShape,
} from './support';

jest.setTimeout(120_000);

describe('ackEdgeHandover', () => {
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

  const ack = (gw: { cert: never }, id: string, body: unknown) =>
    edgeSend(edge.port, 'POST', `/edge/handovers/${id}/ack`, { client: gw.cert, body });
  const auditRows = async (): Promise<number> =>
    Number(
      (
        await owner.query('SELECT count(*) AS n FROM audit_log WHERE operator_id = $1', [
          world.operatorId,
        ])
      ).rows[0].n,
    );

  it('GRANTED vers ACTIVE : 200, autorité EDGE, époque du grand livre, handover ACTIVE', async () => {
    const gw = await newGateway(owner, world);
    const granted = await grant(owner, world, gw);
    await applyReference(edge.port, gw, granted);
    const reply = await ack(gw as never, granted.id, ackBody(granted));
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      ledger_id: gw.ledgerId,
      authority: 'EDGE',
      epoch: await ledgerEpoch(owner, gw.ledgerId),
      edge_gateway_id: gw.id,
      handover: { handover_id: granted.id, direction: 'TO_EDGE', state: 'ACTIVE' },
    });
    expect((await handoverRow(owner, granted.id)).status).toBe('ACTIVE');
  });

  it('accusé répété (réponse perdue) : 200 avec le même état, sans écriture (A17)', async () => {
    const gw = await newGateway(owner, world);
    const granted = await grant(owner, world, gw);
    await applyReference(edge.port, gw, granted);
    const first = await ack(gw as never, granted.id, ackBody(granted));
    expect(first.status).toBe(200);
    const before = await handoverRow(owner, granted.id);
    const audits = await auditRows();
    const gateway = (
      await owner.query('SELECT reference_applied_seq FROM edge_gateway WHERE id=$1', [gw.id])
    ).rows[0];
    const second = await ack(gw as never, granted.id, ackBody(granted));
    expect(second.status).toBe(200);
    expect(second.json).toEqual(first.json);
    const after = await handoverRow(owner, granted.id);
    expect(after.updated_at).toEqual(before.updated_at);
    expect(after.edge_seq_at_activation).toBe(before.edge_seq_at_activation);
    expect(await auditRows()).toBe(audits);
    expect(
      (await owner.query('SELECT reference_applied_seq FROM edge_gateway WHERE id=$1', [gw.id]))
        .rows[0],
    ).toEqual(gateway);
  });

  it('mauvaise époque : 409 STALE_AUTHORITY_EPOCH ; après l’accusé, l’époque d’avant aussi', async () => {
    const gw = await newGateway(owner, world);
    const granted = await grant(owner, world, gw);
    await applyReference(edge.port, gw, granted);
    const wrong = await ack(
      gw as never,
      granted.id,
      ackBody(granted, { epoch: granted.epoch - 1 }),
    );
    expect(wrong.status).toBe(409);
    expect(wrong.json).toMatchObject({ code: 'STALE_AUTHORITY_EPOCH' });
    expect((await handoverRow(owner, granted.id)).status).toBe('GRANTED');
    expect((await ack(gw as never, granted.id, ackBody(granted))).status).toBe(200);
    const stale = await ack(
      gw as never,
      granted.id,
      ackBody(granted, { epoch: granted.epoch - 1 }),
    );
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: 'STALE_AUTHORITY_EPOCH' });
  });

  it('replicated_posting_id sous le filigrane : 409 EDGE_NOT_CAUGHT_UP', async () => {
    const gw = await newGateway(owner, world);
    const granted = await grant(owner, world, gw);
    await owner.query(
      'UPDATE debit_authority_handover SET watermark_posting_id = 50 WHERE id = $1',
      [granted.id],
    );
    await applyReference(edge.port, gw, granted);
    const low = await ack(gw as never, granted.id, ackBody(granted, { replicated_posting_id: 49 }));
    expect(low.status).toBe(409);
    expect(low.json).toMatchObject({ code: 'EDGE_NOT_CAUGHT_UP' });
    expect((await handoverRow(owner, granted.id)).status).toBe('GRANTED');
    const exact = await ack(
      gw as never,
      granted.id,
      ackBody(granted, { replicated_posting_id: 50 }),
    );
    expect(exact.status).toBe(200);
  });

  it('curseur change_seq en retard : 409 EDGE_NOT_CAUGHT_UP puis 200 après une page au curseur final', async () => {
    const gw = await newGateway(owner, world);
    const granted = await grant(owner, world, gw);
    expect(granted.referenceWatermark).toBeGreaterThan(0);
    const early = await ack(gw as never, granted.id, ackBody(granted));
    expect(early.status).toBe(409);
    expect(early.json).toMatchObject({ code: 'EDGE_NOT_CAUGHT_UP' });
    const partial = await edgeSend(
      edge.port,
      'GET',
      `/edge/replication-feed?after_posting_id=0&after_change_seq=${granted.referenceWatermark - 1}`,
      { client: gw.cert },
    );
    expect(partial.status).toBe(200);
    expect((await ack(gw as never, granted.id, ackBody(granted))).status).toBe(409);
    expect((await applyReference(edge.port, gw, granted)).status).toBe(200);
    expect((await ack(gw as never, granted.id, ackBody(granted))).status).toBe(200);
  });

  it('handover d’une autre passerelle, inconnu ou mal formé : même 409 HANDOVER_INVALID_STATE, mêmes octets', async () => {
    const mine = await newGateway(owner, world);
    const theirs = await newGateway(owner, world);
    const foreign = await grant(owner, world, theirs);
    const body = ackBody(foreign);
    const replies = [
      await ack(mine as never, foreign.id, body),
      await ack(mine as never, randomUUID(), body),
      await ack(mine as never, 'ho_31', body),
    ];
    for (const reply of replies) {
      expect(reply.status).toBe(409);
      expect(reply.json).toMatchObject({ code: 'HANDOVER_INVALID_STATE' });
    }
    expect(new Set(replies.map(problemShape)).size).toBe(1);
    expect((await handoverRow(owner, foreign.id)).status).toBe('GRANTED');
  });

  it('corps incomplet ou invalide : 422 VALIDATION_FAILED, jamais 500', async () => {
    const gw = await newGateway(owner, world);
    const granted = await grant(owner, world, gw);
    const bodies: unknown[] = [
      {},
      { epoch: granted.epoch },
      { replicated_posting_id: 1 },
      { epoch: '1', replicated_posting_id: 1 },
      { epoch: -1, replicated_posting_id: 1 },
      { epoch: 1.5, replicated_posting_id: 1 },
      { epoch: granted.epoch, replicated_posting_id: null },
      [],
    ];
    for (const body of bodies) {
      const reply = await ack(gw as never, granted.id, body);
      expect([reply.status, reply.json?.code]).toEqual([422, 'VALIDATION_FAILED']);
    }
    const garbage = await edgeSend(edge.port, 'POST', `/edge/handovers/${granted.id}/ack`, {
      client: gw.cert,
      raw: '{pas du json',
    });
    expect(garbage.status).toBeLessThan(500);
    expect((await handoverRow(owner, granted.id)).status).toBe('GRANTED');
  });

  it('passerelle STANDBY : refusée par l’enveloppe (jamais d’accusé), handover inchangé', async () => {
    const primary = await newGateway(owner, world);
    const granted = await grant(owner, world, primary);
    const standby = await newGateway(owner, world, {
      role: 'STANDBY',
      eventId: primary.eventId,
      ledgerId: primary.ledgerId,
    });
    const reply = await ack(standby as never, granted.id, ackBody(granted));
    expect([401, 409]).toContain(reply.status);
    expect((await handoverRow(owner, granted.id)).status).toBe('GRANTED');
  });
});
