// Codes d'enrôlement (contracts/enrollment.md, lot WP14, T066, T067) : création par OPERATOR_ADMIN
// ou ORGANIZER_ADMIN (ses événements), code affiché une fois et jamais conservé (empreinte
// HMAC-SHA256 à clé seule ; rejeu de la clé d'idempotence : 409 sans le code), refus du contrat,
// liste des codes en cours sans le code ni son empreinte, isolation à deux prestataires.
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { APP_CONFIG, type AppConfig } from '../../../src/config/config';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';

const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}(-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}){2}$/;
const SUMMARY_KEYS = [
  'app_mode',
  'created_at',
  'created_by',
  'enrollment_code_id',
  'event_id',
  'expires_at',
  'kind',
  'personal_phone',
  'pos_id',
  'station_name',
];

describe('codes d’enrôlement (T066, T067)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let key: Buffer;
  /** Événement d'un second organisateur du prestataire A (hors portée de organizerAdminA). */
  let eventA2: string;
  let eventB: string;
  let operatorAdminB: TestPerson;

  const create = (
    who: TestPerson,
    body: Record<string, unknown>,
    idempotencyKey: string = randomUUID(),
  ) =>
    request(app.getHttpServer())
      .post('/v1/device-enrollment-codes')
      .set('Authorization', `Bearer ${who.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
  const base = (eventId: string) => ({
    event_id: eventId,
    app_mode: 'CATALOG_POS',
    kind: 'POS',
    personal_phone: false,
  });
  const list = (who: TestPerson, query = '') =>
    request(app.getHttpServer())
      .get(`/v1/device-enrollment-codes${query}`)
      .set('Authorization', `Bearer ${who.token}`);

  beforeAll(async () => {
    w = await createMediaWorld();
    app = await createTestApp({ identity: w.idp });
    key = app.get<AppConfig>(APP_CONFIG, { strict: false }).enrollmentCodeHmacKey;
    const organizerA2 = randomUUID();
    eventA2 = randomUUID();
    eventB = randomUUID();
    await withOwner(async (db) => {
      const profile = (
        await db.query<{ jurisdiction_id: string }>(
          'SELECT jurisdiction_id FROM event WHERE id = $1',
          [w.ids.eventA],
        )
      ).rows[0]!.jurisdiction_id;
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code)
         VALUES ($1, 'ORGANIZER', $2, 'Organisateur A2', 'SN')`,
        [organizerA2, w.ops.a],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                            jurisdiction_id, funds_holder)
         VALUES ($1, $2, $3, 'Événement A2', 'XOF', 'Africa/Dakar', $6, 'ORGANIZER'),
                ($4, $5, $7, 'Événement B', 'XOF', 'Africa/Dakar', $6, 'ORGANIZER')`,
        [eventA2, w.ops.a, organizerA2, eventB, w.ops.b, profile, w.ids.organizerB],
      );
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('OPERATOR_ADMIN : code affiché une fois, empreinte HMAC seule, audit sans code', async () => {
    const res = await create(w.operatorAdminA, { ...base(w.ids.eventA), expires_in_seconds: 600 });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'app_mode',
      'code',
      'enrollment_code_id',
      'expires_at',
    ]);
    const code = String(res.body.code);
    expect(code).toMatch(CODE);
    expect(res.body.app_mode).toBe('CATALOG_POS');
    const normalized = code.replace(/-/g, '');
    const [row] = await ownerRows<{
      code_hash: Buffer;
      ttl: number;
      expires_at: Date;
      created_by: string;
      personal_phone: boolean;
    }>(
      `SELECT code_hash, extract(epoch FROM expires_at - created_at)::int AS ttl, expires_at,
              created_by, personal_phone
         FROM device_enrollment_code WHERE id = $1`,
      [res.body.enrollment_code_id],
    );
    expect(row!.code_hash.equals(createHmac('sha256', key).update(normalized).digest())).toBe(true);
    expect(row!.code_hash.equals(createHash('sha256').update(normalized).digest())).toBe(false);
    expect(row!.ttl).toBe(600);
    expect(new Date(String(res.body.expires_at)).getTime()).toBe(row!.expires_at.getTime());
    expect(row!.created_by).toBe(w.operatorAdminA.userId);
    const audit = await ownerRows<{ text: string; actor_role: string }>(
      `SELECT a::text AS text, actor_role FROM audit_log a
        WHERE action = 'DEVICE_ENROLLMENT_CODE_CREATED' AND object_id = $1`,
      [res.body.enrollment_code_id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_role).toBe('OPERATOR_ADMIN');
    expect(audit[0]!.text).not.toContain(normalized);
    expect(audit[0]!.text).not.toContain(code);
  });

  it('durée par défaut 24 h ; personal_phone true en KEYPAD_TPE', async () => {
    const res = await create(w.operatorAdminA, {
      ...base(w.ids.eventA),
      app_mode: 'KEYPAD_TPE',
      personal_phone: true,
    });
    expect(res.status).toBe(201);
    const [row] = await ownerRows<{ ttl: number; personal_phone: boolean; app_mode: string }>(
      `SELECT extract(epoch FROM expires_at - created_at)::int AS ttl, personal_phone, app_mode
         FROM device_enrollment_code WHERE id = $1`,
      [res.body.enrollment_code_id],
    );
    expect(row).toEqual({ ttl: 86_400, personal_phone: true, app_mode: 'KEYPAD_TPE' });
  });

  it('rejeu de la clé d’idempotence : 409, jamais le code, absent du registre', async () => {
    const idempotencyKey = randomUUID();
    const first = await create(w.operatorAdminA, base(w.ids.eventA), idempotencyKey);
    expect(first.status).toBe(201);
    const code = String(first.body.code);
    const replay = await create(w.operatorAdminA, base(w.ids.eventA), idempotencyKey);
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('CONFLICT_STATE');
    expect(replay.text).not.toContain(code);
    expect(replay.text).not.toContain(code.replace(/-/g, ''));
    const stored = await ownerRows<{ text: string }>(
      'SELECT r::text AS text FROM api_idempotency r WHERE idempotency_key = $1',
      [idempotencyKey],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.text).not.toContain(code);
    expect(stored[0]!.text).not.toContain(code.replace(/-/g, ''));
    // Un seul code créé pour les deux envois.
    const [{ n }] = (await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE action = 'DEVICE_ENROLLMENT_CODE_CREATED' AND request_id IS NOT NULL
          AND object_id = $1`,
      [first.body.enrollment_code_id],
    )) as [{ n: number }];
    expect(n).toBe(1);
  });

  it('Idempotency-Key obligatoire', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/device-enrollment-codes')
      .set('Authorization', `Bearer ${w.operatorAdminA.token}`)
      .send(base(w.ids.eventA));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('event_id obligatoire et validé avant la base : 400, aucun code créé', async () => {
    // Codes du seul prestataire de la suite : d'autres suites (enrollment.spec.ts) en créent en
    // parallèle (report de WP14 vers WP18).
    const count = () =>
      ownerRows<{ n: number }>(
        'SELECT count(*)::int AS n FROM device_enrollment_code WHERE operator_id = $1',
        [w.ops.a],
      );
    const before = await count();
    const { event_id: _event, ...withoutEvent } = base(w.ids.eventA);
    for (const body of [withoutEvent, { ...withoutEvent, event_id: 'pas-un-uuid' }]) {
      const res = await create(w.operatorAdminA, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    const after = await count();
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it.each([
    ['durée sous 300 s', { expires_in_seconds: 299 }, 422, 'VALIDATION_FAILED'],
    ['durée au-delà de 7 jours', { expires_in_seconds: 604_801 }, 422, 'VALIDATION_FAILED'],
    ['durée non entière', { expires_in_seconds: 600.5 }, 400, 'VALIDATION_FAILED'],
    ['PAIRED_TPE', { app_mode: 'PAIRED_TPE' }, 422, 'DEVICE_MODE_NOT_ALLOWED'],
    [
      'téléphone personnel hors KEYPAD_TPE',
      { personal_phone: true },
      422,
      'DEVICE_MODE_NOT_ALLOWED',
    ],
    ['personal_phone absent', { personal_phone: undefined }, 400, 'VALIDATION_FAILED'],
    ['mode absent', { app_mode: undefined }, 400, 'VALIDATION_FAILED'],
    ['kind incohérent', { app_mode: 'TOPUP_DESK', kind: 'POS' }, 422, 'VALIDATION_FAILED'],
  ])('refus : %s', async (_label, change, status, code) => {
    const res = await create(w.operatorAdminA, { ...base(w.ids.eventA), ...change });
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
  });

  it('durées limites 300 s et 604 800 s acceptées', async () => {
    for (const ttl of [300, 604_800]) {
      const res = await create(w.operatorAdminA, {
        ...base(w.ids.eventA),
        expires_in_seconds: ttl,
      });
      expect(res.status).toBe(201);
    }
  });

  it('ORGANIZER_ADMIN : ses événements seulement (autre organisateur : 404)', async () => {
    const own = await create(w.organizerAdminA, base(w.ids.eventA));
    expect(own.status).toBe(201);
    const other = await create(w.organizerAdminA, base(eventA2));
    expect(other.status).toBe(404);
    expect(other.body.code).toBe('NOT_FOUND');
  });

  it('autres rôles : 403 ; événement d’un autre prestataire : 404', async () => {
    const cashier = await create(w.cashierA, base(w.ids.eventA));
    expect(cashier.status).toBe(403);
    const foreign = await create(w.operatorAdminA, base(eventB));
    expect(foreign.status).toBe(404);
    const reverse = await create(operatorAdminB, base(w.ids.eventA));
    expect(reverse.status).toBe(404);
  });

  it('liste : codes en cours du périmètre, sans code ni empreinte, par curseur', async () => {
    const mine = await create(w.operatorAdminA, base(eventA2));
    expect(mine.status).toBe(201);
    const expired = await create(w.operatorAdminA, base(eventA2));
    expect(expired.status).toBe(201);
    await withOwner((db) =>
      db.query(
        `UPDATE device_enrollment_code
            SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
          WHERE id = $1`,
        [expired.body.enrollment_code_id],
      ),
    );
    const all: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;
    do {
      const query: string = `?event_id=${eventA2}&limit=1${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await list(w.operatorAdminA, query);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(1);
      all.push(...(res.body.data as Array<Record<string, unknown>>));
      cursor = res.body.next_cursor as string | null;
    } while (cursor);
    expect(all.map((c) => c.enrollment_code_id)).toEqual([mine.body.enrollment_code_id]);
    expect(Object.keys(all[0]!).sort()).toEqual(SUMMARY_KEYS);
    expect(all[0]).toMatchObject({
      event_id: eventA2,
      app_mode: 'CATALOG_POS',
      kind: 'POS',
      personal_phone: false,
      station_name: null,
      created_by: w.operatorAdminA.userId,
    });
    const text = JSON.stringify(all);
    expect(text).not.toContain(String(mine.body.code));
    expect(text).not.toContain(String(mine.body.code).replace(/-/g, ''));
    // ORGANIZER_ADMIN de l'organisateur A : aucun code de A2.
    const organizer = await list(w.organizerAdminA, '?limit=200');
    expect(organizer.status).toBe(200);
    const events = new Set(
      (organizer.body.data as Array<{ event_id: string }>).map((c) => c.event_id),
    );
    expect(events.has(eventA2)).toBe(false);
    expect(events.has(w.ids.eventA)).toBe(true);
  });

  it('isolation : un prestataire ne voit jamais les codes d’un autre', async () => {
    const a = await create(w.operatorAdminA, base(w.ids.eventA));
    const b = await create(operatorAdminB, base(eventB));
    expect([a.status, b.status]).toEqual([201, 201]);
    const seenByB = await list(operatorAdminB, '?limit=200');
    const idsB = (seenByB.body.data as Array<{ enrollment_code_id: string; event_id: string }>).map(
      (c) => c.enrollment_code_id,
    );
    expect(idsB).toContain(b.body.enrollment_code_id);
    expect(idsB).not.toContain(a.body.enrollment_code_id);
    expect(
      (seenByB.body.data as Array<{ event_id: string }>).every((c) => c.event_id === eventB),
    ).toBe(true);
    const filtered = await list(operatorAdminB, `?event_id=${w.ids.eventA}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toEqual([]);
  });
});
