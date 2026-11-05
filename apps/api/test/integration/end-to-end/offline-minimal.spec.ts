/* eslint-disable @typescript-eslint/no-explicit-any -- corps JSON du contrat lus champ par champ */
// Tests minimaux de `sync_protocol.md` §13 côté serveur (lot WP21, T087 ; SC-012, NFR-001, NFR-002, FR-044). Un
// `describe` par point ; les points 4 et 5 (bascule EDGE) sont reportés en mission 8 (research R-30.13) et ne sont pas
// écrits ici. Route réelle `POST /offline-batches`, VRAI processeur, base du lot, bigint exacts.
//   1. 100 rejeux du même lot et du même paiement : une écriture par clé ;
//   2. coupure au milieu d'un lot de 500 puis rejeu : résultats identiques à un traitement sans panne ;
//   3. transaction 22 du scénario de référence : écritures égales à `scenario_reference.json` ;
//   6. horloge du terminal à +2 h puis −2 h : corrections §7.4 et anomalies CLOCK_SKEW ;
//   7. bracelet bloqué pendant l'isolement : ventes antérieures débitées, postérieures en SUSPENSE.
import 'reflect-metadata';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { settleClock } from '../../support/offline-dataset';
import { OFFLINE_OPERATION_PROCESSOR } from '../../../src/offline/batches/batch.types';
import { scenario, transaction } from '../../unit/builders/support/scenario-lines';
import type { PayMedia } from '../payments/payments-fixtures';
import { ProcessingWorld } from '../offline/processing-fixtures';

jest.setTimeout(900_000);

