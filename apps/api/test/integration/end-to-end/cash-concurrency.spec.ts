// Concurrence des caisses, par la vraie route HTTP (mission 6, lot WP14, T071 ; NFR-008, SC-003). Ordre des verrous :
// caisse -> session. Fermeture pendant des recharges espèces : chaque recharge précède `CLOSING` (et entre dans le
// théorique) ou est refusée ; jamais d'écriture d'espèces après `CASH_CLOSE` ; deux fermetures simultanées : une seule
// `CASH_CLOSE` ; deux ouvertures simultanées sur un terminal : une seule session `OPEN`. Lancé en série.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';
import {
  activateMedia,
  createBatch,
  ledgerIsSound,
  ownerRows,
  seedPersonalizedMedia,
  tapBody,
} from '../../support/media-fixtures';
import { ChargebackWorld } from '../chargebacks/chargeback-fixtures';

jest.setTimeout(600_000);

describe('NFR-008, SC-003 : concurrence des caisses', () => {
  let c: ChargebackWorld;
  let batchId = '';
  let tap = 5000;
  const cw = () => c.cw;
  const p = () => c.p;

  beforeAll(async () => {
    c = await ChargebackWorld.create();
    batchId = await withOwner((db) =>
      createBatch(db, {
        operatorId: p().op,
        organizerId: cw().w.ids.organizerA,
        eventId: p().ev.eventId,
        status: 'ACTIVE',
      }),
    );
  }, 300_000);
  afterAll(async () => {
    await c?.close();
  });
  afterEach(async () => {
    expect(await ledgerIsSound(p().ev.ledgerId)).toEqual({ unbalanced: 0, drift: 0 });
  });

  const brace = async () => {
    const wallet = await p().wallet();
    return withOwner(async (db) => {
      const [m] = await seedPersonalizedMedia(db, {
        operatorId: p().op,
        batchId,
        kmsKeyRef: cw().w.keyRef.a,
        count: 1,
      });
      await activateMedia(db, {
        operatorId: p().op,
        eventId: p().ev.eventId,
        walletId: wallet.walletId,
        mediaIds: [m!.id],
      });
      return m!;
    });
  };

  // Corrigé par la migration 0040 (cycle 2 de WP14) : `begin_cash_close` prend le terminal avant la session et
  // le solde, comme une recharge ; avant, 40P01 (500) dès 2 recharges simultanées.
  it(
    'fermeture pendant 8 recharges espèces : théorique = 1000 + recharges acceptées, caisse à 0, un CASH_CLOSE',
    async () => {
      const { t, id } = await cw().ready({ expected: 1000, counted: null });
      const medias = [];
      for (let i = 0; i < 8; i += 1) medias.push(await brace());
      const counted = await cw().count(t, id, cw().w.cashierA, 1000);
      expect(counted.status).toBe(200);
      const topups = medias.map((m) =>
        cw().term(t, 'POST', '/topups/cash', cw().w.cashierA, {
          amount: 100,
          currency: 'XOF',
          occurred_at: new Date().toISOString(),
          tap: tapBody(m, (tap += 1)),
        }),
      );
      const [closed, ...results] = await Promise.all([
        cw().closeBo(id, cw().supervisor),
        ...topups,
      ]);
      expect(closed.status).toBe(200);
      const accepted = results.filter((r) => r.status === 201).length;
      expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      const session = (await cw().session(id))!;
      expect(Number(session.expected_amount)).toBe(1000 + 100 * accepted);
      expect(await cw().deskBalance(t)).toBe(0);
      const closes = (await cw().transactionsOf(p().ev.ledgerId, 'CASH_CLOSE')).filter(
        (x) => x.idempotency_key === `cash-close:${id}`,
      );
      expect(closes).toHaveLength(1);
      // Jamais d'écriture d'espèces après CASH_CLOSE : les TOPUP_CASH rattachés sont les recharges acceptées
      // (l'amorçage `seedCash` passe par le moteur, sans rattachement).
      const attached = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM cash_session_tx s JOIN journal_transaction j ON j.id = s.tx_id
        WHERE s.cash_session_id = $1 AND j.type = 'TOPUP_CASH'`,
        [id],
      );
      expect(attached[0]!.n).toBe(accepted);
    },
  );

  it('deux fermetures simultanées (HTTP, clés différentes) : une seule CASH_CLOSE, l’autre 409', async () => {
    const { id } = await cw().ready({ expected: 700, counted: 700 });
    const [a, b] = await Promise.all([
      cw().closeBo(id, cw().supervisor, randomUUID()),
      cw().closeBo(id, cw().supervisor3, randomUUID()),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const closes = (await cw().transactionsOf(p().ev.ledgerId, 'CASH_CLOSE')).filter(
      (x) => x.idempotency_key === `cash-close:${id}`,
    );
    expect(closes).toHaveLength(1);
  });

  it('deux ouvertures simultanées sur le même terminal : une seule session OPEN', async () => {
    const t = await cw().terminal();
    const [a, b] = await Promise.all([
      cw().term(t, 'POST', '/cash-sessions', cw().w.cashierA, {}),
      cw().term(t, 'POST', '/cash-sessions', cw().w.cashierA, {}),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const open = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM cash_session WHERE device_id = $1 AND status IN ('OPEN','CLOSING')`,
      [t.deviceId],
    );
    expect(open[0]!.n).toBe(1);
  });
});
