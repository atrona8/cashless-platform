// Travailleurs de maintenance du central pour les passerelles (WP12, T055 ; R-15, R-30), sous le rôle réel
// `cashless_maint` (aucun droit de table) : passerelle muette, retour d'un appel, `REVOKED` jamais rétablie, rendu
// bloqué, pas de doublon d'alerte, code d'alerte.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { Client } from 'pg';
import { TenantTx } from '../../../../src/db/tenant-tx';
import { EdgeReleaseStuckWorker } from '../../../../src/edge/maintenance/edge-release-stuck.worker';
import { EdgeSilenceWorker } from '../../../../src/edge/maintenance/edge-silence.worker';
import { WorkerRegistry } from '../../../../src/processes/worker';
import { connect, MAINT_URL, OWNER_URL } from '../../../support/db';
import {
  seedEdgeWorld,
  startEdge,
  type EdgeWorld,
  type RunningEdge,
} from '../../../support/edge-fixtures';
import { activate, edgeSend, newGateway, requestRelease, type Gw } from './support';

jest.setTimeout(120_000);

describe('maintenance des passerelles', () => {
  let owner: Client;
  let pool: Pool;
  let world: EdgeWorld;
  let edge: RunningEdge;

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    pool = new Pool({ connectionString: MAINT_URL });
    world = await seedEdgeWorld(owner);
    edge = await startEdge();
  });
  afterAll(async () => {
    await edge?.close();
    await pool?.end();
    await owner?.end();
  });

  const silence = () => new EdgeSilenceWorker(new WorkerRegistry(), new TenantTx(pool as never));
  const stuck = () => new EdgeReleaseStuckWorker(new WorkerRegistry(), new TenantTx(pool as never));
  const status = async (gw: Gw) =>
    (await owner.query('SELECT status FROM edge_gateway WHERE id = $1', [gw.id])).rows[0]
      .status as string;
  const age = (gw: Gw, seconds: number) =>
    owner.query(
      `UPDATE edge_gateway SET last_seen_at = now() - make_interval(secs => $2),
                               registered_at = now() - make_interval(secs => $2) WHERE id = $1`,
      [gw.id, seconds],
    );
  const audits = async (gw: Gw, action: string) =>
    (
      await owner.query<{ alert: string | null }>(
        `SELECT after ->> 'alert' AS alert FROM audit_log WHERE object_id = $1 AND action = $2`,
        [gw.id, action],
      )
    ).rows;

  it('passerelle muette 90 s : ISOLATED, alerte EDGE_SILENT si un handover est ouvert, une seule fois', async () => {
    const gw = await newGateway(owner, world);
    await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
    await activate(owner, world, edge.port, gw);
    await age(gw, 90);
    const worker = silence();
    expect(await worker.runOnce()).toBeGreaterThanOrEqual(1);
    expect(worker.alarm()).toBeGreaterThan(0);
    expect(await status(gw)).toBe('ISOLATED');
    const isolated = await audits(gw, 'EDGE_GATEWAY_ISOLATED');
    expect(isolated).toHaveLength(1);
    // Sans handover ouvert (ACTIVE accusé), l'audit est posé sans alerte ; avec une demande de retour : alerte.
    await owner.query(
      `UPDATE edge_gateway SET status = 'ACTIVE', last_seen_at = now() - interval '90 s' WHERE id = $1`,
      [gw.id],
    );
    await requestRelease(owner, world, gw);
    await silence().runOnce();
    const again = await audits(gw, 'EDGE_GATEWAY_ISOLATED');
    expect(again.map((row) => row.alert)).toContain('EDGE_SILENT');
    // Rien de neuf au passage suivant : pas de doublon.
    await silence().runOnce();
    expect(await audits(gw, 'EDGE_GATEWAY_ISOLATED')).toHaveLength(2);
  });

  it('retour d’un appel : CATCHING_UP (appel de la passerelle) puis ACTIVE (maintenance)', async () => {
    const gw = await newGateway(owner, world);
    await age(gw, 90);
    await silence().runOnce();
    expect(await status(gw)).toBe('ISOLATED');
    const reply = await edgeSend(edge.port, 'GET', '/edge/handovers/current?wait=0', {
      client: gw.cert,
    });
    expect(reply.status).toBe(200);
    expect(await status(gw)).toBe('CATCHING_UP');
    await silence().runOnce();
    expect(await status(gw)).toBe('ACTIVE');
    expect(await audits(gw, 'EDGE_GATEWAY_LINK_RESTORED')).toHaveLength(1);
  });

  it('REVOKED n’est jamais rétablie ni isolée', async () => {
    const gw = await newGateway(owner, world, { status: 'REVOKED' });
    await age(gw, 600);
    await silence().runOnce();
    expect(await status(gw)).toBe('REVOKED');
    await owner.query('UPDATE edge_gateway SET last_seen_at = now() WHERE id = $1', [gw.id]);
    await silence().runOnce();
    expect(await status(gw)).toBe('REVOKED');
  });

  it('rendu bloqué 11 minutes : alerte EDGE_RELEASE_STUCK une fois, code non nul ; 5 minutes : rien', async () => {
    const young = await newGateway(owner, world);
    const old = await newGateway(owner, world);
    const youngAsk = await (async () => {
      await activate(owner, world, edge.port, young);
      return requestRelease(owner, world, young);
    })();
    const oldAsk = await (async () => {
      await activate(owner, world, edge.port, old);
      return requestRelease(owner, world, old);
    })();
    // Passage à RELEASING par la route (déclaration fausse : la vérification échoue, RELEASING reste).
    for (const [gw, ask] of [
      [young, youngAsk],
      [old, oldAsk],
    ] as const) {
      const reply = await edgeSend(edge.port, 'POST', `/edge/handovers/${ask.id}/release`, {
        client: gw.cert,
        body: {
          epoch: ask.epoch,
          final_edge_seq: 5,
          last_chain_hash: '00'.repeat(32),
          operations_count: 5,
        },
      });
      expect(reply.status).toBe(409);
    }
    await owner.query(
      `UPDATE debit_authority_handover SET begun_releasing_at = now() - interval '5 minutes' WHERE id = $1`,
      [youngAsk.id],
    );
    await owner.query(
      `UPDATE debit_authority_handover SET begun_releasing_at = now() - interval '11 minutes' WHERE id = $1`,
      [oldAsk.id],
    );
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const worker = stuck();
      const raised = await worker.runOnce(Date.now());
      const logged = error.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('EDGE_RELEASE_STUCK'));
      expect(raised).toBeGreaterThanOrEqual(1);
      expect(logged.some((line) => line.includes(oldAsk.id))).toBe(true);
      expect(logged.some((line) => line.includes(youngAsk.id))).toBe(false);
      expect(worker.alarm()).toBeGreaterThan(0);
      // Pas de doublon pour le même état, même après l'intervalle.
      const before = logged.length;
      await worker.runOnce(Date.now() + 120_000);
      const after = error.mock.calls.filter((call) =>
        String(call[0]).includes('EDGE_RELEASE_STUCK'),
      );
      expect(after.length).toBe(before);
      // Décision 37 : trace en base, une seule ligne par rendu bloqué (même après un redémarrage du processus :
      // nouvelle instance, mémoire vide), aucune pour le rendu de 5 minutes ; l'alerte ne porte aucune empreinte.
      const trace = (id: string) =>
        owner.query<{ operator_id: string; after: Record<string, unknown> }>(
          `SELECT operator_id, after FROM audit_log WHERE action = 'EDGE_RELEASE_STUCK' AND object_id = $1`,
          [id],
        );
      expect((await trace(oldAsk.id)).rows).toHaveLength(1);
      expect((await trace(youngAsk.id)).rows).toHaveLength(0);
      await stuck().runOnce(Date.now() + 300_000);
      const rows = (await trace(oldAsk.id)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.after).toMatchObject({ gateway_id: old.id, alert: 'EDGE_RELEASE_STUCK' });
      expect(JSON.stringify(rows[0]!.after)).not.toMatch(/last_chain_hash|sha256/);
    } finally {
      error.mockRestore();
    }
  });
});
