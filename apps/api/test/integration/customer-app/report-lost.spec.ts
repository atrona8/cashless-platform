// Intégration : `reportMyMediaLost` (`POST /me/media/{media_id}/report-lost`), derrière le jeton d'accès du festivalier.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import {
  createCustomerWallet,
  createTestCustomer,
  type TestCustomer,
} from '../../support/fake-customer';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  goLive,
  ownerRows as rows,
  seedPersonalizedMedia,
  type MediaWorld,
} from '../../support/media-fixtures';

describe('déclarer un bracelet perdu (/me/media/{media_id}/report-lost)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let awa: TestCustomer;
  let moussa: TestCustomer;
  let awaMedia: string[];
  let moussaMedia: string;
  let blacklisted: string;

  const report = (who: TestCustomer | null, mediaId: string, key: string = randomUUID()) => {
    const r = request(app.getHttpServer())
      .post(`/v1/me/media/${mediaId}/report-lost`)
      .set('Idempotency-Key', key);
    return who ? r.set(who.headers) : r;
  };
  const status = async (id: string) =>
    (await rows<{ status: string }>('SELECT status FROM media WHERE id = $1', [id]))[0]!.status;

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      awa = await createTestCustomer(db, w.ops.a);
      moussa = await createTestCustomer(db, w.ops.a);
      const batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      const media = await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: 5,
      });
      const walletOf = async (customer: TestCustomer) =>
        (
          await createCustomerWallet(db, {
            operatorId: w.ops.a,
            ledgerId: w.ids.ledgerA,
            customerId: customer.customerId,
          })
        ).walletId;
      const awaWallet = await walletOf(awa);
      const moussaWallet = await walletOf(moussa);
      awaMedia = [media[0]!.id, media[1]!.id, media[2]!.id];
      moussaMedia = media[3]!.id;
      blacklisted = media[4]!.id;
      for (const [wallet, ids] of [
        [awaWallet, [...awaMedia, blacklisted]],
        [moussaWallet, [moussaMedia]],
      ] as const)
        await activateMedia(db, {
          operatorId: w.ops.a,
          eventId: w.ids.eventA,
          walletId: wallet,
          mediaIds: [...ids],
        });
      await db.query('SELECT blacklist_media($1, $2, $3)', [
        blacklisted,
        'test',
        w.operatorAdminA.userId,
      ]);
    });
    app = await createTestApp({ identity: w.idp });
  });
  afterAll(async () => {
    await app.close();
  });

  it('sans identité de festivalier : 401, rien n’est suspendu', async () => {
    const res = await report(null, awaMedia[0]!);
    expect(res.status).toBe(401);
    expect(await status(awaMedia[0]!)).toBe('ACTIVE');
  });

  it('son propre bracelet : SUSPENDED, réponse conforme, journal des statuts et audit CUSTOMER', async () => {
    const res = await report(awa, awaMedia[0]!);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ media_id: awaMedia[0], status: 'SUSPENDED' });
    expect(contractViolations('CustomerMedia', res.body)).toEqual([]);
    expect(await status(awaMedia[0]!)).toBe('SUSPENDED');
    const [history] = await rows<{ to_status: string; actor_id: string; reason: string }>(
      `SELECT to_status, actor_id, reason FROM media_status_history
        WHERE media_id = $1 ORDER BY id DESC LIMIT 1`,
      [awaMedia[0]],
    );
    expect(history).toMatchObject({ to_status: 'SUSPENDED', actor_id: awa.customerId });
    const audit = await rows<{ actor_role: string; actor_id: string; after: { status: string } }>(
      `SELECT actor_role, actor_id, after FROM audit_log
        WHERE action = 'MEDIA_REPORTED_LOST' AND object_id = $1`,
      [awaMedia[0]],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_role: 'CUSTOMER', actor_id: awa.customerId });
    // Le bracelet suspendu apparaît suspendu dans la liste du compte.
    const list = await request(app.getHttpServer()).get('/v1/me/media').set(awa.headers);
    expect(
      list.body.data.find((m: { media_id: string }) => m.media_id === awaMedia[0]),
    ).toMatchObject({ status: 'SUSPENDED' });
  });

  it('rejeu de la même clé : même réponse, Idempotency-Replayed, un seul audit', async () => {
    const key = randomUUID();
    const first = await report(awa, awaMedia[1]!, key);
    const replay = await report(awa, awaMedia[1]!, key);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    const [n] = await rows<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_log WHERE action = 'MEDIA_REPORTED_LOST' AND object_id = $1",
      [awaMedia[1]],
    );
    expect(n!.n).toBe(1);
  });

  it('déjà suspendu (autre clé) : l’état courant, sans nouvel audit', async () => {
    const res = await report(awa, awaMedia[0]!);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUSPENDED');
    const [n] = await rows<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_log WHERE action = 'MEDIA_REPORTED_LOST' AND object_id = $1",
      [awaMedia[0]],
    );
    expect(n!.n).toBe(1);
  });

  it('bracelet d’un autre compte, inconnu ou mal formé : même 404, rien n’est suspendu', async () => {
    const bodies = [];
    for (const id of [moussaMedia, randomUUID(), 'pas-un-uuid']) {
      const res = await report(awa, id);
      expect(res.status).toBe(404);
      const { instance: _i, request_id: _r, ...body } = res.body;
      bodies.push(JSON.stringify(body));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(await status(moussaMedia)).toBe('ACTIVE');
  });

  it('bracelet ni actif ni suspendu (liste noire) : 409 CONFLICT_STATE, inchangé', async () => {
    const res = await report(awa, blacklisted);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT_STATE');
    expect(await status(blacklisted)).toBe('BLACKLISTED');
  });

  it('Idempotency-Key absente : refusée', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/me/media/${awaMedia[2]}/report-lost`)
      .set(awa.headers);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await status(awaMedia[2]!)).toBe('ACTIVE');
  });

  it('bracelet libéré du portefeuille (rattachement levé) : 404', async () => {
    await withOwner(async (db) => {
      await db.query(
        'UPDATE media_assignment SET released_at = now() WHERE media_id = $1 AND released_at IS NULL',
        [awaMedia[2]],
      );
    });
    expect((await report(awa, awaMedia[2]!)).status).toBe(404);
    expect(await status(awaMedia[2]!)).toBe('ACTIVE');
  });
});
