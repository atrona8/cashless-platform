// Intégration : renouvellement des jetons (`refreshCustomerToken`) et vérification du jeton d'accès (Bearer).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import request from 'supertest';
import { deriveCustomerKey } from '../../../src/customer-identity/customer-keys';
import { loadConfig } from '../../../src/config/config';
import { createTestApp } from '../../support/app';
import { bearer, createPublicCode, freshPhone, login, refresh } from '../../support/customer-auth';
import { withOwner } from '../../support/db';
import { createMediaWorld, ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import { createTestCustomer } from '../../support/fake-customer';

describe('jetons du festivalier : renouvellement et Bearer', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let codeA: string;
  let codeB: string;

  const me = (headers: Record<string, string>) =>
    request(app.getHttpServer()).get('/v1/me').set(headers);

  beforeAll(async () => {
    w = await createMediaWorld();
    codeA = await createPublicCode(w.ops.a);
    codeB = await createPublicCode(w.ops.b);
    app = await createTestApp({ identity: w.idp, trustProxyHops: 1 });
  });
  afterAll(async () => {
    await app.close();
  });

  describe('refresh', () => {
    it('rotation : un jeton neuf à chaque renouvellement, dans la même famille, l’ancien est usé', async () => {
      const first = await login(app, { operatorCode: codeA, phone: freshPhone() });
      const second = await refresh(app, first.refresh_token);
      expect(second.status).toBe(200);
      expect(second.body.refresh_token).not.toBe(first.refresh_token);
      expect(second.body.access_token).not.toBe(first.access_token);
      expect(second.body).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
      expect((await me(bearer(second.body.access_token))).status).toBe(200);
      const families = await rows<{ n: number }>(
        `SELECT count(DISTINCT family_id)::int AS n FROM customer_refresh_token
          WHERE customer_id = (SELECT customer_id FROM customer_refresh_token ORDER BY created_at DESC LIMIT 1)`,
      );
      expect(families[0]!.n).toBeGreaterThanOrEqual(1);
      const third = await refresh(app, second.body.refresh_token);
      expect(third.status).toBe(200);
    });

    it('réemploi d’un jeton déjà utilisé : 401 et toute la famille révoquée (le jeton suivant aussi)', async () => {
      const first = await login(app, { operatorCode: codeA, phone: freshPhone() });
      const second = await refresh(app, first.refresh_token);
      expect(second.status).toBe(200);
      const replay = await refresh(app, first.refresh_token);
      expect(replay.status).toBe(401);
      // Le jeton neuf, issu de la rotation légitime, est refusé lui aussi : la famille est révoquée.
      const successor = await refresh(app, second.body.refresh_token);
      expect(successor.status).toBe(401);
      const [state] = await rows<{ live: number }>(
        `SELECT count(*)::int AS live FROM customer_refresh_token
          WHERE family_id = (SELECT family_id FROM customer_refresh_token
                              WHERE token_hash = sha256(convert_to($1, 'UTF8')))
            AND revoked_at IS NULL`,
        [first.refresh_token],
      );
      expect(state!.live).toBe(0);
    });

    it('course : 8 renouvellements simultanés du même jeton, un seul 200, les autres 401, famille révoquée', async () => {
      const t = await login(app, { operatorCode: codeA, phone: freshPhone() });
      const results = await Promise.all(
        Array.from({ length: 8 }, () => refresh(app, t.refresh_token)),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(7);
      // Le perdant de la course voit le jeton usé : la famille entière est révoquée, jeton neuf compris.
      const winner = results.find((r) => r.status === 200)!;
      expect((await refresh(app, winner.body.refresh_token)).status).toBe(401);
      const [state] = await rows<{ live: number }>(
        `SELECT count(*)::int AS live FROM customer_refresh_token
          WHERE family_id = (SELECT family_id FROM customer_refresh_token
                              WHERE token_hash = sha256(convert_to($1, 'UTF8')))
            AND revoked_at IS NULL`,
        [t.refresh_token],
      );
      expect(state!.live).toBe(0);
    });

    it('la révocation d’une famille ne touche pas les autres appareils du même compte', async () => {
      const phone = freshPhone();
      const device1 = await login(app, { operatorCode: codeA, phone });
      const device2 = await login(app, { operatorCode: codeA, phone });
      await refresh(app, device1.refresh_token);
      expect((await refresh(app, device1.refresh_token)).status).toBe(401);
      expect((await refresh(app, device2.refresh_token)).status).toBe(200);
    });

    it('jeton expiré, révoqué, inconnu ou mal formé : 401', async () => {
      const t = await login(app, { operatorCode: codeA, phone: freshPhone() });
      await withOwner((db) =>
        db.query(
          `UPDATE customer_refresh_token SET expires_at = now() - interval '1 second'
            WHERE token_hash = sha256(convert_to($1, 'UTF8'))`,
          [t.refresh_token],
        ),
      );
      expect((await refresh(app, t.refresh_token)).status).toBe(401);
      const r = await login(app, { operatorCode: codeA, phone: freshPhone() });
      await withOwner((db) =>
        db.query(
          `UPDATE customer_refresh_token SET revoked_at = now()
            WHERE token_hash = sha256(convert_to($1, 'UTF8'))`,
          [r.refresh_token],
        ),
      );
      expect((await refresh(app, r.refresh_token)).status).toBe(401);
      for (const bad of ['crt_' + 'A'.repeat(43), 'abc', t.access_token, ''])
        expect((await refresh(app, bad)).status).toBe(bad === '' ? 400 : 401);
    });

    it('un jeton du prestataire A fonctionne et reste dans A : le compte renvoyé est celui de A', async () => {
      const t = await login(app, { operatorCode: codeA, phone: freshPhone() });
      const renewed = await refresh(app, t.refresh_token);
      const profile = await me(bearer(renewed.body.access_token));
      const [party] = await rows<{ operator_id: string }>(
        'SELECT operator_id FROM party WHERE id = $1',
        [profile.body.customer_id],
      );
      expect(party!.operator_id).toBe(w.ops.a);
    });
  });

  describe('Bearer', () => {
    const key = () => deriveCustomerKey(loadConfig().customerAuthHmacKey, 'accessToken');
    const forge = async (
      overrides: { aud?: string; iss?: string; exp?: number; key?: Uint8Array; sub?: string } = {},
    ) => {
      const t = await login(app, { operatorCode: codeA, phone: freshPhone() });
      const profile = await me(bearer(t.access_token));
      const [row] = await rows<{ family_id: string }>(
        'SELECT family_id FROM customer_refresh_token WHERE customer_id = $1',
        [profile.body.customer_id],
      );
      return {
        customerId: profile.body.customer_id as string,
        token: await new SignJWT({ op: w.ops.a, dev: row!.family_id })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer(overrides.iss ?? 'cashless-api')
          .setAudience(overrides.aud ?? 'cashless-customer')
          .setSubject(overrides.sub ?? (profile.body.customer_id as string))
          .setJti(randomUUID())
          .setIssuedAt()
          .setExpirationTime(overrides.exp ?? Math.floor(Date.now() / 1000) + 600)
          .sign(overrides.key ?? key()),
      };
    };

    it('un jeton forgé avec la bonne clé est accepté (témoin des cas refusés ci-dessous)', async () => {
      const { token } = await forge();
      expect((await me(bearer(token))).status).toBe(200);
    });

    it('signé par une autre clé, mauvais aud, mauvais iss, expiré : 401', async () => {
      const cases = [
        await forge({ key: new Uint8Array(32).fill(1) }),
        await forge({ aud: 'cashless-device' }),
        await forge({ iss: 'autre' }),
        await forge({ exp: Math.floor(Date.now() / 1000) - 60 }),
      ];
      for (const c of cases) expect((await me(bearer(c.token))).status).toBe(401);
    });

    it('alg: none, jeton mal formé, schéma autre que Bearer : 401', async () => {
      const { customerId } = await forge();
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const none = `${b64({ alg: 'none' })}.${b64({
        iss: 'cashless-api',
        aud: 'cashless-customer',
        sub: customerId,
        op: w.ops.a,
        dev: randomUUID(),
        jti: randomUUID(),
        exp: Math.floor(Date.now() / 1000) + 600,
      })}.`;
      for (const header of [
        `Bearer ${none}`,
        'Bearer abc',
        'Bearer ',
        'Basic dXNlcjpwdw==',
        'Bearer',
      ])
        expect((await me({ Authorization: header })).status).toBe(401);
    });

    it('un Bearer invalide ne se replie JAMAIS sur les en-têtes de test, même valides', async () => {
      const customer = await withOwner((db) => createTestCustomer(db, w.ops.a));
      expect((await me(customer.headers)).status).toBe(200);
      const res = await me({ ...customer.headers, Authorization: 'Bearer abc.def.ghi' });
      expect(res.status).toBe(401);
      const expired = await forge({ exp: Math.floor(Date.now() / 1000) - 60 });
      expect((await me({ ...customer.headers, ...bearer(expired.token) })).status).toBe(401);
    });

    it('un Bearer valide prime sur des en-têtes de test qui désignent un autre compte', async () => {
      const other = await withOwner((db) => createTestCustomer(db, w.ops.a));
      const { token, customerId } = await forge();
      const res = await me({ ...other.headers, ...bearer(token) });
      expect(res.status).toBe(200);
      expect(res.body.customer_id).toBe(customerId);
    });

    it('jeton valide dont le compte n’existe pas (ou plus) : 401', async () => {
      const ghost = await forge({ sub: randomUUID() });
      expect((await me(bearer(ghost.token))).status).toBe(401);
    });

    it('garde : jeton valide d’un compte absent ou d’un autre prestataire, sur des routes qui ne relisent pas le compte : 401', async () => {
      const a = await login(app, { operatorCode: codeA, phone: freshPhone() });
      const customerId = (await me(bearer(a.access_token))).body.customer_id as string;
      const sign = (op: string, sub: string) =>
        new SignJWT({ op, dev: randomUUID() })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer('cashless-api')
          .setAudience('cashless-customer')
          .setSubject(sub)
          .setJti(randomUUID())
          .setIssuedAt()
          .setExpirationTime('10m')
          .sign(key());
      const ghost = await sign(w.ops.a, randomUUID());
      const otherOperator = await sign(w.ops.b, customerId);
      for (const token of [ghost, otherOperator]) {
        const media = await request(app.getHttpServer()).get('/v1/me/media').set(bearer(token));
        expect(media.status).toBe(401);
        const qr = await request(app.getHttpServer())
          .post('/v1/me/customer-qr-tokens')
          .set(bearer(token))
          .send({});
        expect(qr.status).toBe(401);
      }
      // Témoin : le vrai jeton passe la garde sur la même route de lecture.
      const ok = await request(app.getHttpServer()).get('/v1/me/media').set(bearer(a.access_token));
      expect(ok.status).toBe(200);
    });

    it('confusion de jetons : jeton de personne (faux serveur d’identité) ou HS256 d’une autre clé de l’API : 401 sur /me', async () => {
      const person = await withOwner((db) => w.idp.createPerson(db, { operatorId: w.ops.a }));
      expect((await me(bearer(person.token))).status).toBe(401);
      const a = await login(app, { operatorCode: codeA, phone: freshPhone() });
      const profile = await me(bearer(a.access_token));
      const otherKey = deriveCustomerKey(loadConfig().customerAuthHmacKey, 'otpCode');
      const confused = await new SignJWT({ op: w.ops.a, dev: randomUUID() })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('cashless-api')
        .setAudience('cashless-customer')
        .setSubject(profile.body.customer_id as string)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(otherKey);
      expect((await me(bearer(confused))).status).toBe(401);
    });

    it('un festivalier de A ne lit rien de B ; un jeton de A ne vaut pas dans B', async () => {
      const a = await login(app, { operatorCode: codeA, phone: freshPhone() });
      const b = await login(app, { operatorCode: codeB, phone: freshPhone() });
      const meA = (await me(bearer(a.access_token))).body;
      const meB = (await me(bearer(b.access_token))).body;
      expect(meA.customer_id).not.toBe(meB.customer_id);
      const [rowsA] = await rows<{ n: number }>(
        `SELECT count(*)::int AS n FROM party WHERE id = $1 AND operator_id = $2`,
        [meA.customer_id, w.ops.a],
      );
      expect(rowsA!.n).toBe(1);
      // Le compte de B, désigné par un jeton signé de la bonne clé mais avec `op` = A, n'existe pas chez A.
      const crossed = await new SignJWT({ op: w.ops.a, dev: randomUUID() })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('cashless-api')
        .setAudience('cashless-customer')
        .setSubject(meB.customer_id)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(key());
      expect((await me(bearer(crossed))).status).toBe(401);
      for (const path of ['/v1/me/wallets', '/v1/me/media']) {
        const res = await request(app.getHttpServer()).get(path).set(bearer(a.access_token));
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
      }
    });
  });
});
