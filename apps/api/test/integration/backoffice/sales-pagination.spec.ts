// Pagination par curseur des ventes (mission routes-backoffice 11b, WP06 ; NFR-002) : aucun doublon ni oubli,
// y compris quand plusieurs ventes partagent le même `occurred_at` (3 ventes par seconde dans le jeu).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';
import { decodeCursor, encodeCursor } from '../../../src/sales/sales.dto';
import { seedSales, type SalesFixture } from './sales-seed';

jest.setTimeout(120_000);

describe('pagination des ventes', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let small: SalesFixture;
  let big: SalesFixture;
  let expectedSmall: string[];
  let expectedBig: string[];

  const page = (event: string, query: string) =>
    request(app.getHttpServer())
      .get(`/v1/events/${event}/sales?${query}`)
      .set('Authorization', `Bearer ${w.operatorAdminA.token}`);

  /** Parcourt toutes les pages par curseur ; rend les identifiants dans l'ordre reçu. */
  async function walk(event: string, limit: number, extra = ''): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 2000; guard++) {
      const res = await page(
        event,
        `limit=${limit}${extra}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(limit);
      ids.push(...res.body.data.map((s: { transaction_id: string }) => s.transaction_id));
      expect(res.body.has_more).toBe(res.body.next_cursor !== null);
      if (!res.body.has_more) return ids;
      cursor = res.body.next_cursor as string;
    }
    throw new Error('pagination sans fin');
  }

  const expectedOrder = (event: string) =>
    withOwner(async (db) =>
      (
        await db.query<{ id: string }>(
          `SELECT id FROM journal_transaction WHERE event_id = $1 AND type = 'PURCHASE'
            ORDER BY occurred_at DESC, id DESC`,
          [event],
        )
      ).rows.map((r) => r.id),
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      small = await seedSales(db, w, { count: 120, rich: true });
    });
    expectedSmall = await expectedOrder(small.eventId);
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it('limit=7 : 120 ventes parcourues sans doublon ni oubli, dans l’ordre', async () => {
    const ids = await walk(small.eventId, 7);
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
    expect(ids).toEqual(expectedSmall);
  });

  it('égalités d’occurred_at : le curseur tranche par identifiant', async () => {
    const res = await page(small.eventId, 'limit=200');
    const stamps = res.body.data.map((s: { occurred_at: string }) => s.occurred_at);
    expect(new Set(stamps).size).toBeLessThan(stamps.length); // il y a bien des égalités
    // Une page qui coupe au milieu d'un groupe d'égalités : limit=1 sur tout le jeu.
    const ids = await walk(small.eventId, 1);
    expect(ids).toEqual(expectedSmall);
  });

  it('le filtre est conservé d’une page à l’autre', async () => {
    const ids = await walk(small.eventId, 5, `&merchant_id=${small.merchants[0]}`);
    expect(ids).toHaveLength(small.byMerchant[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('1 000 ventes à limit=200 : 0 écart (NFR-002)', async () => {
    await withOwner(async (db) => {
      big = await seedSales(db, w, {
        count: 1000,
        start: '2026-07-01T10:00:00Z',
        perSecond: 7,
      });
    });
    expectedBig = await expectedOrder(big.eventId);
    // Même événement que `small` (jeu du monde de test) : les 1 120 ventes, parcourues à 200.
    expect(expectedBig).toHaveLength(1120);
    const ids = await walk(big.eventId, 200);
    expect(ids).toHaveLength(1120);
    expect(new Set(ids).size).toBe(1120);
    expect(ids).toEqual(expectedBig);
  });

  it('curseur invalide : 422 ; limit hors bornes : 422', async () => {
    for (const q of [
      'cursor=abc',
      `cursor=${Buffer.from('[1,2]').toString('base64url')}`,
      `cursor=${Buffer.from(JSON.stringify(['2026-06-01', 'x'])).toString('base64url')}`,
      `cursor=${Buffer.from(JSON.stringify(["2026-06-01T10:00:00.000000Z'; --", '00000000-0000-0000-0000-000000000000'])).toString('base64url')}`,
      // jour inexistant (JS le décalerait au 1er mars, puis 22008 en base : 500)
      `cursor=${Buffer.from(JSON.stringify(['2026-02-30T00:00:00.000000Z', '00000000-0000-0000-0000-000000000000'])).toString('base64url')}`,
      `cursor=${Buffer.from(JSON.stringify(['2026-04-31T10:00:00.000000Z', '00000000-0000-0000-0000-000000000000'])).toString('base64url')}`,
      'limit=0',
      'limit=201',
    ]) {
      const res = await page(small.eventId, q);
      expect([q, res.status]).toEqual([q, 422]);
    }
  });

  it('le curseur est opaque et porte la dernière vente rendue (microsecondes)', async () => {
    const res = await page(small.eventId, 'limit=3');
    const decoded = decodeCursor(res.body.next_cursor);
    expect(decoded?.transactionId).toBe(res.body.data[2].transaction_id);
    expect(decoded?.occurredAt).toMatch(/\.\d{6}Z$/);
  });
});

describe('pagination des ventes annulées (chemin rapide de status=REVERSED)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let fx: SalesFixture;
  /** Ventes annulées, dans l'ordre du tri (occurred_at puis identifiant, décroissants), avec leur instant texte. */
  let expected: Array<{ id: string; text: string }>;
  /** Second événement du même prestataire, qui reçoit les 3 annulées les plus récentes du jeu (OP-N194). */
  let otherEventId: string;
  let movedToOther: string[];

  const page = (query: string) =>
    request(app.getHttpServer())
      .get(`/v1/events/${fx.eventId}/sales?status=REVERSED&${query}`)
      .set('Authorization', `Bearer ${w.operatorAdminA.token}`);

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      fx = await seedSales(db, w, { count: 40, rich: true });
      // Annulations supplémentaires (la vente n = 7 l'est déjà) : 8 annulées en tout, dont des égalités d'instant.
      await db.query(
        `INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                request_hash, occurred_at, recorded_at, source, device_id, reverses_id)
         SELECT gen_random_uuid(), operator_id, ledger_id, event_id, 'REVERSAL', 'rev2:' || id::text, 'h',
                occurred_at + interval '1 minute', now(), 'ONLINE', device_id, id
           FROM journal_transaction
          WHERE id = ANY($1::uuid[])`,
        [
          [
            fx.sales[1],
            fx.sales[2],
            fx.sales[4],
            fx.sales[5],
            fx.sales[11],
            fx.sales[20],
            fx.sales[30],
          ],
        ],
      );
      // Second événement du même prestataire : les 3 annulées les plus récentes y passent (pas de fuite entre
      // événements, pages pleines). Seul le propriétaire écrit ici ; le déclencheur d'ajout seul est écarté.
      otherEventId = randomUUID();
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
         SELECT $2::uuid, operator_id, organizer_id, 'Événement voisin', currency, timezone, jurisdiction_id,
                funds_holder FROM event WHERE id = $1`,
        [fx.eventId, otherEventId],
      );
      await db.query('BEGIN');
      await db.query('SET LOCAL session_replication_role = replica');
      movedToOther = (
        await db.query<{ id: string }>(
          `UPDATE journal_transaction SET event_id = $2
            WHERE id IN (SELECT t.id FROM journal_transaction t
                          WHERE t.event_id = $1 AND t.type = 'PURCHASE'
                            AND EXISTS (SELECT 1 FROM journal_transaction r WHERE r.reverses_id = t.id)
                          ORDER BY t.occurred_at DESC, t.id DESC LIMIT 3)
            RETURNING id`,
          [fx.eventId, otherEventId],
        )
      ).rows.map((r) => r.id);
      await db.query('COMMIT');
      expected = (
        await db.query<{ id: string; text: string }>(
          `SELECT id, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS text
             FROM journal_transaction t
            WHERE event_id = $1 AND type = 'PURCHASE'
              AND EXISTS (SELECT 1 FROM journal_transaction r WHERE r.reverses_id = t.id)
            ORDER BY occurred_at DESC, id DESC`,
          [fx.eventId],
        )
      ).rows;
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it('limit=1 puis curseur : toutes les annulées, has_more et next_cursor comme le chemin général', async () => {
    expect(expected).toHaveLength(5);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < expected.length; i++) {
      const res = await page(`limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      const row = expected[i]!;
      expect(res.body.data[0].transaction_id).toBe(row.id);
      expect(res.body.data[0].status).toBe('REVERSED');
      const last = i === expected.length - 1;
      expect(res.body.has_more).toBe(!last);
      expect(res.body.next_cursor).toBe(last ? null : encodeCursor(row.text, row.id));
      seen.push(res.body.data[0].transaction_id);
      cursor = res.body.next_cursor as string | null;
    }
    expect(seen).toEqual(expected.map((r) => r.id));
  });

  it('limit=3 : pages de 3, 2, sans doublon ni oubli', async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const res = await page(`limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status).toBe(200);
      sizes.push(res.body.data.length);
      ids.push(...res.body.data.map((s: { transaction_id: string }) => s.transaction_id));
      if (!res.body.has_more) break;
      cursor = res.body.next_cursor as string;
    }
    expect(sizes).toEqual([3, 2]);
    expect(ids).toEqual(expected.map((r) => r.id));
  });

  it('deux événements du même prestataire : aucune vente de l’autre, pages pleines, has_more exact', async () => {
    expect(movedToOther).toHaveLength(3);
    // Les 3 annulées les plus récentes sont celles de l'autre événement : sans le filtre d'événement de la CTE,
    // la première page de l'événement du lot ne contiendrait qu'elles, que la vue externe écarterait (page vide).
    const first = await page('limit=1');
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.data[0].transaction_id).toBe(expected[0]!.id);
    expect(first.body.has_more).toBe(true);
    const big = await page('limit=200');
    expect(big.body.data.map((s: { transaction_id: string }) => s.transaction_id)).toEqual(
      expected.map((r) => r.id),
    );
    expect(big.body.has_more).toBe(false);
    for (const id of movedToOther) {
      expect(JSON.stringify(big.body)).not.toContain(id);
    }
    const other = await request(app.getHttpServer())
      .get(`/v1/events/${otherEventId}/sales?status=REVERSED&limit=200`)
      .set('Authorization', `Bearer ${w.operatorAdminA.token}`);
    expect(other.status).toBe(200);
    expect(other.body.data.map((s: { transaction_id: string }) => s.transaction_id).sort()).toEqual(
      [...movedToOther].sort(),
    );
  });
});
