// Intégration : seuil de la seconde personne au cumul du jour des rendus partiels (mission 9c, WP04 ; FR-007, NFR-002 ;
// ADR-190, ADR-195). Le cumul est celui du PORTEFEUILLE (tous bracelets), du jour UTC, borné par l'heure de la base.
// Le jour courant est lu sur la base (`clock_timestamp()`) ; « hier » est obtenu en interrogeant avec le jour suivant,
// ce qui est déterministe (aucune horloge de Node comparée à celle de la base).
import { randomUUID } from 'node:crypto';
import type { TxClient } from '../../../src/db/tenant-tx';
import { ProblemException } from '../../../src/errors/problem';
import {
  partialRefundDayTotal,
  requireApprovalOverDailyCumul,
} from '../../../src/media/lifecycle/partial-refund-threshold';
import { withOwner } from '../../support/db';
import {
  createBatch,
  createMediaWorld,
  creditWallet,
  seedPersonalizedMedia,
  type MediaWorld,
} from '../../support/media-fixtures';

describe('seuil de la seconde personne au cumul du jour (rendu partiel)', () => {
  let w: MediaWorld;
  let mediaA: string;
  let mediaB: string;
  let walletOther: string;
  const run = <T>(fn: (c: TxClient) => Promise<T>) => withOwner((db) => fn(db));

  /** Ligne du jour côté base, à la seconde de la requête. */
  const dbNow = () =>
    withOwner(
      async (db) => (await db.query<{ n: Date }>('SELECT clock_timestamp() AS n')).rows[0]!.n,
    );
  const tomorrow = async () => new Date((await dbNow()).getTime() + 24 * 3600 * 1000);

  /** `WALLET_REFUND` : frais puis net (deux débits positifs du compte WALLET_PAID), contrepartie en banque. */
  const refund = (
    ledger: string,
    wallet: string,
    fee: number,
    net: number,
    options: { marker?: string | null; media?: string | null; type?: string } = {},
  ) =>
    withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      const marker = options.marker === undefined ? 'true' : options.marker;
      await db.query(
        `SELECT post_transaction($1, $2, $3, now(), 'ONLINE', jsonb_build_array(
           jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = $4 AND purpose = 'WALLET_PAID'), 'amount', $5::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = $4 AND purpose = 'WALLET_PAID'), 'amount', $6::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'BANK'), 'amount', -($5::bigint + $6::bigint))),
           NULL, NULL, NULL, NULL, NULL, NULL, $7::uuid, $8::jsonb)`,
        [
          ledger,
          options.type ?? 'WALLET_REFUND',
          `test-partial:${randomUUID()}`,
          wallet,
          fee,
          net,
          options.media ?? null,
          marker === null ? '{}' : JSON.stringify({ partial_cash_refund: marker }),
        ],
      );
    });

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      const batch = await createBatch(db, { operatorId: w.ops.a, organizerId: w.ids.organizerA });
      const seeded = await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: 2,
      });
      mediaA = seeded[0]!.id;
      mediaB = seeded[1]!.id;
      // Un second portefeuille dans le même grand livre, et un autre grand livre (autre événement).
      walletOther = randomUUID();
      await db.query('INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)', [
        walletOther,
        w.ops.a,
        w.ids.ledgerA,
      ]);
      for (const wallet of [w.ids.walletA, walletOther])
        await db.query(
          `INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
           VALUES ($1, $2, $3, 'CLAIM', 'WALLET_PAID', $4, 'C')`,
          [w.ops.a, w.ids.ledgerA, `L-WAL-${wallet}-P`, wallet],
        );
    });
    for (const wallet of [w.ids.walletA, walletOther])
      await withOwner((db) =>
        creditWallet(db, {
          operatorId: w.ops.a,
          ledgerId: w.ids.ledgerA,
          walletId: wallet,
          amount: 1_000_000,
        }),
      );
  });

  const total = async (wallet = w.ids.walletA) =>
    run(async (c) => partialRefundDayTotal(c, wallet, await dbNow(), w.ids.ledgerA));

  it('cumul nul sans rendu partiel', async () => {
    expect(await total(walletOther)).toBe(0n);
  });

  it('somme exacte du brut (frais + net) de trois rendus partiels du jour, tous bracelets', async () => {
    const before = await total();
    await refund(w.ids.ledgerA, w.ids.walletA, 100, 900, { media: mediaA });
    await refund(w.ids.ledgerA, w.ids.walletA, 50, 450, { media: mediaB });
    await refund(w.ids.ledgerA, w.ids.walletA, 10, 290, { media: null });
    expect((await total()) - before).toBe(1000n + 500n + 300n);
  });

  it('un autre portefeuille est exclu', async () => {
    const mine = await total();
    const theirs = await total(walletOther);
    await refund(w.ids.ledgerA, walletOther, 10, 90);
    expect(await total()).toBe(mine);
    expect(await total(walletOther)).toBe(theirs + 100n);
  });

  it('un WALLET_REFUND sans la marque (guichet de retour) est exclu, et une autre valeur aussi', async () => {
    const before = await total();
    await refund(w.ids.ledgerA, w.ids.walletA, 5, 95, { marker: null });
    await refund(w.ids.ledgerA, w.ids.walletA, 5, 95, { marker: 'false' });
    expect(await total()).toBe(before);
  });

  it('les rendus d’hier sont exclus : le jour suivant repart de zéro', async () => {
    expect(await total()).toBeGreaterThan(0n);
    const next = await tomorrow();
    const nextDay = await run((c) => partialRefundDayTotal(c, w.ids.walletA, next, w.ids.ledgerA));
    expect(nextDay).toBe(0n);
  });

  it('le grand livre filtre : un autre grand livre ne voit pas les rendus du portefeuille', async () => {
    const none = await run(async (c) =>
      partialRefundDayTotal(c, w.ids.walletA, await dbNow(), randomUUID()),
    );
    expect(none).toBe(0n);
  });

  describe('seuil (comparaison stricte, montant en cours compris)', () => {
    const approve = jest.fn(async () => 'approver-1');
    const decide = async (amount: bigint, limit: bigint, ok: boolean) =>
      run(async (c) =>
        requireApprovalOverDailyCumul(
          c,
          {
            walletId: w.ids.walletA,
            amount,
            limit,
            now: await dbNow(),
            ledgerId: w.ids.ledgerA,
          },
          ok ? approve : null,
        ),
      );

    beforeEach(() => approve.mockClear());

    it('total + montant = limite : passe sans jeton', async () => {
      const t = await total();
      const r = await decide(500n, t + 500n, false);
      expect(r).toEqual({ dayTotal: t, approvedBy: null });
      expect(approve).not.toHaveBeenCalled();
    });

    it('total + montant > limite sans valideur : 403 APPROVAL_REQUIRED', async () => {
      const t = await total();
      const error = await decide(501n, t + 500n, false).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).code).toBe('APPROVAL_REQUIRED');
      expect((error as ProblemException).status).toBe(403);
    });

    it('total + montant > limite avec valideur : valeur rendue, jeton consommé une fois', async () => {
      const t = await total();
      const r = await decide(501n, t + 500n, true);
      expect(r).toEqual({ dayTotal: t, approvedBy: 'approver-1' });
      expect(approve).toHaveBeenCalledTimes(1);
    });

    it('limite 0 : tout rendu exige un jeton', async () => {
      const error = await decide(1n, 0n, false).catch((e: unknown) => e);
      expect((error as ProblemException).code).toBe('APPROVAL_REQUIRED');
    });

    it('le cumul d’un autre portefeuille ne déclenche pas le seuil', async () => {
      const r = await run(async (c) =>
        requireApprovalOverDailyCumul(
          c,
          {
            walletId: randomUUID(),
            amount: 1n,
            limit: 1n,
            now: await dbNow(),
            ledgerId: w.ids.ledgerA,
          },
          null,
        ),
      );
      expect(r).toEqual({ dayTotal: 0n, approvedBy: null });
    });
  });
});
