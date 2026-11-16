// Intégration (mission 9a, WP03) : `verifyChallenge` / `issueChallenge` du service d'authentification des festivaliers.
// Le code est vérifié et consommé SANS jeton ni compte ; l'usage, le sujet, le numéro et le prestataire sont liés.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { CustomerAuthService } from '../../../src/customer-auth/customer-auth.service';
import { OTP_SENDER } from '../../../src/customer-auth/otp-sender';
import { RefundsHolderModule } from '../../../src/refunds/refunds-holder.module';
import { createTestApp } from '../../support/app';
import { createPublicCode, exchange, freshPhone, requestOtp } from '../../support/customer-auth';
import { createMediaWorld, ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import { RecordingSender, wrongCode } from '../refunds/holder-fixtures';

describe('verifyChallenge / issueChallenge', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let auth: CustomerAuthService;
  const sender = new RecordingSender();
  let codeA: string;
  let codeB: string;

  beforeAll(async () => {
    w = await createMediaWorld();
    codeA = await createPublicCode(w.ops.a);
    codeB = await createPublicCode(w.ops.b);
    app = await createTestApp({
      identity: w.idp,
      trustProxyHops: 1,
      imports: [RefundsHolderModule],
      overrides: [{ provide: OTP_SENDER, useValue: sender }],
    });
    auth = app.get(CustomerAuthService, { strict: false });
  });
  afterAll(async () => {
    await app.close();
  });

  const login = async (phone = freshPhone(), operatorCode = codeA) => {
    const res = await requestOtp(app, { phone, operator_code: operatorCode });
    expect(res.status).toBe(202);
    return { phone, id: res.body.otp_request_id as string, code: sender.lastCode(phone) };
  };
  const holder = async (phone = freshPhone(), subjectId = randomUUID()) => {
    const c = await auth.issueChallenge({
      operatorId: w.ops.a,
      phone,
      purpose: 'REFUND_HOLDER',
      subjectId,
    });
    return { phone, subjectId, id: c.otpRequestId, code: c.code };
  };
  const verifyLogin = (c: { id: string; code: string; phone: string }, extra = {}) =>
    auth.verifyChallenge({
      otpRequestId: c.id,
      code: c.code,
      expectedPhone: c.phone,
      purpose: 'LOGIN',
      ...extra,
    });
  const state = async (id: string) =>
    (
      await rows<{ attempts: number; consumed_at: Date | null; invalidated_at: Date | null }>(
        'SELECT attempts, consumed_at, invalidated_at FROM otp_challenge WHERE id = $1',
        [id.slice(4)],
      )
    )[0]!;
  const invalid = { code: 'OTP_INVALID', status: 422 };

  it('bon code : consommé, aucun jeton, aucun compte créé', async () => {
    // Comptes limités au prestataire du test : les suites parallèles en créent pour les leurs (CI).
    const counts = () =>
      rows<{ n: number }>(
        `SELECT (SELECT count(*) FROM customer_identity WHERE operator_id = $1)::int AS n,
                (SELECT count(*) FROM customer_refresh_token WHERE operator_id = $1)::int AS t,
                (SELECT count(*) FROM party WHERE operator_id = $1)::int AS p`,
        [w.ops.a],
      );
    const before = await counts();
    const c = await login();
    await expect(verifyLogin(c)).resolves.toBeUndefined();
    expect((await state(c.id)).consumed_at).not.toBeNull();
    const after = await counts();
    expect(after).toEqual(before);
    await expect(verifyLogin(c)).rejects.toMatchObject(invalid); // rejeu
  });

  it('mauvais code : essai compté malgré l’erreur ; 5e essai : 429 et blocage', async () => {
    const c = await login();
    for (let i = 1; i <= 2; i += 1) {
      await expect(verifyLogin({ ...c, code: wrongCode(c.code) })).rejects.toMatchObject(invalid);
      expect((await state(c.id)).attempts).toBe(i);
    }
    for (let i = 0; i < 2; i += 1)
      await expect(verifyLogin({ ...c, code: wrongCode(c.code) })).rejects.toMatchObject(invalid);
    await expect(verifyLogin({ ...c, code: wrongCode(c.code) })).rejects.toMatchObject({
      code: 'OTP_RATE_LIMITED',
      status: 429,
      headers: { 'Retry-After': expect.any(String) },
    });
    const block = await rows(
      'SELECT 1 FROM otp_phone_block WHERE operator_id = $1 AND phone = $2 AND blocked_until > now()',
      [w.ops.a, c.phone],
    );
    expect(block).toHaveLength(1);
    expect((await state(c.id)).invalidated_at).not.toBeNull();
    // Le bon code ne passe plus : numéro bloqué.
    await expect(verifyLogin(c)).rejects.toMatchObject({ code: 'OTP_RATE_LIMITED' });
  });

  it('numéro, usage, sujet, prestataire ou format qui ne correspondent pas : 422 sans essai compté', async () => {
    const c = await login();
    await expect(verifyLogin(c, { expectedPhone: freshPhone() })).rejects.toMatchObject(invalid);
    await expect(
      auth.verifyChallenge({
        otpRequestId: c.id,
        code: c.code,
        expectedPhone: c.phone,
        purpose: 'REFUND_HOLDER',
        subjectId: randomUUID(),
      }),
    ).rejects.toMatchObject(invalid);
    await expect(verifyLogin(c, { subjectId: randomUUID() })).rejects.toMatchObject(invalid);
    await expect(verifyLogin(c, { operatorId: w.ops.b })).rejects.toMatchObject(invalid);
    await expect(verifyLogin({ ...c, id: 'abc' })).rejects.toMatchObject(invalid);
    await expect(verifyLogin({ ...c, id: `otp_${randomUUID()}` })).rejects.toMatchObject(invalid);
    const s = await state(c.id);
    expect(s.attempts).toBe(0);
    expect(s.consumed_at).toBeNull();
    await expect(verifyLogin(c, { operatorId: w.ops.a })).resolves.toBeUndefined();
  });

  it('défi d’une autre demande ou d’un autre prestataire (même numéro) refusé', async () => {
    const phone = freshPhone();
    const first = await holder(phone, randomUUID());
    const wrongSubject = () =>
      auth.verifyChallenge({
        otpRequestId: first.id,
        code: first.code,
        expectedPhone: phone,
        purpose: 'REFUND_HOLDER',
        subjectId: randomUUID(),
        operatorId: w.ops.a,
      });
    await expect(wrongSubject()).rejects.toMatchObject(invalid);
    await expect(
      auth.verifyChallenge({
        otpRequestId: first.id,
        code: first.code,
        expectedPhone: phone,
        purpose: 'REFUND_HOLDER',
        subjectId: first.subjectId,
        operatorId: w.ops.b,
      }),
    ).rejects.toMatchObject(invalid);
    expect((await state(first.id)).attempts).toBe(0);
    await expect(
      auth.verifyChallenge({
        otpRequestId: first.id,
        code: first.code,
        expectedPhone: phone,
        purpose: 'REFUND_HOLDER',
        subjectId: first.subjectId,
        operatorId: w.ops.a,
      }),
    ).resolves.toBeUndefined();
  });

  it('code de connexion présenté comme code de titulaire, et l’inverse : refusés, aucune session', async () => {
    const lg = await login();
    await expect(
      auth.verifyChallenge({
        otpRequestId: lg.id,
        code: lg.code,
        expectedPhone: lg.phone,
        purpose: 'REFUND_HOLDER',
        subjectId: randomUUID(),
      }),
    ).rejects.toMatchObject(invalid);
    const h = await holder();
    await expect(verifyLogin(h)).rejects.toMatchObject(invalid);
    // Par la route de connexion : un code de titulaire n'ouvre jamais de session.
    const res = await exchange(app, { otp_request_id: h.id, code: h.code });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OTP_INVALID');
    const accounts = await rows('SELECT 1 FROM customer_identity WHERE phone = $1', [h.phone]);
    expect(accounts).toHaveLength(0);
    expect((await state(h.id)).consumed_at).toBeNull();
    expect((await state(h.id)).attempts).toBe(0);
  });

  it('un seul code vivant par (numéro, usage), et par sujet pour le titulaire', async () => {
    const phone = freshPhone();
    const l1 = await login(phone);
    const h1 = await holder(phone, randomUUID());
    // Un code de titulaire n'invalide pas la connexion en cours.
    expect((await state(l1.id)).invalidated_at).toBeNull();
    const l2 = await login(phone);
    // Une nouvelle connexion remplace la précédente, pas le code du titulaire.
    expect((await state(l1.id)).invalidated_at).not.toBeNull();
    expect((await state(h1.id)).invalidated_at).toBeNull();
    expect((await state(l2.id)).invalidated_at).toBeNull();

    const other = freshPhone();
    const s1 = randomUUID();
    const a = await holder(other, s1);
    const b = await holder(other, randomUUID()); // autre sujet : a reste vivant
    expect((await state(a.id)).invalidated_at).toBeNull();
    const a2 = await holder(other, s1); // même sujet : a remplacé
    expect((await state(a.id)).invalidated_at).not.toBeNull();
    expect((await state(b.id)).invalidated_at).toBeNull();
    expect((await state(a2.id)).invalidated_at).toBeNull();
  });

  it('quota par numéro commun (3 par 15 min, tous usages) ; sans limite par adresse pour le titulaire', async () => {
    const phone = freshPhone();
    await login(phone);
    await holder(phone, randomUUID());
    await holder(phone, randomUUID());
    await expect(holder(phone, randomUUID())).rejects.toMatchObject({
      code: 'OTP_RATE_LIMITED',
      status: 429,
    });
    const res = await requestOtp(app, { phone, operator_code: codeA });
    expect(res.status).toBe(429);
    // Le défi du titulaire porte une référence dérivée du sujet, pas d'une adresse.
    const refs = await rows<{ client_ref: string }>(
      "SELECT client_ref FROM otp_challenge WHERE phone = $1 AND purpose = 'REFUND_HOLDER'",
      [phone],
    );
    expect(new Set(refs.map((r) => r.client_ref)).size).toBe(2);
  });

  it('connexion d’un autre prestataire : le numéro reste isolé', async () => {
    const phone = freshPhone();
    const l = await login(phone, codeB);
    await expect(verifyLogin(l, { operatorId: w.ops.a })).rejects.toMatchObject(invalid);
    await expect(verifyLogin(l, { operatorId: w.ops.b })).resolves.toBeUndefined();
  });

  it('aucun code en clair dans la base', async () => {
    const h = await holder();
    const stored = await rows<{ code_hash: Buffer }>(
      'SELECT code_hash FROM otp_challenge WHERE id = $1',
      [h.id.slice(4)],
    );
    expect(stored[0]!.code_hash.toString('utf8')).not.toContain(h.code);
  });
});
