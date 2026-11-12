// `releaseEdgeHandover` (WP12, T053 ; FR-008, A05, R-08, A17) : RELEASING validé AVANT la vérification, conservé quand
// elle échoue (relu d'une AUTRE connexion), compte d'opérations par cycle, chaîne, continuité.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import type { Client } from 'pg';
import { connect, OWNER_URL } from '../../../support/db';
import {
  seedEdgeWorld,
  startEdge,
  type EdgeWorld,
  type RunningEdge,
} from '../../../support/edge-fixtures';
import {
  activate,
  chainAfter,
  edgeSend,
  handoverRow,
  jumpRegistry,
  ledgerEpoch,
  newGateway,
  recordOps,
  requestRelease,
  type Gw,
} from './support';

jest.setTimeout(120_000);

describe('releaseEdgeHandover', () => {
  let owner: Client;
  let reader: Client;
  let world: EdgeWorld;
  let edge: RunningEdge;

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    reader = await connect(OWNER_URL);
    world = await seedEdgeWorld(owner);
    edge = await startEdge();
  });
  afterAll(async () => {
    await edge?.close();
    await reader?.end();
    await owner?.end();
  });

  const release = (gw: Gw, id: string, body: unknown) =>
    edgeSend(edge.port, 'POST', `/edge/handovers/${id}/release`, { client: gw.cert, body });
  const declaration = (epoch: number, finalSeq: number, hash: string, ops: number) => ({
    epoch,
    final_edge_seq: finalSeq,
    last_chain_hash: hash,
    operations_count: ops,
  });
  /** État lu par une AUTRE connexion : seul ce qui est validé y est visible. */
  const committed = (id: string) => handoverRow(reader, id);

  async function cycle(gw: Gw) {
    await activate(owner, world, edge.port, gw);
    return requestRelease(owner, world, gw);
  }

  it('chemin heureux : RELEASE_REQUESTED vers COMPLETED, CENTRAL, époque +1 (+2 depuis l’origine)', async () => {
    const gw = await newGateway(owner, world);
    const origin = await ledgerEpoch(owner, gw.ledgerId);
    const ask = await cycle(gw);
    const hash = await recordOps(owner, world, gw, 1, 3);
    const reply = await release(gw, ask.id, declaration(ask.epoch, 3, hash, 3));
    expect(reply.status).toBe(200);
    const epoch = await ledgerEpoch(owner, gw.ledgerId);
    expect(epoch).toBe(origin + 2);
    expect(reply.json).toMatchObject({
      ledger_id: gw.ledgerId,
      authority: 'CENTRAL',
      epoch,
      handover: {
        handover_id: ask.id,
        direction: 'TO_CENTRAL',
        state: 'COMPLETED',
        final_edge_seq: 3,
      },
    });
    expect((await committed(ask.id)).status).toBe('COMPLETED');
  });

  it('opérations manquantes : 409 EDGE_NOT_CAUGHT_UP avec missing_edge_seqs, RELEASING en base (autre connexion)', async () => {
    const gw = await newGateway(owner, world);
    const ask = await cycle(gw);
    const partial = await recordOps(owner, world, gw, 1, 3);
    // La passerelle déclare SA chaîne complète (5 opérations) alors que le central n'en a reçu que 3.
    const hash = chainAfter(gw, partial, 4, 5);
    const reply = await release(gw, ask.id, declaration(ask.epoch, 5, hash, 5));
    expect(reply.status).toBe(409);
    expect(reply.json).toMatchObject({ code: 'EDGE_NOT_CAUGHT_UP', missing_edge_seqs: [4, 5] });
    // Le temps 1 est validé même si le temps 2 échoue : une implémentation à transaction unique serait rouge ici.
    expect((await committed(ask.id)).status).toBe('RELEASING');
    expect(await ledgerEpoch(reader, gw.ledgerId)).toBe(ask.epoch);
    // La passerelle reprend la vidange puis recommence : même déclaration, cette fois complète.
    await recordOps(owner, world, gw, 4, 5);
    const again = await release(gw, ask.id, declaration(ask.epoch, 5, hash, 5));
    expect(again.status).toBe(200);
    expect((await committed(ask.id)).status).toBe('COMPLETED');
  });

  it('chaîne différente : 409 CHAIN_BROKEN, alerte EDGE_CHAIN_BROKEN sans empreinte, RELEASING conservé', async () => {
    const gw = await newGateway(owner, world);
    const ask = await cycle(gw);
    const hash = await recordOps(owner, world, gw, 1, 2);
    const wrong = '0'.repeat(63) + (hash.endsWith('0') ? '1' : '0');
    const errors = jest.spyOn(Logger.prototype, 'error');
    try {
      const reply = await release(gw, ask.id, declaration(ask.epoch, 2, wrong, 2));
      expect(reply.status).toBe(409);
      expect(reply.json).toMatchObject({ code: 'CHAIN_BROKEN' });
      const alerts = errors.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('EDGE_CHAIN_BROKEN'));
      expect(alerts).toHaveLength(1);
      expect(JSON.parse(alerts[0]!)).toEqual({
        event: 'edge.alert',
        alert: 'EDGE_CHAIN_BROKEN',
        gateway_id: gw.id,
        handover_id: ask.id,
      });
      expect(alerts[0]).not.toContain(wrong);
      expect(alerts[0]).not.toContain(hash);
    } finally {
      errors.mockRestore();
    }
    expect((await committed(ask.id)).status).toBe('RELEASING');
  });

  it('deux cycles : operations_count du second cycle = 40 pour final_edge_seq 4251 (A05)', async () => {
    // Deux passerelles identiques : l'une déclare le compte du cycle (40), l'autre recopie le compte total (4251).
    for (const copied of [false, true]) {
      const gw = await newGateway(owner, world);
      // Cycle 1 : 4211 opérations déjà vidangées (registre posé par l'amorçage), puis rendu.
      const first = await cycle(gw);
      const hash1 = await jumpRegistry(owner, gw, 4211);
      const done1 = await release(gw, first.id, declaration(first.epoch, 4211, hash1, 4211));
      expect(done1.status).toBe(200);
      // Cycle 2 : la numérotation et la chaîne continuent ; l'accusé pose edge_seq_at_activation = 4211.
      const second = await cycle(gw);
      const hash2 = await recordOps(owner, world, gw, 4212, 4251);
      const reply = await release(
        gw,
        second.id,
        declaration(second.epoch, 4251, hash2, copied ? 4251 : 40),
      );
      if (copied) {
        expect([reply.status, reply.json?.code]).toEqual([409, 'CHAIN_BROKEN']);
        expect((await committed(second.id)).status).toBe('RELEASING');
      } else {
        expect(reply.status).toBe(200);
        expect(reply.json).toMatchObject({
          authority: 'CENTRAL',
          handover: { state: 'COMPLETED' },
        });
      }
    }
  });

  it('operations_count faux : CHAIN_BROKEN, sans que l’API ne recode la règle', async () => {
    const gw = await newGateway(owner, world);
    const ask = await cycle(gw);
    const hash = await recordOps(owner, world, gw, 1, 4);
    for (const ops of [3, 5, 0]) {
      const reply = await release(gw, ask.id, declaration(ask.epoch, 4, hash, ops));
      expect([reply.status, reply.json?.code]).toEqual([409, 'CHAIN_BROKEN']);
    }
    expect((await committed(ask.id)).status).toBe('RELEASING');
  });

  it('époque différente : 409 STALE_AUTHORITY_EPOCH, handover inchangé', async () => {
    const gw = await newGateway(owner, world);
    const ask = await cycle(gw);
    const hash = await recordOps(owner, world, gw, 1, 1);
    const reply = await release(gw, ask.id, declaration(ask.epoch - 1, 1, hash, 1));
    expect([reply.status, reply.json?.code]).toEqual([409, 'STALE_AUTHORITY_EPOCH']);
    expect((await committed(ask.id)).status).toBe('RELEASE_REQUESTED');
  });

  it('rejeu après réussite : refus 409 uniforme, aucune écriture (limite consignée : pas de 200 idempotent)', async () => {
    const gw = await newGateway(owner, world);
    const ask = await cycle(gw);
    const hash = await recordOps(owner, world, gw, 1, 2);
    expect((await release(gw, ask.id, declaration(ask.epoch, 2, hash, 2))).status).toBe(200);
    const before = await committed(ask.id);
    const epoch = await ledgerEpoch(owner, gw.ledgerId);
    const replay = await release(gw, ask.id, declaration(ask.epoch, 2, hash, 2));
    expect(replay.status).toBe(409);
    expect(['STALE_AUTHORITY_EPOCH', 'HANDOVER_INVALID_STATE']).toContain(replay.json?.code);
    expect(await committed(ask.id)).toEqual(before);
    expect(await ledgerEpoch(owner, gw.ledgerId)).toBe(epoch);
  });

  it('jamais RELEASE_REQUESTED vers COMPLETED d’un coup : un refus laisse RELEASING, pas COMPLETED', async () => {
    const gw = await newGateway(owner, world);
    const ask = await cycle(gw);
    const reply = await release(gw, ask.id, declaration(ask.epoch, 7, '1'.repeat(64), 7));
    expect(reply.status).toBe(409);
    expect((await committed(ask.id)).status).toBe('RELEASING');
  });

  it('handover d’accusé (TO_EDGE) ou inconnu sur la route de rendu : 409 HANDOVER_INVALID_STATE', async () => {
    const gw = await newGateway(owner, world);
    const granted = await activate(owner, world, edge.port, gw);
    const hash = '2'.repeat(64);
    const toEdge = await release(gw, granted.id, declaration(granted.epoch, 1, hash, 1));
    expect([toEdge.status, toEdge.json?.code]).toEqual([409, 'HANDOVER_INVALID_STATE']);
    const unknown = await release(
      gw,
      '00000000-0000-4000-8000-000000000000',
      declaration(1, 1, hash, 1),
    );
    expect([unknown.status, unknown.json?.code]).toEqual([409, 'HANDOVER_INVALID_STATE']);
  });

  it('corps invalide : 422 VALIDATION_FAILED (empreinte en majuscules, absente, comptes négatifs)', async () => {
    const gw = await newGateway(owner, world);
    const ask = await cycle(gw);
    const ok = declaration(ask.epoch, 1, 'a'.repeat(64), 1);
    const bodies: unknown[] = [
      { ...ok, last_chain_hash: 'A'.repeat(64) },
      { ...ok, last_chain_hash: 'a'.repeat(63) },
      { ...ok, last_chain_hash: undefined },
      { ...ok, final_edge_seq: -1 },
      { ...ok, operations_count: '1' },
      { ...ok, epoch: undefined },
    ];
    for (const body of bodies) {
      const reply = await release(gw, ask.id, body);
      expect([reply.status, reply.json?.code]).toEqual([422, 'VALIDATION_FAILED']);
    }
    expect((await committed(ask.id)).status).toBe('RELEASE_REQUESTED');
  });
});
