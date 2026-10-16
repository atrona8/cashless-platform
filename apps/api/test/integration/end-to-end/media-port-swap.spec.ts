// Remplaçabilité des ports d'identité (SC-008, FR-034 ; WP20, T082 ; contracts/identity-ports.md).
// Terminal : le faux fournisseur livré par cette mission (en-têtes de test)
// est remplacé, dans le module de test seulement, par une AUTRE implémentation de
// `DeviceIdentityPort` — un jeton d'appareil signé par HMAC, à la manière de ce que branchera la
// mission des terminaux. La lecture `POST /v1/taps` est rejouée sans toucher au contrôleur ni à
// la garde : seul le fournisseur `DEVICE_IDENTITY` change. La garde continue de relire le
// terminal en base (révoqué → refus).
// Festivalier : de même, le fournisseur `CUSTOMER_IDENTITY` (en-têtes de test) est remplacé par un
// jeton de compte signé ; le rattachement `POST /v1/me/media` est rejoué sans toucher au contrôleur
// ni à la garde, qui continue de vérifier le compte en base (`CUSTOMER_DIRECTORY`).
//
// Écritures directes en base : amorçage seulement (jeu d'essai, terminal, lot actif et bracelet
// personnalisé puis activé par les fonctions du schéma), comme les suites de media/.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import { generateClaimCode } from '@cashless/tag-format';
import request from 'supertest';
import {
  CUSTOMER_IDENTITY,
  type CustomerClaims,
  type CustomerIdentityPort,
} from '../../../src/customer-identity/customer-identity.port';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import {
  DEVICE_IDENTITY,
  type DeviceClaims,
  type DeviceIdentityPort,
} from '../../../src/device-identity/device-identity.port';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestCustomer, type TestCustomer } from '../../support/fake-customer';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  goLive,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Autre implémentation du port : `Authorization: Device <terminal>.<prestataire>.<signature>`,
 * la signature étant un HMAC-SHA256 des deux identifiants sous un secret partagé. Réservée à ce
 * test.
 */
class SignedTokenDeviceIdentity implements DeviceIdentityPort {
  calls = 0;

  constructor(private readonly secret: Buffer) {}

  static sign(secret: Buffer, deviceId: string, operatorId: string): string {
    const mac = createHmac('sha256', secret)
      .update(`${deviceId}.${operatorId}`)
      .digest('base64url');
    return `Device ${deviceId}.${operatorId}.${mac}`;
  }

  async identify(req: Request): Promise<DeviceClaims | null> {
    this.calls += 1;
    const header = req.header('authorization') ?? '';
    const match = /^Device ([^.]+)\.([^.]+)\.([A-Za-z0-9_-]+)$/.exec(header);
    if (!match) return null;
    const [, deviceId, operatorId, mac] = match as unknown as [string, string, string, string];
    if (!UUID.test(deviceId) || !UUID.test(operatorId)) return null;
    const expected = createHmac('sha256', this.secret).update(`${deviceId}.${operatorId}`).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return { deviceId: deviceId.toLowerCase(), operatorId: operatorId.toLowerCase() };
  }
}

describe('SC-008 : le port d’identité du terminal se remplace sans toucher aux routes', () => {
  const secret = Buffer.from(randomUUID());
  const identity = new SignedTokenDeviceIdentity(secret);
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice;
  let revoked: TestDevice;
  let media: SeededMedia;
  let counter = 0;
  const next = () => (counter += 1);
  const token = (d: TestDevice) => SignedTokenDeviceIdentity.sign(secret, d.deviceId, d.operatorId);
  const tap = (headers: Record<string, string>, m: SeededMedia = media) =>
    request(app.getHttpServer()).post('/v1/taps').set(headers).send(tapBody(m, next()));

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      device = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      revoked = await createTestDevice(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        status: 'REVOKED',
      });
      const batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      [media] = (await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: 1,
      })) as [SeededMedia];
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId: w.ids.walletA,
        mediaIds: [media.id],
      });
    });
    // Seul changement : le fournisseur du port (contrôleurs, garde, services de
    // l'AppModule).
    app = await createTestApp({
      identity: w.idp,
      overrides: [{ provide: DEVICE_IDENTITY, useValue: identity }],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('l’application porte bien l’autre implémentation', () => {
    expect(app.get(DEVICE_IDENTITY, { strict: false })).toBe(identity);
  });

  it('lecture rejouée avec le jeton signé : même réponse qu’avec le faux d’origine', async () => {
    const before = identity.calls;
    const res = await tap({ Authorization: token(device) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tap_id: expect.any(Number),
      result: 'OK',
      media: { media_id: media.id, status: 'ACTIVE' },
      wallet: { wallet_id: w.ids.walletA },
    });
    expect(identity.calls).toBe(before + 1);
  });

  it('les en-têtes du faux d’origine ne valent plus rien : 401', async () => {
    expect((await tap(device.headers)).status).toBe(401);
  });

  it('jeton falsifié ou signé d’un autre secret : 401', async () => {
    const forged = SignedTokenDeviceIdentity.sign(
      Buffer.from('autre secret'),
      device.deviceId,
      w.ops.a,
    );
    expect((await tap({ Authorization: forged })).status).toBe(401);
    const tampered = token(device).replace(device.deviceId, revoked.deviceId);
    expect((await tap({ Authorization: tampered })).status).toBe(401);
    expect((await tap({})).status).toBe(401);
  });

  it('la garde relit le terminal en base : révoqué, refusé malgré un jeton valide', async () => {
    const res = await tap({ Authorization: token(revoked) });
    expect(res.body.code).toBe('DEVICE_REVOKED');
  });
});