describe('sync_protocol §13 : tests minimaux côté serveur', () => {
  let world: ProcessingWorld;

  beforeAll(async () => {
    world = await ProcessingWorld.create();
    // Configuration de frais de la transaction 22 du scénario : commission de 12 % TTC du commerçant (taxe incluse),
    // TVA de 18 % du profil de législation. Amorçage du propriétaire seulement.
    await withOwner(async (db) => {
      // Le profil est immuable : nouvelle version, avec la TVA, rattachée à l'événement.
      const profile = await db.query<{ id: string }>(
        `INSERT INTO jurisdiction_profile (country_code, version, valid_from, breakage_destination, rules)
         SELECT country_code, (1000000 + floor(random() * 1000000000))::int, valid_from,
                breakage_destination, $2::jsonb
           FROM jurisdiction_profile WHERE id = (SELECT jurisdiction_id FROM event WHERE id = $1)
         RETURNING id`,
        [
          world.pw.w.ids.eventA,
          JSON.stringify({ taxes: { VAT: { rate_bps: 1800, inclusive: true } } }),
        ],
      );
      await db.query('UPDATE event SET jurisdiction_id = $2 WHERE id = $1', [
        world.pw.w.ids.eventA,
        profile.rows[0]!.id,
      ]);
      await db.query(
        `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose,
                               basis, rate_bps, tax_code, tax_inclusive, trigger, valid_from)
         VALUES ($1, 'PARTICIPATION', $2, 'MERCHANT', 'ORG_COM', 'SALE_AMOUNT', 1200, 'VAT', true,
                 'REALTIME', '2026-01-01')`,
        [world.operatorId, world.pw.pos.participationId],
      );
    });
  });
  afterAll(async () => {
    await world?.close();
  });

  /** Terminal, bracelets et snapshot ; l'horloge de la base a rattrapé celle de Node (poste local). */
  const setup = async (funds: number, count = 1, snapshot = {}, policy = {}) => {
    const t = await world.terminal(policy);
    const media = await world.pw.media(count, funds);
    await settleClock();
    const version = await world.snapshot(t, media, snapshot);
    return { t, media, version };
  };
  const summary = (r: Record<string, unknown>) => ({
    seq: r.seq,
    status: r.status,
    effect: r.effect,
    reject_reason: r.reject_reason,
    charged_to_wallet: r.charged_to_wallet,
    shortfall_amount: r.shortfall_amount,
    retryable: r.retryable,
  });
  const txCount = (deviceId: string) =>
    ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM journal_transaction WHERE device_id = $1',
      [deviceId],
    ).then((r) => r[0]!.n);

  describe('§13-1 : 100 rejeux du même lot et du même paiement', () => {
    it('lot : 100 renvois (séquentiels puis concurrents), une écriture par opération, mêmes octets', async () => {
      const { t, media, version } = await setup(50_000);
      const ops = [1000, 2000, 3000].map((a) => world.sale(t, media[0]!, a, version));
      const first = await world.submit(t, ops);
      const body = (r: { body: Record<string, unknown> }) => JSON.stringify(r.body.results);
      const reference = body(first);
      const send = () =>
        t.t.submitBatch(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, first.batch);
      for (let i = 0; i < 40; i += 1) {
        const again = await send();
        expect([again.status, body(again)]).toEqual([200, reference]);
      }
      let replays = 0;
      for (let group = 0; group < 6; group += 1) {
        const burst = await Promise.all(Array.from({ length: 10 }, send));
        for (const again of burst) {
          // Un renvoi concurrent rend les mêmes octets ou attend (409 BATCH_IN_PROGRESS), jamais une autre réponse.
          expect([200, 409]).toContain(again.status);
          if (again.status === 200) {
            expect(body(again)).toBe(reference);
            replays += 1;
          } else expect(again.body.code).toBe('BATCH_IN_PROGRESS');
        }
      }
      expect(replays).toBeGreaterThan(0);
      expect(await txCount(t.t.deviceId)).toBe(3);
      expect(await world.pw.registry(t.t.deviceId)).toHaveLength(3);
      expect(await world.spendable(media[0]!.walletId)).toBe(44_000);
    });

    it('paiement : 100 envois de la même clé (séquentiels puis concurrents), une seule écriture', async () => {
      const pw = world.pw;
      const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
      const [m] = await pw.media(1, 50_000);
      await settleClock();
      const key = term.t.seqKey();
      const body = pw.keypadBody(term, { tap_id: await pw.readTap(term, m!) }, 4000);
      const pay = () => pw.pay(term, body, { key });
      const statuses: number[] = [];
      const ids = new Set<string>();
      const note = (res: Awaited<ReturnType<typeof pay>>) => {
        statuses.push(res.status);
        if (res.body.transaction_id) ids.add(String(res.body.transaction_id));
      };
      for (let i = 0; i < 40; i += 1) note(await pay());
      for (let group = 0; group < 6; group += 1)
        (await Promise.all(Array.from({ length: 10 }, pay))).forEach(note);
      expect(statuses).toHaveLength(100);
      expect(statuses[0]).toBe(201);
      expect(statuses.every((s) => s === 200 || s === 201 || s === 409)).toBe(true);
      expect(ids.size).toBe(1);
      const written = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_transaction WHERE idempotency_key = $1
            AND device_id = $2`,
        [key, term.t.deviceId],
      );
      expect(written[0]!.n).toBe(1);
      expect(await pw.spendable(m!.walletId)).toBe(46_000);
    });
  });

  describe('§13-2 : serveur coupé au milieu d’un lot de 500, puis rejeu', () => {
    it('résultats identiques à un traitement sans panne, aucune écriture en double, contiguous_acked_seq = 500', async () => {
      const proc: any = world.pw.api.app.get(OFFLINE_OPERATION_PROCESSOR, { strict: false });
      const original = proc.process.bind(proc);
      const a = await setup(100_000);
      const b = await setup(100_000);
      const build = (s: typeof a) =>
        Array.from({ length: 500 }, () => world.sale(s.t, s.media[0]!, 10, s.version));
      // Traitement sans panne (référence).
      const ref = await world.submit(a.t, build(a));
      const refResults = world.results(ref);
      expect(refResults).toHaveLength(500);
      // Traitement coupé après l'opération 250 (la 251e n'est pas traitée), puis rejeu des mêmes octets.
      let calls = 0;
      let armed = true;
      proc.process = async (ctx: unknown, op: unknown) => {
        if (armed) {
          calls += 1;
          if (calls === 251) {
            armed = false;
            throw new Error('coupure du serveur (test)');
          }
        }
        return original(ctx, op);
      };
      const cutBatch = b.t.t.buildBatch(build(b), { ledgerId: world.ledgerId });
      const send = () =>
        b.t.t.submitBatch(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, cutBatch);
      try {
        const cut = await send();
        expect(cut.status).toBe(500);
        expect(
          (
            await ownerRows<{ n: number }>(
              'SELECT count(*)::int AS n FROM offline_op_result WHERE batch_id = $1',
              [cutBatch.header.batch_id],
            )
          )[0]!.n,
        ).toBe(250);
        const resumed = await send();
        expect(resumed.status).toBe(200);
        const results = world.results(resumed);
        expect(results.map(summary)).toEqual(refResults.map(summary));
        expect(resumed.body.contiguous_acked_seq).toBe(500);
        expect(ref.body.contiguous_acked_seq).toBe(500);
      } finally {
        proc.process = original;
      }
      for (const s of [a, b]) {
        expect(await txCount(s.t.t.deviceId)).toBe(500);
        const reg = await world.pw.registry(s.t.t.deviceId);
        expect(reg).toHaveLength(500);
        expect(new Set(reg.map((r) => r.seq)).size).toBe(500);
        expect(await world.spendable(s.media[0]!.walletId)).toBe(95_000);
        const [dev] = await ownerRows<{ c: string }>(
          'SELECT contiguous_acked_seq::text AS c FROM device WHERE id = $1',
          [s.t.t.deviceId],
        );
        expect(dev!.c).toBe('500');
      }
    });
  });

  describe('§13-3 : transaction 22 du scénario de référence', () => {
    it('vente hors ligne de 9 000 sur 6 000 : lignes égales à scenario_reference.json (compte par compte, montant)', async () => {
      const { t, media, version } = await setup(6000);
      const res = await world.submit(t, [world.sale(t, media[0]!, 9000, version)]);
      const [r] = world.results(res);
      expect(r).toMatchObject({
        status: 'ACCEPTED_WITH_SHORTFALL',
        charged_to_wallet: 6000,
        shortfall_amount: 3000,
      });
      const [tx] = await world.txRows(t.t.deviceId);
      expect(tx).toMatchObject({ type: 'PURCHASE', source: 'OFFLINE_SYNC' });
      const purposeOf = new Map(scenario.accounts.map((a) => [a.code, a.purpose]));
      const expected = transaction(22).lines.map((l) => ({
        purpose: purposeOf.get(l.account)!,
        amount: String(l.amount),
      }));
      const written = (await world.postings(tx!.id)).map((p) => ({
        purpose: p.purpose,
        amount: p.amount,
      }));
      expect(written).toHaveLength(expected.length);
      const order = (x: { purpose: string; amount: string }) => `${x.purpose}:${x.amount}`;
      expect(written.map(order).sort()).toEqual(expected.map(order).sort());
      expect(transaction(22)).toMatchObject({ type: 'PURCHASE', source: 'OFFLINE_SYNC' });
    });
  });

  describe('§13-6 : horloge du terminal à +2 h puis −2 h', () => {
    it('+2 h : heure corrigée = réception, CLOCK_SKEW, date d’origine conservée ; −2 h : ramenée à la génération du snapshot', async () => {
      const { t, media, version } = await setup(50_000, 1, { generatedAgo: 1 });
      const ahead = world.sale(t, media[0]!, 1000, version, {}, -7200);
      const behind = world.sale(t, media[0]!, 1000, version, {}, 7200);
      const res = await world.submit(t, [ahead, behind]);
      const rs = world.results(res);
      expect(rs.map((r) => r.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
      const txs = await ownerRows<{
        idempotency_key: string;
        occurred_at: Date;
        original: string;
        received_at: Date;
        generated_at: Date;
      }>(
        `SELECT j.idempotency_key, j.occurred_at, j.metadata->>'device_occurred_at' AS original,
                b.received_at, s.generated_at
           FROM journal_transaction j
           JOIN offline_batch b ON b.id = $2
           JOIN offline_snapshot s ON s.ledger_id = j.ledger_id AND s.version = $3
          WHERE j.device_id = $1 ORDER BY j.idempotency_key`,
        [t.t.deviceId, res.batch.header.batch_id, version],
      );
      expect(txs).toHaveLength(2);
      const [first, second] = txs as [(typeof txs)[0], (typeof txs)[0]];
      expect(first.original).toBe(ahead.occurred_at);
      expect(Math.abs(first.occurred_at.getTime() - first.received_at.getTime())).toBeLessThan(
        1000,
      );
      expect(second.original).toBe(behind.occurred_at);
      expect(Math.abs(second.occurred_at.getTime() - second.generated_at.getTime())).toBeLessThan(
        1000,
      );
      const skews = await world.anomalies(t.t.deviceId, 'CLOCK_SKEW');
      expect(skews.map((a) => a.seq).sort()).toEqual(['1', '2']);
    });
  });

  describe('§13-7 : bracelet bloqué pendant l’isolement du terminal', () => {
    /** Historique de statut posé à la main (amorçage) : `[statut, secondes depuis maintenant]`. */
    const history = async (m: PayMedia, rows: Array<[string, number]>) =>
      withOwner(async (db) => {
        await db.query('BEGIN');
        await db.query('SET LOCAL session_replication_role = replica');
        await db.query('DELETE FROM media_status_history WHERE media_id = $1', [m.media.id]);
        let from: string | null = null;
        for (const [to, offset] of rows) {
          await db.query(
            `INSERT INTO media_status_history (operator_id, media_id, from_status, to_status, at)
             VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
            [world.operatorId, m.media.id, from, to, offset],
          );
          from = to;
        }
        await db.query('UPDATE media SET status = $2 WHERE id = $1', [m.media.id, rows.at(-1)![0]]);
        await db.query('COMMIT');
      });

    it('vente avant le blocage (plus que la tolérance) : débitée ; vente après : SUSPENSE, solde intact', async () => {
      const { t, media, version } = await setup(
        20_000,
        2,
        { generatedAgo: 2400 },
        {
          max_snapshot_age_seconds: 7200,
        },
      );
      const [before, after] = media as [PayMedia, PayMedia];
      // Les deux bracelets sont bloqués pendant l'isolement du terminal (snapshot antérieur) : l'un après la vente
      // (blocage 200 s plus tard, au-delà de la tolérance de 120 s), l'autre avant (131 s plus tôt).
      await history(before, [
        ['ACTIVE', -7200],
        ['SUSPENDED', 200],
      ]);
      await history(after, [
        ['ACTIVE', -7200],
        ['SUSPENDED', -131],
      ]);
      const res = await world.submit(t, [
        world.sale(t, before, 5000, version),
        world.sale(t, after, 5000, version),
      ]);
      const [a, b] = world.results(res);
      expect(a).toMatchObject({ status: 'ACCEPTED', charged_to_wallet: 5000 });
      expect(b).toMatchObject({
        status: 'ACCEPTED_WITH_SHORTFALL',
        charged_to_wallet: 0,
        shortfall_amount: 5000,
        shortfall_reason: 'MEDIA_BLOCKED_AFTER_SNAPSHOT',
      });
      const txs = await world.txRows(t.t.deviceId);
      const lines = async (id: string) =>
        (await world.postings(id)).map((p) => `${p.purpose}:${p.amount}`);
      expect(await lines(txs[0]!.id)).toEqual(
        expect.arrayContaining(['WALLET_PAID:5000', 'MERCHANT:-5000']),
      );
      expect(await lines(txs[1]!.id)).toEqual(
        expect.arrayContaining(['SUSPENSE:5000', 'MERCHANT:-5000']),
      );
      expect(await world.spendable(before.walletId)).toBe(15_000);
      expect(await world.spendable(after.walletId)).toBe(20_000);
    });
  });

  it('les points 4 et 5 (bascule EDGE) sont reportés en mission 8 : aucun test ici (R-30.13)', () => {
    expect(true).toBe(true);
  });
});
