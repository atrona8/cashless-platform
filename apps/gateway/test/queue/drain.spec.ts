// T090 : un lot en vol, signature, renvoi à l'identique, tailles, refus d'envoi (B.7-7, R-13).
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  acceptAll,
  batches,
  head,
  makeQueueHarness,
  ops,
  verifyBatchSignature,
  type QueueHarness,
} from './_support/queue-harness';

jest.setTimeout(30_000);

let h: QueueHarness;
beforeEach(async () => {
  h = await makeQueueHarness();
});
afterEach(async () => {
  await h.close();
});

const submissions = (): Array<Record<string, any>> =>
  h.central.requests.filter((r) => r.path === '/edge/sync-batches').map((r) => r.body as any);

async function forceAuthority(patch: string): Promise<void> {
  const c = await h.db.pool.connect();
  try {
    await c.query('ALTER TABLE edge_authority DISABLE TRIGGER edge_authority_guard');
    await c.query(`UPDATE edge_authority SET ${patch}`);
  } finally {
    await c.query('ALTER TABLE edge_authority ENABLE TRIGGER edge_authority_guard');
    c.release();
  }
}

describe('un seul lot en vol', () => {
  it('deux runOnce simultanés n’en construisent qu’un', async () => {
    await h.add(5);
    h.central.script = (request) => acceptAll(request);
    const [a, b] = await Promise.all([h.drain.runOnce(), h.drain.runOnce()]);
    expect(submissions()).toHaveLength(1);
    expect(a.sent + b.sent).toBe(5);
    expect((await batches(h.db)).map((r) => r.status)).toEqual(['DONE']);
  });

  it('l’index unique de la base refuse un second lot non DONE', async () => {
    await h.add(2);
    h.central.script = () => ({ destroy: true });
    await h.drain.runOnce();
    await expect(
      h.db.pool.query(
        `INSERT INTO edge_outgoing_batch (batch_id, edge_seq_from, edge_seq_to, epoch, body_sha256,
                                          status, body)
         VALUES ($1, 1, 2, 0, $2, 'PREPARED', '{}')`,
        [randomUUID(), Buffer.alloc(32)],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('deux instances (deux processus simulés) sur la même base : un lot seulement', async () => {
    await h.add(3);
    h.central.script = (request) => acceptAll(request);
    const { DrainService } = await import('../../src/queue/drain.service');
    const { CentralClient } = await import('../../src/central-client/central-client');
    const other = new DrainService(
      h.tx,
      (h.drain as any).client as InstanceType<typeof CentralClient>,
      h.keystore,
      h.clock,
    );
    await Promise.all([h.drain.runOnce(), other.runOnce()]);
    // Le second, soit trouve le lot du premier en vol (le renvoie à l'identique), soit rien à faire :
    // jamais deux lots simultanés ni deux numéros de lot différents pour les mêmes opérations.
    const ids = new Set(submissions().map((b) => b.batch_id));
    expect(ids.size).toBe(1);
    expect((await batches(h.db)).length).toBe(1);
  });
});

describe('renvoi à l’identique', () => {
  it('après coupure : même batch_id, même corps, même signature', async () => {
    await h.add(4);
    h.central.script = (request, index) => (index < 2 ? { destroy: true } : acceptAll(request));
    expect(await h.drain.runOnce()).toEqual({ sent: 0, empty: false });
    expect(await h.drain.runOnce()).toEqual({ sent: 0, empty: false });
    const third = await h.drain.runOnce();
    expect(third.sent).toBe(4);
    const [first, second, last] = submissions();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).toBe(JSON.stringify(last));
    expect(first!.batch_id).toBe(last!.batch_id);
    expect(first!.signature).toBe(last!.signature);
    // Le corps stocké en base est celui qui est parti.
    const stored = (await batches(h.db))[0]!;
    expect(JSON.stringify(JSON.parse(stored.body))).toBe(JSON.stringify(first));
    expect(h.central.requests.every((r) => r.headers['idempotency-key'] === first!.batch_id)).toBe(
      true,
    );
  });

  it('100 renvois : un seul résultat appliqué, un seul lot en base', async () => {
    await h.add(3);
    h.central.script = (request, index) => (index < 99 ? { destroy: true } : acceptAll(request));
    for (let i = 0; i < 100; i += 1) await h.drain.runOnce();
    const sent = submissions();
    expect(sent).toHaveLength(100);
    expect(new Set(sent.map((b) => JSON.stringify(b))).size).toBe(1);
    expect((await batches(h.db)).length).toBe(1);
    expect(h.purge.calls).toHaveLength(3);
    expect((await ops(h.db)).every((o) => o.central_status === 'ACCEPTED')).toBe(true);
  });

  it('la signature se vérifie avec la clé publique du port, jamais avec une autre', async () => {
    await h.add(2);
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    const body = submissions()[0]!;
    const spki = await h.keystore.publicKey('batch');
    expect(verifyBatchSignature(body, spki)).toBe(true);
    expect(verifyBatchSignature(body, await h.keystore.publicKey('token'))).toBe(false);
    expect(verifyBatchSignature({ ...body, epoch: 99 }, spki)).toBe(false);
    expect(body.edge_gateway_id).toBe(h.gatewayId);
    expect(body.ledger_id).toBe(h.ledgerId);
  });

  it('un corps altéré en base arrête le vidage : rien n’est envoyé', async () => {
    await h.add(2);
    h.central.script = () => ({ destroy: true });
    await h.drain.runOnce();
    const c = await h.db.pool.connect();
    try {
      await c.query('ALTER TABLE edge_outgoing_batch DISABLE TRIGGER edge_outgoing_batch_guard');
      await c.query("UPDATE edge_outgoing_batch SET body = replace(body, 'XOF', 'EUR')");
    } finally {
      await c.query('ALTER TABLE edge_outgoing_batch ENABLE TRIGGER edge_outgoing_batch_guard');
      c.release();
    }
    const before = submissions().length;
    await h.drain.runOnce();
    expect(submissions().length).toBe(before);
    expect(
      (await h.db.pool.query("SELECT detail FROM edge_audit WHERE kind = 'DRAIN_HALTED'")).rows[0]
        .detail.reason,
    ).toBe('BODY_ALTERED');
  });

  it('le corps d’un lot est immuable en base, et un lot DONE ne revient pas en arrière', async () => {
    await h.add(1);
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    const pool = h.db.pool;
    await expect(pool.query("UPDATE edge_outgoing_batch SET body = 'x'")).rejects.toThrow(
      /ne change pas/,
    );
    await expect(
      pool.query("UPDATE edge_outgoing_batch SET status = 'SENT', done_reason = NULL"),
    ).rejects.toThrow();
    await expect(pool.query('DELETE FROM edge_outgoing_batch')).rejects.toThrow(/interdit/);
  });
});

describe('taille', () => {
  it('500 opérations au plus', async () => {
    await h.add(520);
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    const [first] = submissions();
    expect(first!.operations).toHaveLength(500);
    expect([first!.edge_seq_from, first!.edge_seq_to]).toEqual([1, 500]);
    await h.drain.runOnce();
    const second = submissions()[1]!;
    expect([second.edge_seq_from, second.edge_seq_to, second.operations.length]).toEqual([
      501, 520, 20,
    ]);
    expect(second.prev_chain_hash).toBe(first!.last_chain_hash);
    expect(second.batch_id).not.toBe(first!.batch_id);
  });

  it('1 Mio au plus, le premier seuil atteint', async () => {
    await h.add(60, { padding: 30_000 }); // ~30 Kio par opération
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    const [first] = submissions();
    const size = Buffer.byteLength(JSON.stringify(first));
    expect(size).toBeLessThanOrEqual(1024 * 1024);
    expect(first!.operations.length).toBeGreaterThan(20);
    expect(first!.operations.length).toBeLessThan(60);
    // Une opération de plus aurait dépassé 1 Mio.
    expect(size + 30_000).toBeGreaterThan(1024 * 1024);
    const stored = (await batches(h.db))[0]!;
    expect(Buffer.byteLength(stored.body)).toBeLessThanOrEqual(1024 * 1024);
    await h.drain.runOnce();
    await h.drain.runOnce();
    expect((await head(h.db)).acked_edge_seq).toBe('60');
  });
});

describe('refus d’envoi', () => {
  it('REVOKED : aucun envoi', async () => {
    await h.add(2);
    await forceAuthority("state = 'REVOKED'");
    h.central.script = (request) => acceptAll(request);
    expect(await h.drain.runOnce()).toEqual({ sent: 0, empty: false });
    expect(submissions()).toHaveLength(0);
  });

  it('époque du lot inférieure à highest_epoch_seen : le lot reste, alerte ; RELEASING et STALE envoient', async () => {
    await h.add(2);
    await forceAuthority("state = 'ACTIVE', epoch = 3, highest_epoch_seen = 5");
    h.central.script = (request) => acceptAll(request);
    expect(await h.drain.runOnce()).toEqual({ sent: 0, empty: false });
    expect(submissions()).toHaveLength(0);
    expect(
      (await h.db.pool.query("SELECT 1 FROM edge_audit WHERE kind = 'DRAIN_EPOCH_BEHIND'"))
        .rowCount,
    ).toBe(1);
    expect((await ops(h.db)).every((o) => o.central_status === 'PENDING')).toBe(true);
    // STALE : le vidage ne débite pas, il part.
    await forceAuthority("state = 'STALE'");
    const stale = await h.drain.runOnce();
    expect(stale.sent).toBe(2);
    expect(submissions()[0]!.epoch).toBe(3);
  });

  it('RELEASING : le central a demandé le vidage, le lot part malgré l’écart d’époque', async () => {
    await h.add(1);
    await forceAuthority("state = 'ACTIVE', epoch = 3, highest_epoch_seen = 5");
    await forceAuthority(
      "state = 'RELEASING', releasing_since = now(), handover_id = gen_random_uuid()",
    );
    h.central.script = (request) => acceptAll(request);
    expect((await h.drain.runOnce()).sent).toBe(1);
  });

  it('file vide : rien à envoyer, empty', async () => {
    expect(await h.drain.runOnce()).toEqual({ sent: 0, empty: true });
    expect(submissions()).toHaveLength(0);
  });
});
