// Intégration : authentification des festivaliers par code à usage unique (`requestCustomerOtp`,
// `exchangeCustomerOtp`). Vraie base, RLS du prestataire, faux envoyeur (code lu en en-tête de test).
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OTP_SENDER } from '../../../src/customer-auth/otp-sender';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import {
  bearer,
  createPublicCode,
  exchange,
  freshIp,
  freshPhone,
  login,
  requestOtp,
} from '../../support/customer-auth';
import { createMediaWorld, ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';

describe('authentification des festivaliers : demande et échange du code', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let codeA: string;
  let codeB: string;

  beforeAll(async () => {
    w = await createMediaWorld();
    codeA = await createPublicCode(w.ops.a);
    codeB = await createPublicCode(w.ops.b);
    app = await createTestApp({ identity: w.idp, trustProxyHops: 1 });
  });
  afterAll(async () => {
    await app.close();
  });

  it('parcours complet : code, jetons, puis GET /me en Bearer avec le bon numéro', async () => {
    const phone = freshPhone();
    const sent = await requestOtp(app, { phone, operator_code: codeA, channel: 'SMS' });
    expect(sent.status).toBe(202);
    expect(sent.body.expires_in).toBe(300);
    expect(sent.body.otp_request_id).toMatch(/^otp_[0-9a-f-]{36}$/);
    const code = sent.headers['x-test-otp-code'];
    expect(code).toMatch(/^[0-9]{6}$/);
    // Rien d'exploitable en base : ni le code ni le numéro dans l'empreinte.
    const [row] = await rows<{ code_hash: Buffer; channel: string }>(
      'SELECT code_hash, channel FROM otp_challenge WHERE phone = $1',
      [phone],
    );
    expect(row!.channel).toBe('SMS');
    expect(row!.code_hash.length).toBe(32);
    expect(row!.code_hash.toString('utf8')).not.toContain(code);

    const done = await exchange(app, { otp_request_id: sent.body.otp_request_id, code });
    expect(done.status).toBe(200);
    expect(contractViolations('TokenResponse', done.body)).toEqual([]);
    expect(done.body).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
    expect(done.body.refresh_token).toMatch(/^crt_/);

    const me = await request(app.getHttpServer()).get('/v1/me').set(bearer(done.body.access_token));
    expect(me.status).toBe(200);
    expect(me.body.phone).toBe(phone);
    expect(contractViolations('CustomerProfile', me.body)).toEqual([]);
    // Compte neutre : le numéro n'est pas dans le nom ; une partie CUSTOMER du bon prestataire.
    const [party] = await rows<{ legal_name: string; operator_id: string; kind: string }>(
      'SELECT p.legal_name, p.operator_id, p.kind FROM party p WHERE p.id = $1',
      [me.body.customer_id],
    );
    expect(party).toMatchObject({ kind: 'CUSTOMER', operator_id: w.ops.a });
    expect(party!.legal_name).not.toContain(phone.slice(-6));
    // Le jeton n'est jamais gardé en clair ; le jeton d'accès n'est pas non plus le jeton de renouvellement.
    const [stored] = await rows<{ token_hash: Buffer }>(
      'SELECT token_hash FROM customer_refresh_token WHERE customer_id = $1',
      [me.body.customer_id],
    );
    expect(stored!.token_hash.toString('utf8')).not.toContain(done.body.refresh_token);
  });

  it('un numéro déjà connu retrouve le même compte ; le même numéro chez B est un autre compte', async () => {
    const phone = freshPhone();
    const first = await login(app, { operatorCode: codeA, phone });
    const second = await login(app, { operatorCode: codeA, phone });
    const other = await login(app, { operatorCode: codeB, phone });
    const idOf = async (t: { access_token: string }) =>
      (await request(app.getHttpServer()).get('/v1/me').set(bearer(t.access_token))).body
        .customer_id as string;
    expect(await idOf(second)).toBe(await idOf(first));
    expect(await idOf(other)).not.toBe(await idOf(first));
    const [n] = await rows<{ n: number }>(
      'SELECT count(*)::int AS n FROM customer_identity WHERE phone = $1',
      [phone],
    );
    expect(n!.n).toBe(2);
  });

  it('la réponse 202 est la même pour un numéro connu et un numéro inconnu', async () => {
    const known = freshPhone();
    await login(app, { operatorCode: codeA, phone: known });
    const a = await requestOtp(app, { phone: known, operator_code: codeA });
    const b = await requestOtp(app, { phone: freshPhone(), operator_code: codeA });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
    expect(a.body.expires_in).toBe(b.body.expires_in);
    expect(Object.keys(a.headers).filter((h) => h.startsWith('x-test'))).toEqual(
      Object.keys(b.headers).filter((h) => h.startsWith('x-test')),
    );
  });

  it('demandes invalides : code de prestataire inconnu, numéro mal formé, canal inconnu : 400', async () => {
    for (const body of [
      { phone: freshPhone(), operator_code: 'inconnu-zzz' },
      { phone: '0770000001', operator_code: codeA },
      { phone: freshPhone(), operator_code: codeA, channel: 'FAX' },
      { operator_code: codeA },
      { phone: freshPhone(), operator_code: codeA, extra: 1 },
    ])
      expect((await requestOtp(app, body)).status).toBe(400);
  });

  it('au plus 3 envois par numéro sur 15 minutes : le 4e donne 429 OTP_RATE_LIMITED avec Retry-After', async () => {
    const phone = freshPhone();
    for (let i = 0; i < 3; i += 1)
      expect((await requestOtp(app, { phone, operator_code: codeA })).status).toBe(202);
    const refused = await requestOtp(app, { phone, operator_code: codeA });
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('OTP_RATE_LIMITED');
    const wait = Number(refused.headers['retry-after']);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(900);
    // Un autre numéro, ou le même numéro chez un autre prestataire, n'est pas touché.
    expect((await requestOtp(app, { phone: freshPhone(), operator_code: codeA })).status).toBe(202);
    expect((await requestOtp(app, { phone, operator_code: codeB })).status).toBe(202);
    // Rien n'a été créé pour la demande refusée.
    const [n] = await rows<{ n: number }>(
      'SELECT count(*)::int AS n FROM otp_challenge WHERE phone = $1 AND operator_id = $2',
      [phone, w.ops.a],
    );
    expect(n!.n).toBe(3);
  });

  it('au plus CUSTOMER_OTP_IP_HOURLY_MAX demandes par adresse et par heure (10 par défaut)', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i += 1)
      expect(
        (await requestOtp(app, { phone: freshPhone(), operator_code: codeA }, ip)).status,
      ).toBe(202);
    const refused = await requestOtp(app, { phone: freshPhone(), operator_code: codeA }, ip);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('OTP_RATE_LIMITED');
    const wait = Number(refused.headers['retry-after']);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(3600);
    // Une autre adresse passe.
    expect((await requestOtp(app, { phone: freshPhone(), operator_code: codeA })).status).toBe(202);
    // L'adresse n'est jamais en clair en base.
    const refs = await rows<{ client_ref: string }>(
      'SELECT DISTINCT client_ref FROM otp_challenge WHERE operator_id = $1',
      [w.ops.a],
    );
    expect(refs.every((r) => !r.client_ref.includes(ip))).toBe(true);
  });

  it('un nouveau code remplace le précédent (un seul code vivant par numéro)', async () => {
    const phone = freshPhone();
    const first = await requestOtp(app, { phone, operator_code: codeA });
    const second = await requestOtp(app, { phone, operator_code: codeA });
    const old = await exchange(app, {
      otp_request_id: first.body.otp_request_id,
      code: first.headers['x-test-otp-code'],
    });
    expect(old.status).toBe(422);
    const fresh = await exchange(app, {
      otp_request_id: second.body.otp_request_id,
      code: second.headers['x-test-otp-code'],
    });
    expect(fresh.status).toBe(200);
  });

  it('échange : corps invalide 400 ; défi inconnu ou mal formé 422 OTP_INVALID', async () => {
    expect((await exchange(app, { otp_request_id: 'otp_x', code: '12345' })).status).toBe(400);
    expect((await exchange(app, { otp_request_id: 'otp_x' })).status).toBe(400);
    for (const id of ['otp_x', 'otp_00000000-0000-4000-8000-000000000000', '../etc']) {
      const res = await exchange(app, { otp_request_id: id, code: '123456' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('OTP_INVALID');
    }
  });
});

