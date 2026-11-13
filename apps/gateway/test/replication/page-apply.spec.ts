import { replicationApplyHook, setReplicationApplyHook } from '../../src/testing/apply-hook';
import { hex, makeRep, q, uid, type Rep } from './_support/harness';

let r: Rep;
beforeEach(async () => {
  r = await makeRep();
});
afterEach(async () => {
  setReplicationApplyHook(undefined);
  await r.close();
});

const cursor = async () =>
  (
    await q<{ p: string; c: string; s: string }>(
      r,
      `SELECT last_replicated_posting_id p, last_change_seq c, last_edge_seq_applied s
       FROM edge_replication_cursor`,
    )
  )[0] as { p: string; c: string; s: string };

const wallet = (id: string, paid: number, extra = {}) => ({
  wallet_id: id,
  status: 'ACTIVE',
  paid,
  promo: 0,
  ...extra,
});

describe('application d’une page', () => {
  it('page valide : soldes, curseurs, requête portant les deux curseurs', async () => {
    const w = uid();
    r.feed.queue.push(
      r.page(
        { to_posting_id: 10, edge_seq_applied: 3, wallets: [wallet(w, 500)] },
        { to_change_seq: 4 },
      ),
    );
    expect(await r.svc.pullOnce()).toEqual({ hasMore: false });
    expect(r.feed.requests[0]).toMatchObject({ afterPostingId: 0, afterChangeSeq: 0 });
    expect(await cursor()).toEqual({ p: '10', c: '4', s: '3' });
    const row = (
      await q<{ central_paid: string; applied_edge_seq: string }>(r, 'SELECT * FROM edge_wallet')
    )[0];
    expect(row).toMatchObject({ central_paid: '500', applied_edge_seq: '3' });
  });

  it('page invalide refusée en entier (champ requis absent, ou mal typé)', async () => {
    const w = uid();
    const bad = r.page({
      to_posting_id: 5,
      wallets: [wallet(w, 100), { wallet_id: uid(), status: 'ACTIVE' }],
    });
    r.feed.queue.push(bad);
    await expect(r.svc.pullOnce()).rejects.toThrow(/page refusée/);
    expect(await q(r, 'SELECT 1 FROM edge_wallet')).toHaveLength(0);
    expect((await cursor()).p).toBe('0');
    const noSeq = r.page({ to_posting_id: 5 });
    delete noSeq.edge_seq_applied;
    r.feed.queue.push(noSeq);
    await expect(r.svc.pullOnce()).rejects.toThrow(/edge_seq_applied/);
    const noRef = r.page({ to_posting_id: 5 });
    delete noRef.reference;
    r.feed.queue.push(noRef);
    await expect(r.svc.pullOnce()).rejects.toThrow(/reference/);
  });

  it('champ inconnu ignoré', async () => {
    r.feed.queue.push(r.page({ to_posting_id: 2, futur: { x: 1 } }));
    await r.svc.pullOnce();
    expect((await cursor()).p).toBe('2');
  });

  it('panne entre deux tables : ni donnée ni curseur', async () => {
    for (const step of ['wallets', 'media', 'reference', 'purge']) {
      const w = uid();
      setReplicationApplyHook((s) => {
        if (s === step) throw new Error('panne injectée');
      });
      r.feed.queue.push(
        r.page(
          { to_posting_id: 9, edge_seq_applied: 2, wallets: [wallet(w, 70)] },
          {
            to_change_seq: 3,
            vendors: [{ vendor_id: uid(), display_name: 'V', status: 'ACTIVE', locked: false }],
          },
        ),
      );
      await expect(r.svc.pullOnce()).rejects.toThrow('panne injectée');
      expect(await cursor()).toEqual({ p: '0', c: '0', s: '0' });
      expect(await q(r, 'SELECT 1 FROM edge_wallet')).toHaveLength(0);
      expect(await q(r, 'SELECT 1 FROM edge_vendor')).toHaveLength(0);
    }
  });

  it('coupure au milieu d’une passe : reprise du curseur persisté, sans trou ni doublon', async () => {
    const w = uid();
    r.feed.queue.push(
      r.page({ to_posting_id: 5, has_more: true, wallets: [wallet(w, 10)] }),
      () => {
        throw new Error('coupure');
      },
    );
    expect(await r.svc.pullOnce()).toEqual({ hasMore: true });
    await expect(r.svc.pullOnce()).rejects.toThrow('coupure');
    r.feed.queue.push(r.page({ from_posting_id: 5, to_posting_id: 9, wallets: [wallet(w, 30)] }));
    expect(await r.svc.pullOnce()).toEqual({ hasMore: false });
    expect(r.feed.requests.map((x) => x.afterPostingId)).toEqual([0, 5, 5]);
    expect((await cursor()).p).toBe('9');
  });

  it('horizon : le curseur prend l’horizon déclaré, jamais un posting.id plus grand', async () => {
    r.feed.queue.push(
      r.page({ to_posting_id: 7, wallets: [wallet(uid(), 1, { last_posting_id: 999 })] }),
    );
    await r.svc.pullOnce();
    expect((await cursor()).p).toBe('7');
    expect(
      (await q<{ last_posting_id: string }>(r, 'SELECT last_posting_id FROM edge_wallet'))[0]
        ?.last_posting_id,
    ).toBe('7');
  });

  it('page rejouée : sans effet de plus ; horizon qui recule, trou, edge_seq reculé : refusés', async () => {
    const w = uid();
    const p = r.page(
      { to_posting_id: 8, edge_seq_applied: 4, wallets: [wallet(w, 40)] },
      { to_change_seq: 2 },
    );
    r.feed.queue.push(p, p);
    await r.svc.pullOnce();
    await r.svc.pullOnce();
    expect(await q(r, 'SELECT 1 FROM edge_wallet')).toHaveLength(1);
    r.feed.queue.push(
      r.page(
        { from_posting_id: 0, to_posting_id: 3, edge_seq_applied: 4 },
        { from_change_seq: 2, to_change_seq: 2 },
      ),
    );
    await expect(r.svc.pullOnce()).rejects.toThrow(/recul/);
    r.feed.queue.push(
      r.page(
        { from_posting_id: 20, to_posting_id: 30, edge_seq_applied: 4 },
        { from_change_seq: 2, to_change_seq: 2 },
      ),
    );
    await expect(r.svc.pullOnce()).rejects.toThrow(/trou/);
    r.feed.queue.push(
      r.page(
        { from_posting_id: 8, to_posting_id: 9, edge_seq_applied: 1 },
        { from_change_seq: 2, to_change_seq: 2 },
      ),
    );
    await expect(r.svc.pullOnce()).rejects.toThrow(/edge_seq_applied/);
    expect(await cursor()).toEqual({ p: '8', c: '2', s: '4' });
  });

  it('page d’un autre grand livre ou événement : refusée, alerte consignée', async () => {
    r.feed.queue.push(r.page({ ledger_id: uid() }));
    await expect(r.svc.pullOnce()).rejects.toThrow(/autre grand livre/);
    r.feed.queue.push(
      r.page(
        {},
        {
          event: {
            event_id: uid(),
            status: 'LIVE',
            currency: 'XOF',
            minor_units: 0,
            timezone: 'UTC',
            activation_modes: [],
            terminal_settings: {},
            wallet_limits: {},
          },
        },
      ),
    );
    await expect(r.svc.pullOnce()).rejects.toThrow(/autre événement/);
    const audit = await q<{ detail: { kind: string } }>(
      r,
      `SELECT detail FROM edge_audit WHERE kind = 'REPLICATION_PAGE_REFUSED'`,
    );
    expect(audit.map((a) => a.detail.kind)).toEqual(['FOREIGN', 'FOREIGN']);
    expect(await q(r, 'SELECT 1 FROM edge_event_setting')).toHaveLength(0);
  });
});

