// Liste des modèles de téléphone (mission routes-backoffice 11b, WP09 ; FR-015, FR-016, FR-018 ;
// D9). Table de plateforme : seule la plateforme écrit (fonctions de la base), les autres
// administrateurs lisent. Les lignes de ces tests portent un fabricant propre à la suite : jamais
// de comptage sur toute la table.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { PhoneModelsService } from '../../../src/devices/phone-models/phone-models.service';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { APP_URL, withOwner } from '../../support/db';
import { createTestCustomer } from '../../support/fake-customer';
import { createTestDevice } from '../../support/fake-device';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';

const BRAND = `wp09-${randomUUID().slice(0, 8)}`;
const DAY = '2026-11-20';

describe('modèles de téléphone (WP09, T034, T037)', () => {
  let w: MediaWorld;
  let app: INestApplication;

  const as = (token: string) => ({
    get: (path: string) =>
      request(app.getHttpServer()).get(`/v1${path}`).set('Authorization', `Bearer ${token}`),
    put: (path: string, body: unknown) =>
      request(app.getHttpServer())
        .put(`/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body as object),
    del: (path: string) =>
      request(app.getHttpServer()).delete(`/v1${path}`).set('Authorization', `Bearer ${token}`),
  });
  const platform = () => as(w.platformAdmin.token);
  const mine = async (token: string) => {
    const res = await as(token).get('/phone-models?limit=200');
    return {
      res,
      rows: (res.body.data ?? []).filter((r: { manufacturer: string }) => r.manufacturer === BRAND),
    };
  };
  const audit = (action: string, objectId: string) =>
    ownerRows<{ operator_id: string | null; actor_id: string; before: unknown; after: unknown }>(
      `SELECT operator_id, actor_id, before, after FROM audit_log
        WHERE action = $1 AND object_id = $2 ORDER BY seq`,
      [action, objectId],
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    app = await createTestApp({ identity: w.idp });
  }, 60_000);
  afterAll(async () => {
    await withOwner((db) => db.query('DELETE FROM phone_model WHERE manufacturer = $1', [BRAND]));
    await app.close();
  });

  it('PUT, GET, second PUT, DELETE : chaque changement est journalisé', async () => {
    const put = await platform().put(`/phone-models/${BRAND}/Galaxy%20A15`, {
      nfc_level: 'RECOMMENDED',
      measured_at: DAY,
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      manufacturer: BRAND,
      model: 'galaxy a15',
      nfc_level: 'RECOMMENDED',
      measured_at: DAY,
    });
    expect(contractViolations('PhoneModel', put.body)).toEqual([]);

    const listed = await mine(w.platformAdmin.token);
    expect(listed.res.status).toBe(200);
    expect(contractViolations('PhoneModelPage', listed.res.body)).toEqual([]);
    expect(listed.rows).toHaveLength(1);

    const again = await platform().put(`/phone-models/${BRAND}/Galaxy%20A15`, {
      nfc_level: 'TOLERATED',
      measured_at: '2026-11-21',
    });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ nfc_level: 'TOLERATED', measured_at: '2026-11-21' });
    expect((await mine(w.platformAdmin.token)).rows).toHaveLength(1);

    const del = await platform().del(`/phone-models/${BRAND}/galaxy%20a15`);
    expect(del.status).toBe(204);
    expect((await mine(w.platformAdmin.token)).rows).toHaveLength(0);

    const id = `${BRAND}/galaxy a15`;
    const upserts = await audit('PHONE_MODEL_UPSERTED', id);
    expect(upserts).toHaveLength(2);
    expect(
      upserts.every((a) => a.operator_id === null && a.actor_id === w.platformAdmin.userId),
    ).toBe(true);
    expect(upserts[1]!.after).toMatchObject({ nfc_level: 'TOLERATED' });
    const deleted = await audit('PHONE_MODEL_DELETED', id);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.before).toMatchObject({ nfc_level: 'TOLERATED', measured_at: '2026-11-21' });
  });

  it('normalisation : casse et espaces désignent la même ligne', async () => {
    const a = await platform().put(`/phone-models/${BRAND}/Pixel%20%20%208`, {
      nfc_level: 'RECOMMENDED',
      measured_at: DAY,
    });
    const b = await platform().put(`/phone-models/${BRAND.toUpperCase()}/%20pixel%208%20`, {
      nfc_level: 'TOLERATED',
      measured_at: DAY,
    });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.model).toBe('pixel 8');
    const { rows } = await mine(w.platformAdmin.token);
    expect(rows.filter((r: { model: string }) => r.model === 'pixel 8')).toHaveLength(1);
    expect(rows.find((r: { model: string }) => r.model === 'pixel 8').nfc_level).toBe('TOLERATED');
    expect((await platform().del(`/phone-models/${BRAND}/PIXEL%208`)).status).toBe(204);
  });

  it('écriture par un autre rôle : refusée par l’API, la fonction SQL n’est jamais appelée', async () => {
    const service = app.get(PhoneModelsService, { strict: false });
    const upsert = jest.spyOn(service, 'upsert');
    const remove = jest.spyOn(service, 'remove');
    try {
      for (const who of [w.operatorAdminA, w.organizerAdminA]) {
        const put = await as(who.token).put(`/phone-models/${BRAND}/api`, {
          nfc_level: 'TOLERATED',
          measured_at: DAY,
        });
        expect(put.status).toBe(403);
        expect((await as(who.token).del(`/phone-models/${BRAND}/api`)).status).toBe(403);
      }
      expect(upsert).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    } finally {
      upsert.mockRestore();
      remove.mockRestore();
    }
  });

  it('DELETE d’un modèle absent : 404 ; valeurs invalides : 422', async () => {
    expect((await platform().del(`/phone-models/${BRAND}/inconnu`)).status).toBe(404);
    const bad = [
      { nfc_level: 'UNTESTED', measured_at: DAY },
      { nfc_level: 'RECOMMENDED', measured_at: '2999-01-01' },
      { nfc_level: 'RECOMMENDED', measured_at: '2026-02-30' },
      { nfc_level: 'RECOMMENDED' },
      { nfc_level: 'RECOMMENDED', measured_at: DAY, extra: 1 },
    ];
    for (const body of bad) {
      const res = await platform().put(`/phone-models/${BRAND}/m`, body);
      expect([res.status, res.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    }
    const long = 'x'.repeat(101);
    const res = await platform().put(`/phone-models/${BRAND}/${long}`, {
      nfc_level: 'TOLERATED',
      measured_at: DAY,
    });
    expect(res.status).toBe(422);
    expect((await platform().get('/phone-models?limit=0')).status).toBe(422);
    expect((await platform().get('/phone-models?cursor=%25%25')).status).toBe(422);
    expect((await mine(w.platformAdmin.token)).rows).toHaveLength(0);
  });

  it('écriture : tout rôle autre que PLATFORM_ADMIN refusé (403), rien d’écrit', async () => {
    const body = { nfc_level: 'RECOMMENDED', measured_at: DAY };
    const path = `/phone-models/${BRAND}/refuse`;
    for (const who of [w.operatorAdminA, w.organizerAdminA, w.supervisorA, w.cashierA]) {
      expect((await as(who.token).put(path, body)).status).toBe(403);
      expect((await as(who.token).del(path)).status).toBe(403);
    }
    expect(await audit('PHONE_MODEL_UPSERTED', `${BRAND}/refuse`)).toHaveLength(0);
    expect((await mine(w.platformAdmin.token)).rows).toHaveLength(0);
  });

  it('lecture : administrateurs seuls ; autres rôles, festivalier, terminal refusés', async () => {
    await platform().put(`/phone-models/${BRAND}/lisible`, {
      nfc_level: 'TOLERATED',
      measured_at: DAY,
    });
    for (const who of [w.platformAdmin, w.operatorAdminA, w.organizerAdminA]) {
      const { res, rows } = await mine(who.token);
      expect(res.status).toBe(200);
      expect(rows).toHaveLength(1);
    }
    for (const who of [w.supervisorA, w.cashierA]) {
      expect((await as(who.token).get('/phone-models')).status).toBe(403);
    }
    const { customer, device } = await withOwner(async (db) => ({
      customer: await createTestCustomer(db, w.ops.a),
      device: await createTestDevice(db, { operatorId: w.ops.a }),
    }));
    for (const headers of [customer.headers, device.headers])
      expect((await request(app.getHttpServer()).get('/v1/phone-models').set(headers)).status).toBe(
        401,
      );
    expect((await request(app.getHttpServer()).get('/v1/phone-models')).status).toBe(401);
    await platform().del(`/phone-models/${BRAND}/lisible`);
  });

  it('pagination par curseur opaque, tri fabricant puis modèle', async () => {
    for (const m of ['p1', 'p2', 'p3'])
      await platform().put(`/phone-models/${BRAND}/${m}`, {
        nfc_level: 'TOLERATED',
        measured_at: DAY,
      });
    // Le curseur d'un décalage : parcourt la table par pages de 2 jusqu'à retrouver nos trois
    // lignes dans l'ordre.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 100; i += 1) {
      const res = await platform().get(`/phone-models?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      for (const r of res.body.data) if (r.manufacturer === BRAND) seen.push(r.model);
      cursor = res.body.next_cursor;
      expect(res.body.has_more).toBe(cursor !== null);
      if (!cursor) break;
    }
    expect(seen).toEqual(['p1', 'p2', 'p3']);
    for (const m of ['p1', 'p2', 'p3']) await platform().del(`/phone-models/${BRAND}/${m}`);
  });

  it('cashless_app : ni INSERT, ni UPDATE, ni DELETE sur phone_model', async () => {
    await platform().put(`/phone-models/${BRAND}/droits`, {
      nfc_level: 'TOLERATED',
      measured_at: DAY,
    });
    const db = new Client({ connectionString: APP_URL });
    await db.connect();
    try {
      await expect(
        db.query(
          `INSERT INTO phone_model (manufacturer, model, nfc_level, measured_at, updated_by)
           VALUES ('x', 'y', 'TOLERATED', now(), $1)`,
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        db.query("UPDATE phone_model SET nfc_level = 'RECOMMENDED' WHERE manufacturer = $1", [
          BRAND,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        db.query('DELETE FROM phone_model WHERE manufacturer = $1', [BRAND]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        db.query("SELECT upsert_phone_model('x','y','TOLERATED', now()::date, $1)", [randomUUID()]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        db.query("SELECT delete_phone_model('x','y', $1)", [randomUUID()]),
      ).rejects.toMatchObject({ code: '42501' });
      const read = await db.query(
        'SELECT count(*)::int AS n FROM phone_model WHERE manufacturer = $1',
        [BRAND],
      );
      expect(read.rows[0].n).toBe(1);
    } finally {
      await db.end();
    }
    await platform().del(`/phone-models/${BRAND}/droits`);
  });
});
