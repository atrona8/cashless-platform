// Intégration : lecture d'un bracelet (FR-019, FR-020, SC-003 ; SPECIFICATION §7.6 ; contrat `createTap`). Le résultat
// de `register_tap` est rendu tel quel ; les effets de sécurité d'une lecture suspecte (liste noire, anomalie) restent
// même quand l'opération qui portait la lecture échoue.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DeviceContext } from '../../../src/device-identity/device-identity.port';
import { ProblemException } from '../../../src/errors/problem';
import { TapService } from '../../../src/media/taps/tap.service';
import { parseTap } from '../../../src/media/taps/taps.dto';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import { activateMedia, createBatch, createMediaWorld, ownerRows as rows, seedPersonalizedMedia, tapBody, type MediaWorld, type SeededMedia } from '../../support/media-fixtures';

describe('lecture d’un bracelet', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let taps: TapService;
  let device: TestDevice;
  let otherDevice: TestDevice;
  let otherEventDevice: TestDevice;
  let deviceB: TestDevice;
  let batch: string;
  let counter = 100;
  const next = () => (counter += 1);
  const tap = (who: TestDevice | null, body: object) => {
    let req = request(app.getHttpServer()).post('/v1/taps');
    if (who) req = req.set(who.headers);
    return req.send(body);
  };
  const context = (d: TestDevice, eventId: string | null = w.ids.eventA): DeviceContext => ({ deviceId: d.deviceId, operatorId: d.operatorId, eventId, posId: null, agreementPublicKey: null });
  const statusOf = (m: SeededMedia) => rows<{ status: string }>('SELECT status FROM media WHERE id = $1', [m.id]).then((r) => r[0]!.status);
  const anomalies = (m: SeededMedia) => rows<{ kind: string }>('SELECT kind FROM anomaly WHERE media_id = $1 ORDER BY kind', [m.id]).then((r) => r.map((a) => a.kind));
  const tapsOf = (m: SeededMedia) => rows<{ n: number }>('SELECT count(*)::int AS n FROM media_tap WHERE media_id = $1', [m.id]).then((r) => r[0]!.n);
  /** Bracelets neufs dans le lot actif ; activés sauf demande contraire. */
  const fresh = async (count: number, active = true): Promise<SeededMedia[]> =>
    withOwner(async (db) => {
      const media = await seedPersonalizedMedia(db, { operatorId: w.ops.a, batchId: batch, kmsKeyRef: w.keyRef.a, count });
      if (active) await activateMedia(db, { operatorId: w.ops.a, eventId: w.ids.eventA, walletId: w.ids.walletA, mediaIds: media.map((m) => m.id) });
      return media;
    });

  beforeAll(async () => {
    w = await createMediaWorld();
    const otherEvent = randomUUID();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
         SELECT $1, operator_id, organizer_id, 'Autre événement', currency, timezone, jurisdiction_id, funds_holder FROM event WHERE id = $2`,
        [otherEvent, w.ids.eventA],
      );
      device = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      otherDevice = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      otherEventDevice = await createTestDevice(db, { operatorId: w.ops.a, eventId: otherEvent });
      deviceB = await createTestDevice(db, { operatorId: w.ops.b });
      batch = await createBatch(db, { operatorId: w.ops.a, organizerId: w.ids.organizerA, eventId: w.ids.eventA, status: 'ACTIVE', quantity: 1000 });
    });
    app = await createTestApp({ identity: w.idp });
    taps = app.get(TapService, { strict: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /taps', () => {
    it('bracelet valide : OK, identifiant de la lecture, bracelet et solde disponible', async () => {
      const [m] = await fresh(1);
      const res = await tap(device, tapBody(m!, next()));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        tap_id: expect.any(Number),
        result: 'OK',
        tap_expires_at: expect.any(String),
        media: { media_id: m!.id, status: 'ACTIVE', batch_kind: 'PUBLIC', deposit_status: 'NONE', deposit_held: 0 },
        wallet: { wallet_id: w.ids.walletA, status: 'ACTIVE', currency: 'XOF', spendable: 0, paid: 0, promo: 0 },
      });
      expect(new Date(res.body.tap_expires_at).getTime()).toBeGreaterThan(Date.now());
      expect(await rows('SELECT counter::int AS counter, mode, device_id, transaction_id FROM media_tap WHERE id = $1', [res.body.tap_id])).toEqual([
        { counter, mode: 'ONLINE', device_id: device.deviceId, transaction_id: null },
      ]);
      expect(await rows('SELECT last_counter::int AS last FROM media WHERE id = $1', [m!.id])).toEqual([{ last: counter }]);
      // Ni l'identité ni son empreinte ne reviennent dans la réponse.
      expect(JSON.stringify(res.body)).not.toContain(m!.tokenHash.toString('hex'));
    });

    it('la même lecture renvoyée par le même terminal : même identifiant, sans anomalie', async () => {
      const [m] = await fresh(1);
      const body = tapBody(m!, next());
      const first = await tap(device, body);
      const second = await tap(device, body);
      expect(second.body).toMatchObject({ result: 'OK', tap_id: first.body.tap_id });
      expect(await tapsOf(m!)).toBe(1);
      expect(await anomalies(m!)).toEqual([]);
      expect(await statusOf(m!)).toBe('ACTIVE');
    });

    it('le même compteur lu par un autre terminal : copie suspectée, liste noire, anomalie', async () => {
      const [m] = await fresh(1);
      const body = tapBody(m!, next());
      expect((await tap(device, body)).body.result).toBe('OK');
      const copy = await tap(otherDevice, body);
      expect(copy.status).toBe(200);
      expect(copy.body).toEqual({ tap_id: null, result: 'CLONE_SUSPECTED', tap_expires_at: null, media: null, wallet: null });
      expect(await statusOf(m!)).toBe('BLACKLISTED');
      expect(await anomalies(m!)).toEqual(['COUNTER_DUPLICATE']);
      // Le bracelet est bloqué pour tout le monde, y compris le premier terminal.
      const after = await tap(device, tapBody(m!, next()));
      expect(after.body).toMatchObject({ result: 'BLOCKED', media: null, wallet: null });
    });

    it('UID différent : liste noire et anomalie', async () => {
      const [m] = await fresh(1);
      const res = await tap(device, tapBody(m!, next(), { nfc_uid: Buffer.concat([Buffer.from([0x04]), randomBytes(6)]).toString('hex') }));
      expect(res.body).toMatchObject({ result: 'UID_MISMATCH', tap_id: null });
      expect(await statusOf(m!)).toBe('BLACKLISTED');
      expect(await anomalies(m!)).toEqual(['UID_MISMATCH']);
    });

    it('signature d’originalité différente : liste noire et anomalie', async () => {
      const [m] = await fresh(1);
      const res = await tap(device, tapBody(m!, next(), { originality_signature: randomBytes(32).toString('hex') }));
      expect(res.body).toMatchObject({ result: 'SIGNATURE_MISMATCH', tap_id: null });
      expect(await statusOf(m!)).toBe('BLACKLISTED');
      expect(await anomalies(m!)).toEqual(['SIGNATURE_MISMATCH']);
    });

    it('signature absente : le terminal doit relire ; ni liste noire, ni anomalie, ni lecture enregistrée', async () => {
      const [m] = await fresh(1);
      const res = await tap(device, tapBody(m!, next(), { originality_signature: undefined }));
      expect(res.body).toEqual({ tap_id: null, result: 'SIGNATURE_MISSING', tap_expires_at: null, media: null, wallet: null });
      expect(await statusOf(m!)).toBe('ACTIVE');
      expect(await anomalies(m!)).toEqual([]);
      expect(await tapsOf(m!)).toBe(0);
      expect((await tap(device, tapBody(m!, counter))).body.result).toBe('OK');
    });

    it.each([
      ['en stock (jamais activé)', null, 'NOT_ACTIVATED'],
      ['retiré', 'RETIRED', 'RETIRED'],
      ['remplacé', 'REPLACED', 'REPLACED'],
      ['rendu', 'RELEASED', 'RELEASED'],
      ['suspendu', 'SUSPENDED', 'BLOCKED'],
    ])('bracelet %s : résultat rendu tel quel, en 200', async (_name, status, result) => {
      const [m] = await fresh(1, status !== null);
      if (status) await rows('UPDATE media SET status = $2 WHERE id = $1', [m!.id, status]);
      const res = await tap(device, tapBody(m!, next()));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ result, media: null, wallet: null });
      expect(await anomalies(m!)).toEqual([]);
    });

    it('identité inconnue, ou bracelet d’un autre prestataire : UNKNOWN', async () => {
      const [m] = await fresh(1);
      const unknown = await tap(device, tapBody({ ...m!, tokenHash: randomBytes(32) }, next()));
      expect(unknown.body).toEqual({ tap_id: null, result: 'UNKNOWN', tap_expires_at: null, media: null, wallet: null });
      const foreign = await tap(deviceB, tapBody(m!, next()));
      expect(foreign.body.result).toBe('UNKNOWN');
      expect(await tapsOf(m!)).toBe(0);
      expect(await statusOf(m!)).toBe('ACTIVE');
    });

    it('lot suspendu : BATCH_INACTIVE ; terminal d’un autre événement : WRONG_EVENT', async () => {
      const [m] = await fresh(1);
      expect((await tap(otherEventDevice, tapBody(m!, next()))).body.result).toBe('WRONG_EVENT');
      await withOwner(async (db) => {
        const suspended = await createBatch(db, { operatorId: w.ops.a, organizerId: w.ids.organizerA, eventId: w.ids.eventA, status: 'ACTIVE' });
        const [s] = await seedPersonalizedMedia(db, { operatorId: w.ops.a, batchId: suspended, kmsKeyRef: w.keyRef.a, count: 1 });
        await activateMedia(db, { operatorId: w.ops.a, eventId: w.ids.eventA, walletId: w.ids.walletA, mediaIds: [s!.id] });
        await db.query(`UPDATE media_batch SET status = 'SUSPENDED' WHERE id = $1`, [suspended]);
        m!.id = s!.id;
        Object.assign(m!, s);
      });
      const res = await tap(device, tapBody(m!, next()));
      expect(res.body).toMatchObject({ result: 'BATCH_INACTIVE', tap_id: null });
      expect(await tapsOf(m!)).toBe(0);
    });

    it('puce non authentifiée ou format inconnu : 422, lecture non enregistrée ; corps mal formé : 400', async () => {
      const [m] = await fresh(1);
      expect((await tap(device, tapBody(m!, next(), { pack_verified: false }))).status).toBe(422);
      expect((await tap(device, tapBody(m!, next(), { format_major: 2 }))).status).toBe(422);
      for (const overrides of [{ nfc_uid: 'zz' }, { token_hash: 'abc' }, { counter: -1 }, { counter: 16_777_216 }, { pack_verified: 'oui' }, { originality_signature: 'abcd' }, { occurred_at: 'hier' }, { key_index: undefined }]) {
        expect((await tap(device, tapBody(m!, next(), overrides))).status).toBe(400);
      }
      expect(await tapsOf(m!)).toBe(0);
    });

    it('sans identité de terminal : 401 ; terminal révoqué : refus', async () => {
      const [m] = await fresh(1);
      expect((await tap(null, tapBody(m!, next()))).status).toBe(401);
      const revoked = await withOwner((db) => createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA, status: 'REVOKED' }));
      expect((await tap(revoked, tapBody(m!, next()))).body.code).toBe('DEVICE_REVOKED');
      expect(await tapsOf(m!)).toBe(0);
    });
  });

  describe('lecture embarquée dans une opération', () => {
    const input = (m: SeededMedia, value: number, overrides: Record<string, unknown> = {}) => parseTap(tapBody(m, value, overrides));
    const code = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof ProblemException ? error.code : error));

    it('lecture valide puis opération réussie : tout est validé ensemble', async () => {
      const [m] = await fresh(1);
      const result = await taps.withEmbeddedTap(context(device), input(m!, next()), async (_client, registered) => registered);
      expect(result).toMatchObject({ result: 'OK', mediaId: m!.id, tapId: expect.any(String) });
      expect(await tapsOf(m!)).toBe(1);
    });

    it('l’opération échoue après une lecture valide : tout est annulé, la même lecture reste utilisable', async () => {
      const [m] = await fresh(1);
      const value = next();
      await expect(
        taps.withEmbeddedTap(context(device), input(m!, value), async () => {
          throw new ProblemException('INSUFFICIENT_FUNDS');
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
      expect(await tapsOf(m!)).toBe(0);
      expect(await statusOf(m!)).toBe('ACTIVE');
      expect((await tap(device, tapBody(m!, value))).body.result).toBe('OK');
    });

    it.each([
      ['UID différent', { nfc_uid: '04ffffffffffff' }, 'MEDIA_UID_MISMATCH', 'UID_MISMATCH'],
      ['signature différente', { originality_signature: 'ab'.repeat(32) }, 'MEDIA_SIGNATURE_MISMATCH', 'SIGNATURE_MISMATCH'],
    ])('lecture suspecte (%s) : l’opération est refusée, la liste noire et l’anomalie sont persistées, une seule fois', async (_name, overrides, problem, anomaly) => {
      const [m] = await fresh(1);
      const fn = jest.fn(async () => 'jamais');
      expect(await code(taps.withEmbeddedTap(context(device), input(m!, next(), overrides), fn))).toBe(problem);
      expect(fn).not.toHaveBeenCalled();
      expect(await statusOf(m!)).toBe('BLACKLISTED');
      expect(await anomalies(m!)).toEqual([anomaly]);
    });

    it('compteur déjà lu par un autre terminal, dans une opération : copie suspectée, liste noire persistée', async () => {
      const [m] = await fresh(1);
      const value = next();
      expect((await tap(device, tapBody(m!, value))).body.result).toBe('OK');
      expect(await code(taps.withEmbeddedTap(context(otherDevice), input(m!, value), async () => 'jamais'))).toBe('MEDIA_CLONE_SUSPECTED');
      expect(await statusOf(m!)).toBe('BLACKLISTED');
      expect(await anomalies(m!)).toEqual(['COUNTER_DUPLICATE']);
    });

    it.each([
      ['inconnu', null, 'MEDIA_UNKNOWN'],
      ['en stock', 'PERSONALIZED', 'MEDIA_NOT_ACTIVATED'],
      ['suspendu', 'SUSPENDED', 'MEDIA_BLOCKED'],
      ['remplacé', 'REPLACED', 'MEDIA_REPLACED'],
      ['rendu', 'RELEASED', 'MEDIA_RELEASED'],
      ['retiré', 'RETIRED', 'MEDIA_RETIRED'],
    ])('bracelet %s : l’opération reçoit l’erreur correspondante, sans effet durable', async (_name, status, problem) => {
      const [m] = await fresh(1, status !== 'PERSONALIZED');
      if (status && status !== 'PERSONALIZED') await rows('UPDATE media SET status = $2 WHERE id = $1', [m!.id, status]);
      const target = status === null ? { ...m!, tokenHash: randomBytes(32) } : m!;
      expect(await code(taps.withEmbeddedTap(context(device), input(target, next()), async () => 'jamais'))).toBe(problem);
      expect(await anomalies(m!)).toEqual([]);
      expect(await tapsOf(m!)).toBe(0);
    });

    it('signature absente, lot inactif ou autre événement : erreurs dédiées', async () => {
      const [m] = await fresh(1);
      expect(await code(taps.withEmbeddedTap(context(device), input(m!, next(), { originality_signature: undefined }), async () => 'jamais'))).toBe('MEDIA_SIGNATURE_MISSING');
      expect(await code(taps.withEmbeddedTap(context(otherEventDevice), input(m!, next()), async () => 'jamais'))).toBe('MEDIA_WRONG_EVENT');
      expect(await statusOf(m!)).toBe('ACTIVE');
    });

    it('l’activation admet un bracelet en stock : l’opération reçoit le bracelet désigné', async () => {
      const [m] = await fresh(1, false);
      const registered = await taps.withEmbeddedTap(context(device), input(m!, next()), async (_client, r) => r, ['OK', 'NOT_ACTIVATED']);
      expect(registered).toEqual({ result: 'NOT_ACTIVATED', tapId: null, mediaId: m!.id });
    });
  });
});