/**
 * Autre implémentation du port du festivalier : `Authorization: Customer
 * <compte>.<prestataire>.<signature>`, HMAC-SHA256 sous un secret partagé. Réservée à ce test.
 */
class SignedTokenCustomerIdentity implements CustomerIdentityPort {
  calls = 0;

  constructor(private readonly secret: Buffer) {}

  static sign(secret: Buffer, customerId: string, operatorId: string): string {
    const mac = createHmac('sha256', secret)
      .update(`${customerId}.${operatorId}`)
      .digest('base64url');
    return `Customer ${customerId}.${operatorId}.${mac}`;
  }

  async identify(req: Request): Promise<CustomerClaims | null> {
    this.calls += 1;
    const header = req.header('authorization') ?? '';
    const match = /^Customer ([^.]+)\.([^.]+)\.([A-Za-z0-9_-]+)$/.exec(header);
    if (!match) return null;
    const [, customerId, operatorId, mac] = match as unknown as [string, string, string, string];
    if (!UUID.test(customerId) || !UUID.test(operatorId)) return null;
    const expected = createHmac('sha256', this.secret)
      .update(`${customerId}.${operatorId}`)
      .digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return {
      customerId: customerId.toLowerCase(),
      operatorId: operatorId.toLowerCase(),
      deviceRef: `jeton-${customerId.slice(0, 8)}`,
    };
  }
}

describe('SC-008 : le port d’identité du festivalier se remplace sans toucher aux routes', () => {
  const secret = Buffer.from(randomUUID());
  const identity = new SignedTokenCustomerIdentity(secret);
  let w: MediaWorld;
  let app: INestApplication;
  let batch: string;
  const token = (c: { customerId: string; operatorId: string }) =>
    SignedTokenCustomerIdentity.sign(secret, c.customerId, c.operatorId);
  const claim = (headers: Record<string, string>, code: string) =>
    request(app.getHttpServer())
      .post('/v1/me/media')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ claim_code: code });
  const customer = () => withOwner((db) => createTestCustomer(db, w.ops.a));

  /** Bracelet actif sur un portefeuille anonyme à solde nul, avec son code imprimé associé. */
  const bracelet = async (hasher: ClaimHasher) =>
    withOwner(async (db) => {
      const [m] = (await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: 1,
      })) as [SeededMedia];
      const code = generateClaimCode(randomBytes);
      const hash = hasher.claimCodeHash(code);
      await db.query(
        `INSERT INTO claim_code (operator_id, batch_id, code_hash, media_id, associated_at)
         VALUES ($1, $2, $3, $4, now())`,
        [w.ops.a, batch, hash, m.id],
      );
      await db.query('UPDATE media SET claim_code_hash = $2 WHERE id = $1', [m.id, hash]);
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      const walletId = (
        await db.query<{ id: string }>('SELECT open_event_wallet($1) AS id', [w.ids.eventA])
      ).rows[0]!.id;
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId,
        mediaIds: [m.id],
      });
      return { media: m, code, walletId };
    });

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
    });
    app = await createTestApp({
      identity: w.idp,
      overrides: [{ provide: CUSTOMER_IDENTITY, useValue: identity }],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('l’application porte bien l’autre implémentation', () => {
    expect(app.get(CUSTOMER_IDENTITY, { strict: false })).toBe(identity);
  });

  it('rattachement rejoué avec le jeton de compte : 201, portefeuille au festivalier', async () => {
    const b = await bracelet(app.get(ClaimHasher, { strict: false }));
    const me: TestCustomer = await customer();
    const before = identity.calls;
    const res = await claim({ Authorization: token(me) }, b.code);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ media_id: b.media.id, wallet_id: b.walletId });
    expect(identity.calls).toBe(before + 1);
    expect(
      await rows('SELECT customer_id FROM wallet WHERE id = $1', [b.walletId]),
    ).toEqual([{ customer_id: me.customerId }]);
  });

  it('les en-têtes du faux d’origine ne valent plus rien : 401', async () => {
    const me = await customer();
    expect((await claim(me.headers, generateClaimCode(randomBytes))).status).toBe(401);
  });

  it('jeton falsifié : 401 ; la garde vérifie le compte en base : compte inconnu refusé malgré un jeton valide', async () => {
    const me = await customer();
    const forged = SignedTokenCustomerIdentity.sign(
      Buffer.from('autre secret'),
      me.customerId,
      w.ops.a,
    );
    expect((await claim({ Authorization: forged }, generateClaimCode(randomBytes))).status).toBe(
      401,
    );
    const ghost = { customerId: randomUUID(), operatorId: w.ops.a };
    expect(
      (await claim({ Authorization: token(ghost) }, generateClaimCode(randomBytes))).status,
    ).toBe(401);
    // Festivalier d'un autre prestataire annoncé sous le prestataire A : inconnu de A.
    const foreign = await withOwner((db) => createTestCustomer(db, w.ops.b));
    expect(
      (
        await claim(
          { Authorization: token({ customerId: foreign.customerId, operatorId: w.ops.a }) },
          generateClaimCode(randomBytes),
        )
      ).status,
    ).toBe(401);
  });
});
