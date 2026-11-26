// Liste des anomalies `GET /anomalies` (mission routes-backoffice 11b, WP07 ; FR-008, FR-010, NFR-006).
// Les comptages sont limités aux prestataires du monde de test (créés pour ce fichier).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parse } from 'yaml';
import { ANOMALY_KINDS } from '../../../src/anomalies/anomalies.dto';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';

jest.setTimeout(300_000);

describe('GET /anomalies', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let eventA2: string;
  let ledgerA2: string;
  let organizerA2: string;
  let organizerAdminA2: TestPerson;
  let operatorAdminB: TestPerson;
  let ledgerB: string;
  const ids: Record<string, string> = {};

  const get = (person: TestPerson, query = '') =>
    request(app.getHttpServer())
      .get(`/v1/anomalies${query}`)
      .set('Authorization', `Bearer ${person.token}`);

  const insert = async (
    db: import('pg').Client,
    operatorId: string,
    ledger: string | null,
    kind: string,
    extra: { createdAt?: string; amount?: number; detail?: object; status?: string } = {},
  ): Promise<string> => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, status, detail, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, coalesce($8::timestamptz, now()))`,
      [
        id,
        operatorId,
        ledger,
        kind,
        ledger === null ? 0 : (extra.amount ?? 1000),
        extra.status ?? 'OPEN',
        extra.detail ? JSON.stringify(extra.detail) : null,
        extra.createdAt ?? null,
      ],
    );
    return id;
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    organizerA2 = randomUUID();
    eventA2 = randomUUID();
    const organizerB = w.ids.organizerB;
    const eventB = randomUUID();
    await withOwner(async (db) => {
      const profile = (
        await db.query<{ id: string }>('SELECT id FROM jurisdiction_profile LIMIT 1')
      ).rows[0]!.id;
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code)
         VALUES ($1, 'ORGANIZER', $2, 'Organisateur A2', 'SN')`,
        [organizerA2, w.ops.a],
      );
      const openEvent = async (operator: string, organizer: string, event: string) => {
        await db.query(
          `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
           VALUES ($1, $2, $3, 'Événement', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
          [event, operator, organizer, profile],
        );
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [operator]);
        return (
          await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [event])
        ).rows[0]!.ledger;
      };
      ledgerA2 = await openEvent(w.ops.a, organizerA2, eventA2);
      ledgerB = await openEvent(w.ops.b, organizerB, eventB);
      organizerAdminA2 = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: organizerA2 }],
      });
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      });
      ids.cashDiff = await insert(db, w.ops.a, w.ids.ledgerA, 'CASH_DIFF', {
        detail: { secret: 'DETAIL-SECRET' },
      });
      ids.shortfall = await insert(db, w.ops.a, w.ids.ledgerA, 'OFFLINE_SHORTFALL');
      ids.resolved = await insert(db, w.ops.a, w.ids.ledgerA, 'CLOCK_SKEW', { status: 'RESOLVED' });
      ids.a2 = await insert(db, w.ops.a, ledgerA2, 'CARD_VELOCITY');
      ids.noLedger = await insert(db, w.ops.a, null, 'UID_MISMATCH');
      ids.b = await insert(db, w.ops.b, ledgerB, 'CASH_DIFF');
      // 35 anomalies d'un type réservé à la pagination, dont des horodatages identiques (départage par identifiant).
      for (let i = 0; i < 35; i += 1)
        await insert(db, w.ops.a, w.ids.ledgerA, 'VOID_CONFLICT', {
          createdAt: `2026-03-01T10:00:${String(Math.floor(i / 2)).padStart(2, '0')}.000Z`,
        });
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const idsOf = (res: request.Response): string[] =>
    (res.body.data as Array<{ anomaly_id: string }>).map((a) => a.anomaly_id);

  it('la liste des types du filtre est celle du contrat', () => {
    const contract = parse(
      readFileSync(join(__dirname, '../../../../../packages/contracts/openapi.yaml'), 'utf8'),
    ) as { components: { schemas: { Anomaly: { properties: { kind: { enum: string[] } } } } } };
    expect([...ANOMALY_KINDS].sort()).toEqual(
      [...contract.components.schemas.Anomaly.properties.kind.enum].sort(),
    );
  });

  it('OPERATOR_ADMIN : toutes les anomalies de son prestataire, aucune de l’autre ; `classifiable` de la base', async () => {
    const res = await get(w.operatorAdminA, '?limit=200');
    expect(res.status).toBe(200);
    expect(contractViolations('AnomalyPage', res.body)).toEqual([]);
    const got = idsOf(res);
    for (const key of ['cashDiff', 'shortfall', 'resolved', 'a2', 'noLedger'])
      expect(got).toContain(ids[key]);
    expect(got).not.toContain(ids.b);
    const byId = new Map<string, { classifiable: boolean; kind: string }>(
      res.body.data.map((a: { anomaly_id: string; classifiable: boolean; kind: string }) => [
        a.anomaly_id,
        a,
      ]),
    );
    expect(byId.get(ids.cashDiff!)!.classifiable).toBe(true);
    expect(byId.get(ids.shortfall!)!.classifiable).toBe(false);
  });

  it('seuls les champs du contrat sortent : ni detail, ni ledger_id, ni operator_id', async () => {
    const res = await get(w.operatorAdminA, '?kind=CASH_DIFF');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      [
        'amount',
        'anomaly_id',
        'classifiable',
        'created_at',
        'currency',
        'device_id',
        'event_id',
        'kind',
        'media_id',
        'status',
        'transaction_id',
      ].sort(),
    );
    expect(JSON.stringify(res.body)).not.toContain('DETAIL-SECRET');
    expect(res.body.data[0]).toMatchObject({
      event_id: w.ids.eventA,
      amount: 1000,
      currency: 'XOF',
    });
  });

  it('anomalie sans grand livre : visible du seul OPERATOR_ADMIN, sans événement, montant ni devise (F3)', async () => {
    const op = await get(w.operatorAdminA, '?kind=UID_MISMATCH');
    expect(op.body.data).toHaveLength(1);
    expect(op.body.data[0]).toMatchObject({
      anomaly_id: ids.noLedger,
      event_id: null,
      amount: null,
      currency: null,
    });
    expect(contractViolations('Anomaly', op.body.data[0])).toEqual([]);
    for (const organizer of [w.organizerAdminA, organizerAdminA2]) {
      const res = await get(organizer, '?kind=UID_MISMATCH&limit=200');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    }
  });

  it('ORGANIZER_ADMIN : seulement les anomalies des événements de ses organisateurs', async () => {
    const a1 = idsOf(await get(w.organizerAdminA, '?limit=200'));
    expect(a1).toContain(ids.cashDiff);
    expect(a1).not.toContain(ids.a2);
    expect(a1).not.toContain(ids.b);
    const a2 = idsOf(await get(organizerAdminA2, '?limit=200'));
    expect(a2).toEqual([ids.a2]);
  });

  it('filtre event_id hors portée : liste vide, 200, sans indice', async () => {
    const own = await get(organizerAdminA2, `?event_id=${w.ids.eventA}`);
    expect(own.status).toBe(200);
    expect(own.body).toEqual({ data: [], next_cursor: null, has_more: false });
    const other = await get(w.operatorAdminA, `?event_id=${randomUUID()}`);
    expect(other.body.data).toEqual([]);
    const ofB = await get(w.operatorAdminA, `?event_id=${w.ids.organizerB}`);
    expect(ofB.body.data).toEqual([]);
  });

  it('filtres kind, status, from et to', async () => {
    expect(idsOf(await get(w.operatorAdminA, '?kind=CLOCK_SKEW'))).toEqual([ids.resolved]);
    const resolved = await get(w.operatorAdminA, '?status=RESOLVED&limit=200');
    expect(idsOf(resolved)).toEqual([ids.resolved]);
    expect(resolved.body.data[0].status).toBe('RESOLVED');
    const open = idsOf(await get(w.operatorAdminA, '?status=OPEN&limit=200'));
    expect(open).not.toContain(ids.resolved);
    const window = await get(
      w.operatorAdminA,
      '?kind=VOID_CONFLICT&from=2026-03-01T10:00:05Z&to=2026-03-01T10:00:10Z&limit=200',
    );
    expect(window.body.data.length).toBeGreaterThan(0);
    for (const a of window.body.data as Array<{ created_at: string }>) {
      expect(Date.parse(a.created_at)).toBeGreaterThanOrEqual(Date.parse('2026-03-01T10:00:05Z'));
      expect(Date.parse(a.created_at)).toBeLessThan(Date.parse('2026-03-01T10:00:10Z'));
    }
    // 5 secondes de fenêtre, deux anomalies par seconde (à l'identique) : 10 exactement.
    expect(window.body.data).toHaveLength(10);
  });

  it('pagination : 35 anomalies par pages de 7, sans doublon ni trou, ordre décroissant', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await get(
        w.operatorAdminA,
        `?kind=VOID_CONFLICT&limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(res.status).toBe(200);
      seen.push(...idsOf(res));
      cursor = res.body.next_cursor;
      expect(res.body.has_more).toBe(cursor !== null);
      pages += 1;
    } while (cursor && pages < 20);
    expect(pages).toBe(5);
    expect(seen).toHaveLength(35);
    expect(new Set(seen).size).toBe(35);
    const times = (
      await withOwner(
        async (db) =>
          (
            await db.query<{ id: string; t: string }>(
              `SELECT id, created_at::text AS t FROM anomaly WHERE id = ANY($1::uuid[])`,
              [seen],
            )
          ).rows,
      )
    ).reduce((m, r) => m.set(r.id, r.t), new Map<string, string>());
    const stamps = seen.map((id) => Date.parse(times.get(id)!));
    expect([...stamps].sort((x, y) => y - x)).toEqual(stamps);
  });

  it('paramètres invalides : 422 VALIDATION_FAILED', async () => {
    for (const query of [
      '?kind=INCONNU',
      '?status=CLOSED',
      '?limit=0',
      '?limit=201',
      '?limit=abc',
      '?cursor=%25%25%25',
      `?cursor=${Buffer.from('["x","y"]').toString('base64url')}`,
      '?event_id=pas-un-uuid',
      '?from=hier',
      '?kind=CASH_DIFF&kind=CLOCK_SKEW',
    ]) {
      const res = await get(w.operatorAdminA, query);
      expect({ query, status: res.status, code: res.body.code }).toEqual({
        query,
        status: 422,
        code: 'VALIDATION_FAILED',
      });
    }
  });

  it('rôles : CASHIER, SUPERVISOR, PLATFORM_ADMIN refusés (403) ; autre prestataire : ses seules anomalies', async () => {
    for (const person of [w.cashierA, w.supervisorA, w.platformAdmin])
      expect((await get(person)).status).toBe(403);
    const b = await get(operatorAdminB, '?limit=200');
    expect(b.status).toBe(200);
    expect(idsOf(b)).toEqual([ids.b]);
    expect((await request(app.getHttpServer()).get('/v1/anomalies')).status).toBe(401);
  });
});