describe('catchUpTo : filigrane puis page vide avec le curseur de référence final', () => {
  it('boucle jusqu’au filigrane, puis relit avec last_change_seq', async () => {
    r.feed.queue.push(
      r.page({ to_posting_id: 50, has_more: true }, { to_change_seq: 2 }),
      r.page({ from_posting_id: 50, to_posting_id: 120 }, { from_change_seq: 2, to_change_seq: 6 }),
      r.page(
        { from_posting_id: 120, to_posting_id: 120 },
        { from_change_seq: 6, to_change_seq: 6 },
      ),
    );
    await r.svc.catchUpTo(100n);
    expect(r.feed.requests.map((x) => [x.afterPostingId, x.afterChangeSeq])).toEqual([
      [0, 0],
      [50, 2],
      [120, 6], // page vide : le central apprend le curseur final (A03)
    ]);
  });

  it('filigrane jamais atteint : échoue (aucun accusé)', async () => {
    r.feed.fallback = () => r.page({ to_posting_id: 10, from_posting_id: 0 });
    await expect(r.svc.catchUpTo(100n)).rejects.toThrow(/rattrapage incomplet/);
  });

  it('erreur du central : l’état local est gardé', async () => {
    r.feed.queue.push(r.page({ to_posting_id: 4, wallets: [wallet(uid(), 9)] }));
    await r.svc.pullOnce();
    r.feed.queue.push(() => {
      throw new Error('central injoignable');
    });
    await expect(r.svc.pullOnce()).rejects.toThrow();
    expect(await q(r, 'SELECT 1 FROM edge_wallet')).toHaveLength(1);
    expect((await cursor()).p).toBe('4');
    void hex;
  });
});

describe('plafonds et point d’arrêt de test', () => {
  const limits = async () =>
    (await q<{ limits: Record<string, unknown> }>(r, 'SELECT limits FROM edge_wallet_limit'))[0]
      ?.limits;

  it('M6 : kyc_verified absent du flux ne laisse pas un true ancien (absent = faux)', async () => {
    const w = uid();
    r.feed.queue.push(
      r.page({ to_posting_id: 1, wallets: [wallet(w, 1, { kyc_verified: true })] }),
    );
    await r.svc.pullOnce();
    expect(await limits()).toMatchObject({ kyc_verified: true });
    r.feed.queue.push(r.page({ from_posting_id: 1, to_posting_id: 2, wallets: [wallet(w, 1)] }));
    await r.svc.pullOnce();
    expect(await limits()).toMatchObject({ kyc_verified: false });
  });

  it('M7 : le point d’arrêt de test est inerte en production', async () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      setReplicationApplyHook(() => {
        throw new Error('ne doit jamais tourner');
      });
      expect(replicationApplyHook()).toBeUndefined();
      process.env.NODE_ENV = 'test';
      expect(replicationApplyHook()).toBeUndefined(); // jamais armé en production
      expect('applyHook' in r.svc).toBe(false);
      r.feed.queue.push(r.page({ to_posting_id: 1 }));
      await r.svc.pullOnce();
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});
