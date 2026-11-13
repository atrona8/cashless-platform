import { addOp, makeRep, q, uid, type Rep } from './_support/harness';

let r: Rep;
let w: string;
beforeEach(async () => {
  r = await makeRep();
  w = uid();
  r.feed.queue.push(
    r.page({
      to_posting_id: 1,
      wallets: [{ wallet_id: w, status: 'ACTIVE', paid: 1000, promo: 0 }],
    }),
  );
  await r.svc.pullOnce();
  to = 1;
});
afterEach(async () => {
  await r.close();
});

const deltas = async () =>
  (await q<{ edge_seq: string }>(r, 'SELECT edge_seq FROM edge_op_delta ORDER BY edge_seq')).map(
    (d) => Number(d.edge_seq),
  );
const result = (seq: number, status: string) =>
  r.tx.run(async (tx) => {
    await tx.query('UPDATE edge_op SET central_status = $2 WHERE edge_seq = $1', [seq, status]);
    await r.svc.purge.onOpResult(tx, seq, status);
  });
let to = 1;
const pass = async (seqApplied: number, extra: Record<string, unknown> = {}) => {
  r.feed.queue.push(
    r.page({ from_posting_id: to, to_posting_id: to + 1, edge_seq_applied: seqApplied, ...extra }),
  );
  to += 1;
  await r.svc.pullOnce();
};

describe('purge des deltas (A26)', () => {
  it('REJECTED et VOID : annulés dès le résultat', async () => {
    const a = await addOp(r, w, -10);
    const b = await addOp(r, w, -20);
    await result(a, 'REJECTED');
    expect(await deltas()).toEqual([b]);
    await result(b, 'VOID');
    expect(await deltas()).toEqual([]);
  });

  it('ACCEPTED : gardé jusqu’à une page dont edge_seq_applied le couvre (jamais trop tôt)', async () => {
    const a = await addOp(r, w, -10);
    const b = await addOp(r, w, -20);
    await result(a, 'ACCEPTED');
    await result(b, 'ACCEPTED_WITH_SHORTFALL');
    expect(await deltas()).toEqual([a, b]); // résultat reçu, page pas encore passée
    await pass(a);
    expect(await deltas()).toEqual([b]);
    await pass(b);
    expect(await deltas()).toEqual([]);
  });

  it('ACCEPTED dont la page a passé AVANT le résultat : purgé au résultat', async () => {
    const a = await addOp(r, w, -10);
    await pass(a); // statut encore inconnu : rien n’est purgé
    expect(await deltas()).toEqual([a]);
    await result(a, 'ACCEPTED'); // le portefeuille n’a pas été servi : le delta reste (prudent)
    expect(await deltas()).toEqual([a]);
    await pass(a); // prochaine page finale : purgé
    expect(await deltas()).toEqual([]);
  });

  it('DUPLICATE : gardé tant qu’aucune passe n’a COMMENCÉ après le résultat, puis annulé', async () => {
    const a = await addOp(r, w, -10);
    // une passe en cours (page non finale) commencée AVANT le résultat
    r.feed.queue.push(r.page({ from_posting_id: to, to_posting_id: to + 1, has_more: true }));
    to += 1;
    await r.svc.pullOnce();
    await result(a, 'DUPLICATE');
    await pass(0); // fin de la passe commencée avant : un DUPLICATE suivi d’une page ancienne
    expect(await deltas()).toEqual([a]); // ne supprime rien
    await pass(0); // passe commencée après le résultat, complète
    expect(await deltas()).toEqual([]); // gardé trop longtemps : borné
    expect(await q(r, 'SELECT 1 FROM edge_op')).toHaveLength(1); // l’opération reste
  });

  it('DUPLICATE inconnu en mémoire (redémarrage) : annulé à la première passe complète', async () => {
    const a = await addOp(r, w, -10, 0, 'DUPLICATE');
    expect(await deltas()).toEqual([a]);
    await pass(0);
    expect(await deltas()).toEqual([]);
  });

  it('un delta non résolu (PENDING) n’est jamais supprimé par une passe', async () => {
    const a = await addOp(r, w, -10);
    await pass(a);
    await pass(a);
    expect(await deltas()).toEqual([a]);
  });

  // B1 (argent) : une page non finale qui couvre edge_seq sans porter le portefeuille.
  describe('page non finale : le solde effectif ne remonte jamais', () => {
    const other = uid();
    const partialPage = () =>
      r.page({
        from_posting_id: to,
        to_posting_id: to + 1,
        has_more: true,
        edge_seq_applied: 99,
        wallets: [{ wallet_id: other, status: 'ACTIVE', paid: 5, promo: 0 }],
      });
    const balance = () => r.tx.run((tx) => r.svc.effectiveBalance(tx, w));

    it('central 1000, delta -400 ACCEPTED, page has_more d’un autre portefeuille : 600', async () => {
      const a = await addOp(r, w, -400, 0, 'ACCEPTED');
      expect((await balance()).paid).toBe(600n);
      r.feed.queue.push(partialPage());
      await r.svc.pullOnce();
      to += 1;
      expect(await deltas()).toEqual([a]);
      expect((await balance()).paid).toBe(600n);
    });

    it('lien coupé après cette page : toujours 600 (reprise du curseur persisté)', async () => {
      await addOp(r, w, -400, 0, 'ACCEPTED');
      r.feed.queue.push(partialPage(), () => {
        throw new Error('coupure');
      });
      await r.svc.pullOnce();
      await expect(r.svc.pullOnce()).rejects.toThrow('coupure');
      expect((await balance()).paid).toBe(600n);
    });

    it('résultat ACCEPTED reçu après la page non finale : le delta reste', async () => {
      const a = await addOp(r, w, -400);
      r.feed.queue.push(partialPage());
      await r.svc.pullOnce();
      await result(a, 'ACCEPTED');
      expect((await balance()).paid).toBe(600n);
    });

    it('la page finale suivante qui sert le portefeuille purge, solde exact', async () => {
      await addOp(r, w, -400, 0, 'ACCEPTED');
      r.feed.queue.push(partialPage());
      await r.svc.pullOnce();
      to += 1;
      r.feed.queue.push(
        r.page({
          from_posting_id: to,
          to_posting_id: to + 1,
          edge_seq_applied: 99,
          wallets: [{ wallet_id: w, status: 'ACTIVE', paid: 600, promo: 0 }],
        }),
      );
      await r.svc.pullOnce();
      expect(await deltas()).toEqual([]);
      expect((await balance()).paid).toBe(600n);
    });
  });
});