describe('envoyeur de codes qui n’est pas un faux', () => {
  it('aucun en-tête X-Test-Otp-Code : le code n’est jamais rendu par la réponse', async () => {
    const w = await createMediaWorld();
    const code = await createPublicCode(w.ops.a);
    const sent: Array<{ phone: string; code: string; channel: string }> = [];
    const app = await createTestApp({
      identity: w.idp,
      trustProxyHops: 1,
      overrides: [
        {
          provide: OTP_SENDER,
          useValue: {
            isFake: false,
            send: async (phone: string, otp: string, channel: string) => {
              sent.push({ phone, code: otp, channel });
            },
          },
        },
      ],
    });
    try {
      const phone = freshPhone();
      const res = await requestOtp(app, { phone, operator_code: code, channel: 'WHATSAPP' });
      expect(res.status).toBe(202);
      expect(res.headers['x-test-otp-code']).toBeUndefined();
      expect(Object.keys(res.body).sort()).toEqual(['expires_in', 'otp_request_id']);
      expect(JSON.stringify([res.body, res.headers])).not.toContain(sent[0]!.code);
      // L'envoyeur reçoit bien le code, le même que celui que l'échange accepte.
      expect(sent).toEqual([
        { phone, code: expect.stringMatching(/^[0-9]{6}$/), channel: 'WHATSAPP' },
      ]);
      const done = await exchange(app, {
        otp_request_id: res.body.otp_request_id,
        code: sent[0]!.code,
      });
      expect(done.status).toBe(200);
    } finally {
      await app.close();
    }
  });
});
