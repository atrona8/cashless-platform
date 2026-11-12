import { performance } from 'node:perf_hooks';
import { makeRep, q, uid, hex, type Rep } from './_support/harness';
import { ReplicationLoop } from '../../src/replication/replication-loop';

let r: Rep;
beforeEach(async () => {
  r = await makeRep();
});
afterEach(async () => {
  await r.close();
});

describe('NFR-008 : un blocage du central s’applique en moins de 5 s (p95)', () => {
  it('50 blocages, lien sain, boucle de fond à 1 s, mesure jusqu’à l’état local', async () => {
    const mediaId = uid();
    const w = uid();
    let seq = 0;
    let blockedAt: number | null = null;
    // Faux central : renvoie l’état courant ; un changement entre dans le journal à sa validation.
    let status = 'ACTIVE';
    r.feed.fallback = (req) => {
      const reference =
        (req.afterChangeSeq ?? 0) < seq
          ? {
              from_change_seq: req.afterChangeSeq ?? 0,
              to_change_seq: seq,
              has_more: false,
              media_refs: [{ media_id: mediaId, token_hash: hex(1), wallet_id: w, status }],
            }
          : { from_change_seq: seq, to_change_seq: seq, has_more: false };
      return r.page({}, reference);
    };
    const loop = new ReplicationLoop(r.svc, {
      centralUrl: 'https://x',
      centralClientCertFile: 'x',
    } as never);
    await loop.start();
    const samples: number[] = [];
    try {
      for (let i = 0; i < 50; i += 1) {
        status = i % 2 === 0 ? 'SUSPENDED' : 'ACTIVE';
        seq += 1;
        blockedAt = performance.now();
        const deadline = blockedAt + 8000;
        for (;;) {
          const row = (await q<{ status: string }>(r, 'SELECT status FROM edge_media'))[0];
          if (row?.status === status) break;
          if (performance.now() > deadline) throw new Error('blocage non appliqué');
          await new Promise((res) => setTimeout(res, 20));
        }
        samples.push(performance.now() - blockedAt);
      }
    } finally {
      await loop.stop();
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1] as number;
    expect(p95).toBeLessThan(5000);
  }, 120_000);
});
