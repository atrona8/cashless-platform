// Intégration : recharge par carte (lot WP11, T057 ; FR-024, FR-025, FR-026 ; A11, A12). 3-D Secure explicite,
// empreinte, plafond par carte et par jour UTC de `receivedAt` (égalité acceptée, dépassement strict refusé),
// sérialisation de deux cartes identiques simultanées, `CARD_VELOCITY` une fois par empreinte nouvelle.
import { randomUUID } from 'node:crypto';
import { ownerRows } from '../../support/media-fixtures';
import { PspWorld } from './psp-fixtures';

describe('recharge par carte', () => {
  let p: PspWorld;

  beforeAll(async () => {
    p = await PspWorld.create();
  }, 180_000);
  afterAll(async () => {
    await p.close();
  });

  const setMax = (max: number) =>
    ownerRows('UPDATE event SET card_topup_daily_max_per_card = $2 WHERE id = $1', [
      p.ev.eventId,
      max,
    ]);
  const fp = () => `fp-${randomUUID()}`;
  const card = async (amount: number, fingerprint: string) =>
    p.topup({ method: 'CARD', amount }).then((t) => ({ t, fingerprint }));

  describe('3-D Secure et empreinte (FR-024, A11)', () => {
    it.each([
      ['NOT_PERFORMED', 'THREE_DS'],
      ['FAILED', 'THREE_DS'],
    ] as const)('3-D Secure %s : non crédité %s, anomalie du montant', async (threeDs, reason) => {
      const t = await p.topup({ method: 'CARD', amount: 6000 });
      const out = await p.pay(t.row, { card: { fingerprint: fp(), threeDs } });
      expect(out.outcome).toBe('NOT_CREDITED');
      const row = (await p.read(t.row.topupId))!;
      expect(row).toMatchObject({ status: 'FAILED', failureReason: reason, threeDs });
      expect(await p.transactions(t.row.topupId)).toEqual([]);
      const anomaly = (await p.anomalies('PSP_TOPUP_NOT_CREDITED')).find(
        (a) => a.id === row.anomalyId,
      );
      expect(anomaly?.amount).toBe('6000');
    });

    it('3-D Secure absent (aucune carte dans la notification) : non crédité', async () => {
      const t = await p.topup({ method: 'CARD' });
      expect((await p.pay(t.row, { card: null })).outcome).toBe('NOT_CREDITED');
      expect((await p.read(t.row.topupId))!.failureReason).toBe('THREE_DS');
    });

    it.each([null, '', '   '])(
      'empreinte absente ou vide (%j) : NO_FINGERPRINT',
      async (fingerprint) => {
        const t = await p.topup({ method: 'CARD' });
        const out = await p.pay(t.row, { card: { fingerprint, threeDs: 'SUCCEEDED' } });
        expect(out.outcome).toBe('NOT_CREDITED');
        expect(await p.read(t.row.topupId)).toMatchObject({
          status: 'FAILED',
          failureReason: 'NO_FINGERPRINT',
        });
      },
    );

    it('3-D Secure réussi avec empreinte : crédité, empreinte et 3-D Secure rangés, jamais dans l’audit', async () => {
      const f = fp();
      const t = await p.topup({ method: 'CARD', amount: 5000 });
      expect((await p.pay(t.row, { card: { fingerprint: f, threeDs: 'SUCCEEDED' } })).outcome).toBe(
        'CREDITED',
      );
      expect(await p.read(t.row.topupId)).toMatchObject({
        status: 'SUCCEEDED',
        cardFingerprint: f,
        threeDs: 'SUCCEEDED',
      });
      const leaks = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log WHERE after::text LIKE '%' || $1 || '%'`,
        [f],
      );
      expect(leaks[0]!.n).toBe(0);
    });
  });

  describe('plafond par carte et par jour UTC (FR-025, A12)', () => {
    it('max − 1 accepté, égalité acceptée, max + 1 refusé (OVER_LIMIT, montant à rendre)', async () => {
      await setMax(30000);
      const f = fp();
      const a = await card(29999, f);
      expect(
        (await p.pay(a.t.row, { card: { fingerprint: f, threeDs: 'SUCCEEDED' } })).outcome,
      ).toBe('CREDITED');
      // Cumul = 29999 ; +1 = 30000 = max : égalité acceptée.
      const b = await card(1, f);
      expect(
        (await p.pay(b.t.row, { card: { fingerprint: f, threeDs: 'SUCCEEDED' } })).outcome,
      ).toBe('CREDITED');
      // Cumul = 30000 ; +1 dépasse strictement.
      const c = await card(1, f);
      expect(
        (await p.pay(c.t.row, { card: { fingerprint: f, threeDs: 'SUCCEEDED' } })).outcome,
      ).toBe('NOT_CREDITED');
      const row = (await p.read(c.t.row.topupId))!;
      expect(row).toMatchObject({ status: 'FAILED', failureReason: 'CARD_DAILY_LIMIT' });
      expect(
        (await p.anomalies('PSP_TOPUP_OVER_LIMIT')).find((x) => x.id === row.anomalyId)?.amount,
      ).toBe('1');
      expect(await p.transactions(c.t.row.topupId)).toEqual([]);
    });

    it('jour civil UTC de receivedAt : compteur par jour, 23:59:59 et 00:00:00 de part et d’autre', async () => {
      await setMax(30000);
      const f = fp();
      const first = await card(30000, f);
      await p.pay(first.t.row, { card: { fingerprint: f, threeDs: 'SUCCEEDED' } });
      // Jour UTC lu de la base (jamais de l'horloge de Node).
      const [today0] = await ownerRows<{ d: string }>(
        "SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS d",
      );
      const d = today0!.d;
      const day = (offset: number, time: string) => {
        const base = new Date(`${d}T00:00:00Z`);
        base.setUTCDate(base.getUTCDate() + offset);
        return new Date(`${base.toISOString().slice(0, 10)}T${time}Z`);
      };
      const today = (at: Date) =>
        p.tx.run(p.op, async (client) => {
          const { rows } = await client.query<{ s: string }>(
            'SELECT card_topups_today($1, $2, $3)::text AS s',
            [p.ev.ledgerId, f, at.toISOString()],
          );
          return rows[0]!.s;
        });
      expect(await today(day(0, '00:00:00'))).toBe('30000');
      expect(await today(day(0, '23:59:59'))).toBe('30000');
      expect(await today(day(1, '00:00:00'))).toBe('0');
      expect(await today(day(-1, '23:59:59'))).toBe('0');
      // Le jour de receivedAt compte : refusé aux deux bornes du jour courant.
      for (const time of ['00:00:00', '23:59:59']) {
        const late = await card(5000, f);
        const out = await p.pay(
          late.t.row,
          { card: { fingerprint: f, threeDs: 'SUCCEEDED' } },
          { receivedAt: day(0, time) },
        );
        expect(out.outcome).toBe('NOT_CREDITED');
      }
    });

    it('deux notifications simultanées de la même empreinte au-delà du plafond cumulé : une seule créditée', async () => {
      await setMax(30000);
      const f = fp();
      const [x, y] = await Promise.all([card(20000, f), card(20000, f)]);
      const outcomes = await Promise.all(
        [x, y].map((c) => p.pay(c.t.row, { card: { fingerprint: f, threeDs: 'SUCCEEDED' } })),
      );
      expect(outcomes.map((o) => o.outcome).sort()).toEqual(['CREDITED', 'NOT_CREDITED']);
      const total = await ownerRows<{ s: string }>(
        `SELECT coalesce(sum(amount),0)::text AS s FROM psp_topup
          WHERE card_fingerprint = $1 AND status = 'SUCCEEDED'`,
        [f],
      );
      expect(total[0]!.s).toBe('20000');
    });
  });

  describe('CARD_VELOCITY (FR-026)', () => {
    it('empreinte nouvelle qui atteint le seuil : une anomalie de montant 0, pas de seconde au rejeu', async () => {
      await setMax(1_000_000);
      const w = await p.wallet();
      const before = (await p.anomalies('CARD_VELOCITY')).length;
      const prints = [fp(), fp(), fp()];
      let last: Awaited<ReturnType<PspWorld['topup']>> | undefined;
      for (const f of prints) {
        last = await p.topup({ method: 'CARD', amount: 1000, wallet: w });
        await p.pay(last.row, { card: { fingerprint: f, threeDs: 'SUCCEEDED' } });
      }
      // Seuil par défaut 3 : atteint à la troisième empreinte distincte.
      const after = await p.anomalies('CARD_VELOCITY');
      expect(after.length).toBe(before + 1);
      expect(after.at(-1)!.amount).toBe('0');
      // Rejeu de la même notification : doublon, aucune anomalie de plus.
      await p.pay(last!.row, { card: { fingerprint: prints[2]!, threeDs: 'SUCCEEDED' } });
      expect((await p.anomalies('CARD_VELOCITY')).length).toBe(before + 1);
      // Empreinte déjà connue : pas nouvelle, pas d'anomalie.
      const known = await p.topup({ method: 'CARD', amount: 1000, wallet: w });
      await p.pay(known.row, { card: { fingerprint: prints[0]!, threeDs: 'SUCCEEDED' } });
      expect((await p.anomalies('CARD_VELOCITY')).length).toBe(before + 1);
    });
  });
});
