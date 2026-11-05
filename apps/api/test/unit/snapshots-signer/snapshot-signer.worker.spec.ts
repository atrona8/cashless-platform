// Signataire de snapshots : traitement par grand livre indépendant (NFR-005). Sans base : dépôt, vérificateur et
// signature simulés ; ce qui est prouvé ici est l'ordonnancement, pas la vérification (couverte par les tests d'intégration).
import {
  SnapshotSignerWorker,
  ALARM_INTEGRITY,
} from '../../../src/snapshots-signer/snapshot-signer.worker';
import type { DraftRow } from '../../../src/snapshots-signer/draft-verifier';
import { WorkerRegistry } from '../../../src/processes/worker';

jest.mock('../../../src/snapshots-signer/draft-verifier', () => ({
  verifyDraftCooperative: jest.fn(async (draft: unknown) => ({
    ok: true,
    verified: { keyId: 'k', draft },
  })),
}));
jest.mock('../../../src/snapshots-signer/header-signer', () => ({
  PublishedKeyError: class PublishedKeyError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  },
  signHeader: jest.fn(async () => Buffer.from('sig')),
  verifyWithPublishedKey: jest.fn(),
}));

const draft = (id: number, ledgerId: string, kind: string, version: number): DraftRow => ({
  id: BigInt(id),
  operatorId: 'op',
  ledgerId,
  kind,
  baseVersion: kind === 'FULL' ? null : BigInt(version - 1),
  version: BigInt(version),
  header: {},
});

interface Gate {
  promise: Promise<void>;
  open: () => void;
}
const gate = (): Gate => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};
const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function build(drafts: DraftRow[], opts: { settleAll?: boolean; graceMs?: number } = {}) {
  const published: string[] = [];
  const active = new Map<string, number>();
  const maxActive = new Map<string, number>();
  const blocks = new Map<string, Gate>();
  const failing = new Set<string>();
  let pending = [...drafts];
  const repository = {
    readyDrafts: jest.fn(async () => pending),
    content: jest.fn(async (d: DraftRow) => {
      const n = (active.get(d.ledgerId) ?? 0) + 1;
      active.set(d.ledgerId, n);
      maxActive.set(d.ledgerId, Math.max(maxActive.get(d.ledgerId) ?? 0, n));
      try {
        await blocks.get(`${d.kind}${d.version}`)?.promise;
        if (failing.has(d.ledgerId)) throw new Error('boom');
        await tick(5);
        return [];
      } finally {
        active.set(d.ledgerId, (active.get(d.ledgerId) ?? 1) - 1);
      }
    }),
    publishedKeys: jest.fn(async () => []),
    publish: jest.fn(async (d: DraftRow) => {
      published.push(`${d.ledgerId}:${d.kind}${d.version}`);
      pending = pending.filter((p) => p.id !== d.id);
      return true;
    }),
    discard: jest.fn(),
  };
  const worker = new SnapshotSignerWorker(
    new WorkerRegistry(),
    repository as never,
    {} as never,
    { snapshotSigningKeyRef: 'ref' } as never,
    { graceMs: opts.graceMs ?? 300, settleAll: opts.settleAll ?? false },
  );
  return { worker, published, maxActive, blocks, failing, repository };
}

describe('SnapshotSignerWorker : grands livres indépendants', () => {
  it('(a) publie le DELTA de A pendant qu un FULL de B est bloqué', async () => {
    const { worker, published, blocks } = build([
      draft(1, 'B', 'FULL', 1),
      draft(2, 'A', 'DELTA', 2),
    ]);
    const full = gate();
    blocks.set('FULL1', full);
    const started = Date.now();
    const done = await worker.runOnce();
    expect(Date.now() - started).toBeLessThan(250); // rend la main sans attendre le FULL ni la grâce
    expect(published).toEqual(['A:DELTA2']);
    expect(done).toBe(1);
    full.open();
    await tick(50);
    expect(published).toEqual(['A:DELTA2', 'B:FULL1']);
    expect(await worker.runOnce()).toBe(1); // le FULL réglé en arrière-plan est compté au passage suivant
  });

  it('(b) ne traite jamais deux brouillons d un même grand livre en même temps, dans l ordre', async () => {
    const { worker, published, maxActive } = build([
      draft(1, 'A', 'DELTA', 1),
      draft(2, 'A', 'DELTA', 2),
      draft(3, 'A', 'DELTA', 3),
    ]);
    await worker.runOnce();
    expect(published).toEqual(['A:DELTA1', 'A:DELTA2', 'A:DELTA3']);
    expect(maxActive.get('A')).toBe(1);
  });

  it('ne relance pas un grand livre déjà en vol', async () => {
    const { worker, published, blocks } = build([draft(1, 'B', 'FULL', 1)]);
    const full = gate();
    blocks.set('FULL1', full);
    await worker.runOnce();
    await worker.runOnce();
    full.open();
    await tick(50);
    expect(published).toEqual(['B:FULL1']);
  });

  it('ne relance pas un brouillon publié pendant la lecture de la liste (tâche finie entre-temps)', async () => {
    const { worker, published, blocks, repository } = build([draft(1, 'B', 'FULL', 1)]);
    const full = gate();
    blocks.set('FULL1', full);
    await worker.runOnce(); // le FULL de B part en arrière-plan, détaché
    // Deuxième passage : liste lue AVANT la fin de la tâche, qui finit pendant l'attente.
    const stale = [draft(1, 'B', 'FULL', 1)];
    repository.readyDrafts.mockImplementationOnce(async () => {
      full.open();
      await tick(50); // la tâche publie et sort de `inFlight` avant le retour de la lecture
      return stale;
    });
    await worker.runOnce();
    expect(published).toEqual(['B:FULL1']);
    expect(repository.content).toHaveBeenCalledTimes(1);
    expect(repository.publish).toHaveBeenCalledTimes(1);
    expect(worker.alarm()).toBe(0);
  });

  it('(c) en settleAll, le passage attend tout', async () => {
    const { worker, published, blocks } = build(
      [draft(1, 'B', 'FULL', 1), draft(2, 'A', 'DELTA', 2)],
      { settleAll: true },
    );
    const full = gate();
    blocks.set('FULL1', full);
    let returned = false;
    const pass = worker.runOnce().then((n) => {
      returned = true;
      return n;
    });
    await tick(100);
    expect(returned).toBe(false);
    full.open();
    expect(await pass).toBe(2);
    expect(published.sort()).toEqual(['A:DELTA2', 'B:FULL1']);
  });

  it('(d) un échec sur un grand livre n empêche pas l autre et lève l alarme 3', async () => {
    const { worker, published, failing } = build([
      draft(1, 'B', 'DELTA', 1),
      draft(2, 'A', 'DELTA', 2),
    ]);
    failing.add('B');
    const done = await worker.runOnce();
    expect(published).toEqual(['A:DELTA2']);
    expect(done).toBe(1); // l'échec n'est pas compté comme réglé
    expect(worker.alarm()).toBe(ALARM_INTEGRITY);
  });
});
