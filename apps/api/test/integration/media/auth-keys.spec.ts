// Intégration : mot de passe d'un bracelet pour un terminal (FR-018, NFR-002, NFR-003, NFR-005 ; contrat
// `getMediaAuthKey`). Le processus des clés de bracelet réel, sous son rôle de base, avec son seul droit sur le service
// de clés : déchiffrer une clé de données.
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { UNKNOWN_MEDIA_DELAY_MS } from '../../../src/media/auth-keys/auth-keys.service';
import { createKeyProcess, createTestApp, type KeyProcessApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import {
  createBatch,
  createMediaWorld,
  expectedPwdPack,
  MEDIA_KEY_INDEX,
  ownerRows as rows,
  seedPersonalizedMedia,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

describe('mot de passe d’un bracelet pour un terminal', () => {
  let w: MediaWorld;
  let keys: KeyProcessApp;
  let device: TestDevice;
  let otherDevice: TestDevice;
  let deviceB: TestDevice;
  let media: SeededMedia[];
  let mediaB: SeededMedia[];
  const ask = (app: KeyProcessApp, who: TestDevice | null, body: object) => {
    let req = request(app.app.getHttpServer()).post('/v1/media/auth-keys');
    if (who) req = req.set(who.headers);
    return req.send(body);
  };
  const body = (m: Pick<SeededMedia, 'uid'>, overrides: object = {}) => ({
    nfc_uid: m.uid,
    key_index: MEDIA_KEY_INDEX,
    ...overrides,
  });

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      device = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      otherDevice = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      deviceB = await createTestDevice(db, { operatorId: w.ops.b });
      const batchA = await createBatch(db, { operatorId: w.ops.a, organizerId: w.ids.organizerA });
      const batchB = await createBatch(db, { operatorId: w.ops.b, organizerId: w.ids.organizerB });
      media = await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batchA,
        kmsKeyRef: w.keyRef.a,
        count: 6,
      });
      mediaB = await seedPersonalizedMedia(db, {
        operatorId: w.ops.b,
        batchId: batchB,
        kmsKeyRef: w.keyRef.b,
        count: 2,
      });
    });
    keys = await createKeyProcess('tag-keys');
  });

  afterAll(async () => {
    await keys.app.close();
  });

  it('le terminal ouvre l’enveloppe et retrouve le mot de passe de la puce ; un autre terminal ne peut pas l’ouvrir', async () => {
    const res = await ask(keys, device, body(media[0]!));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      nfc_uid: media[0]!.uid,
      key_index: MEDIA_KEY_INDEX,
      enc: {
        alg: 'ECDH-ES+HKDF-SHA256+A256GCM',
        epk: expect.any(String),
        nonce: expect.any(String),
        ciphertext: expect.any(String),
        tag: expect.any(String),
      },
      ttl_seconds: 60,
    });
    const uid = Buffer.from(media[0]!.uid, 'hex');
    const opened = device.open(res.body.enc, uid);
    // Clé de test du kit, message SP 800-108 : la valeur que le service de clés donne pour cette puce.
    expect(
      opened.equals(await expectedPwdPack(w.keyRef.a, w.ops.a, MEDIA_KEY_INDEX, media[0]!.uid)),
    ).toBe(true);
    expect(opened.equals(media[0]!.pwdPack)).toBe(true);
    expect(() => otherDevice.open(res.body.enc, uid)).toThrow();
    // L'enveloppe est liée à cette puce : pas rejouable pour une autre.
    expect(() => device.open(res.body.enc, Buffer.from(media[1]!.uid, 'hex'))).toThrow();
    expect(JSON.stringify(res.body)).not.toContain(opened.toString('hex'));
  });

  it('un seul déchiffrement de la clé de données, puis aucun dans la fenêtre du cache ; jamais de calcul de mot de passe', async () => {
    const fresh = await createKeyProcess('tag-keys');
    try {
      expect((await ask(fresh, device, body(media[1]!))).status).toBe(200);
      expect(fresh.kms.calls).toMatchObject({ decrypt: 1, generateMac: 0, generateDataKey: 0 });
      for (const m of [media[1]!, media[2]!, media[3]!])
        expect((await ask(fresh, device, body(m))).status).toBe(200);
      expect(fresh.kms.calls.decrypt).toBe(1);
      // Dix demandes simultanées d'un processus à froid : un seul déchiffrement.
    } finally {
      await fresh.app.close();
    }
    const cold = await createKeyProcess('tag-keys');
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_v, i) => ask(cold, device, body(media[i % 6]!))),
      );
      expect(results.every((res) => res.status === 200)).toBe(true);
      expect(cold.kms.calls.decrypt).toBe(1);
    } finally {
      await cold.app.close();
    }
  });

  it('cache désactivé (TAG_DEK_CACHE_SECONDS=0) : un déchiffrement par demande', async () => {
    process.env.TAG_DEK_CACHE_SECONDS = '0';
    const uncached = await createKeyProcess('tag-keys');
    delete process.env.TAG_DEK_CACHE_SECONDS;
    try {
      for (let i = 0; i < 3; i += 1)
        expect((await ask(uncached, device, body(media[0]!))).status).toBe(200);
      expect(uncached.kms.calls.decrypt).toBe(3);
    } finally {
      await uncached.app.close();
    }
  });

  describe('bracelet inconnu', () => {
    it('inconnu, d’un autre prestataire, autre index, sans mot de passe stocké, clé retirée : le même 404, sans appel au service de clés', async () => {
      const noSecret = randomUUID();
      const retiredIndex = 55;
      let onRetired!: SeededMedia[];
      await withOwner(async (db) => {
        await db.query(
          `INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, key_index, batch_id, status)
           VALUES ($1::uuid, $2, 'NFC_TAG', sha256($1::uuid::text::bytea), '\\x04aabbccddeeff', ${MEDIA_KEY_INDEX}, (SELECT batch_id FROM media WHERE id = $3), 'PERSONALIZED')`,
          [noSecret, w.ops.a, media[0]!.id],
        );
        await db.query(
          `INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ($1, $2, $3)`,
          [w.ops.a, retiredIndex, `fake-kms:hmac:${randomUUID()}`],
        );
        const batch = await createBatch(db, {
          operatorId: w.ops.a,
          organizerId: w.ids.organizerA,
          keyIndex: retiredIndex,
        });
        onRetired = await seedPersonalizedMedia(db, {
          operatorId: w.ops.a,
          batchId: batch,
          kmsKeyRef: w.keyRef.a,
          keyIndex: retiredIndex,
          count: 1,
        });
        await db.query(
          `UPDATE tag_key SET status = 'RETIRED' WHERE operator_id = $1 AND key_index = $2`,
          [w.ops.a, retiredIndex],
        );
      });
      keys.kms.resetCalls();
      const cases = [
        body({ uid: Buffer.concat([Buffer.from([0x04]), randomBytes(6)]).toString('hex') }),
        body(mediaB[0]!),
        body(media[0]!, { key_index: MEDIA_KEY_INDEX + 1 }),
        body({ uid: '04aabbccddeeff' }),
        body(onRetired[0]!, { key_index: retiredIndex }),
      ];
      const bodies = new Set<string>();
      for (const input of cases) {
        const res = await ask(keys, device, input);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('MEDIA_UNKNOWN');
        const {
          instance: _instance,
          request_id: _requestId,
          ...rest
        } = res.body as Record<string, unknown>;
        bodies.add(JSON.stringify(rest));
      }
      expect(bodies.size).toBe(1);
      expect(keys.kms.calls).toMatchObject({ decrypt: 0, generateMac: 0, generateDataKey: 0 });
    });

    it('inconnu et bracelet d’un autre prestataire ne se distinguent pas par le temps (médianes à 20 ms près sur 50 essais)', async () => {
      const unknown: number[] = [];
      const foreign: number[] = [];
      for (let i = 0; i < 50; i += 1) {
        let started = Date.now();
        await ask(
          keys,
          device,
          body({ uid: Buffer.concat([Buffer.from([0x04]), randomBytes(6)]).toString('hex') }),
        );
        unknown.push(Date.now() - started);
        started = Date.now();
        await ask(keys, device, body(mediaB[i % 2]!));
        foreign.push(Date.now() - started);
      }
      expect(Math.abs(median(unknown) - median(foreign))).toBeLessThan(20);
      // Le refus n'est jamais plus rapide que le délai constant.
      expect(Math.min(...unknown, ...foreign)).toBeGreaterThanOrEqual(UNKNOWN_MEDIA_DELAY_MS - 5);
    }, 60_000);
  });

  it('chaque prestataire n’obtient que les mots de passe de ses bracelets', async () => {
    const res = await ask(keys, deviceB, body(mediaB[0]!));
    expect(res.status).toBe(200);
    expect(
      deviceB.open(res.body.enc, Buffer.from(mediaB[0]!.uid, 'hex')).equals(mediaB[0]!.pwdPack),
    ).toBe(true);
    expect((await ask(keys, deviceB, body(media[0]!))).status).toBe(404);
  });

  it('terminal inconnu, suspendu, révoqué ou sans clé d’accord : aucun mot de passe', async () => {
    const special = await withOwner(async (db) => ({
      suspended: await createTestDevice(db, { operatorId: w.ops.a, status: 'SUSPENDED' }),
      revoked: await createTestDevice(db, { operatorId: w.ops.a, status: 'REVOKED' }),
      keyless: await createTestDevice(db, { operatorId: w.ops.a, withAgreementKey: false }),
    }));
    keys.kms.resetCalls();
    expect((await ask(keys, null, body(media[0]!))).status).toBe(401);
    const stranger = {
      ...device,
      headers: { ...device.headers, 'x-test-device-id': randomUUID() },
    } as TestDevice;
    expect((await ask(keys, stranger, body(media[0]!))).status).toBe(401);
    // Terminal de A qui se dit de B : inconnu chez B.
    const crossed = {
      ...device,
      headers: { ...device.headers, 'x-test-operator-id': w.ops.b },
    } as TestDevice;
    expect((await ask(keys, crossed, body(mediaB[0]!))).status).toBe(401);
    expect((await ask(keys, special.suspended, body(media[0]!))).body.code).toBe(
      'DEVICE_SUSPENDED',
    );
    expect((await ask(keys, special.revoked, body(media[0]!))).body.code).toBe('DEVICE_REVOKED');
    expect((await ask(keys, special.keyless, body(media[0]!))).status).toBe(409);
    expect(keys.kms.calls.decrypt).toBe(0);
  });

  it('demande mal formée : 400', async () => {
    for (const input of [
      {},
      { nfc_uid: media[0]!.uid },
      { nfc_uid: media[0]!.uid.toUpperCase(), key_index: 1 },
      { nfc_uid: '04aa', key_index: 1 },
      { nfc_uid: media[0]!.uid, key_index: 70_000 },
    ]) {
      expect((await ask(keys, device, input)).status).toBe(400);
    }
  });

  it('service de clés en panne : 503, puis la demande réussit', async () => {
    const fresh = await createKeyProcess('tag-keys');
    try {
      fresh.kms.failNext('decrypt');
      const down = await ask(fresh, device, body(media[0]!));
      expect(down.status).toBe(503);
      expect(down.body.code).toBe('SERVICE_UNAVAILABLE');
      expect((await ask(fresh, device, body(media[0]!))).status).toBe(200);
    } finally {
      await fresh.app.close();
    }
  });

  it('rien n’est écrit en base par une demande, et le mot de passe n’y est pas en clair', async () => {
    const before = await rows<{ n: number }>(
      'SELECT count(*)::int AS n FROM audit_log WHERE operator_id = $1',
      [w.ops.a],
    );
    await ask(keys, device, body(media[4]!));
    expect(
      await rows<{ n: number }>('SELECT count(*)::int AS n FROM audit_log WHERE operator_id = $1', [
        w.ops.a,
      ]),
    ).toEqual(before);
    expect(await rows('SELECT 1 FROM api_idempotency WHERE operator_id = $1', [w.ops.a])).toEqual(
      [],
    );
    expect(
      await rows(
        `SELECT 1 FROM media WHERE operator_id = $1 AND position($2::bytea in pwd_pack_enc) > 0`,
        [w.ops.a, media[4]!.pwdPack],
      ),
    ).toEqual([]);
  });

  it('l’API publique ne sert pas cette route', async () => {
    const api = await createTestApp({ identity: w.idp });
    try {
      const res = await request(api.getHttpServer())
        .post('/v1/media/auth-keys')
        .set(device.headers)
        .send(body(media[0]!));
      expect(res.status).toBe(404);
    } finally {
      await api.close();
    }
  });
});
