// Intégration (mission 9b, WP11 ; FR-019, OP-N124) : `verifyChallengeOnly` (vérifie, compte les essais, ne consomme pas)
// puis `consumeChallenge` (dans la transaction de l'appelant : verrou, relecture, liaison revérifiée, `consumed_at`).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  CustomerAuthService,
  OTP_MAX_ATTEMPTS,
} from '../../../src/customer-auth/customer-auth.service';
import { OTP_SENDER } from '../../../src/customer-auth/otp-sender';
import { TenantTx } from '../../../src/db/tenant-tx';
import { RefundsHolderModule } from '../../../src/refunds/refunds-holder.module';
import { createTestApp } from '../../support/app';
import { createPublicCode, freshPhone } from '../../support/customer-auth';
import { createMediaWorld, ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import { RecordingSender, wrongCode } from '../refunds/holder-fixtures';

describe('verifyChallengeOnly puis consumeChallenge', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let auth: CustomerAuthService;
  let tx: TenantTx;
  const sender = new RecordingSender();

  beforeAll(async () => {
    w = await createMediaWorld();
    await createPublicCode(w.ops.a);
    app = await createTestApp({
      identity: w.idp,
      trustProxyHops: 1,
      imports: [RefundsHolderModule],
      overrides: [{ provide: OTP_SENDER, useValue: sender }],
    });
    auth = app.get(CustomerAuthService, { strict: false });
    tx = app.get(TenantTx, { strict: false });
  });
  afterAll(async () => {
    await app.close();
  });

  const holder = async (phone = freshPhone(), subjectId = randomUUID()) => {
    const c = await auth.issueChallenge({
      operatorId: w.ops.a,
      phone,
      purpose: 'REFUND_HOLDER',
      subjectId,
    });
    return { phone, subjectId, id: c.otpRequestId, code: c.code };
  };
  const consumed = async (id: string) =>
    (
      await rows<{ c: boolean }>(
        'SELECT consumed_at IS NOT NULL AS c FROM otp_challenge WHERE id = $1',
        [id.slice(4)],
      )
    )[0]!.c;
  const verify = (c: Awaited<ReturnType<typeof holder>>, extra: object = {}) =>
    auth.verifyChallengeOnly({
      otpRequestId: c.id,
      code: c.code,
      expectedPhone: c.phone,
      purpose: 'REFUND_HOLDER',
      subjectId: c.subjectId,
      ...extra,
    });
  const consume = (c: Awaited<ReturnType<typeof holder>>, extra: object = {}) =>
    tx.run(w.ops.a, (client) =>
      auth.consumeChallenge(client, {
        otpRequestId: c.id,
        expectedPhone: c.phone,
        purpose: 'REFUND_HOLDER',
        subjectId: c.subjectId,
        operatorId: w.ops.a,
        ...extra,
      }),
    );

  it('vérifier ne consomme pas ; consommer pose consumed_at une fois ; un second usage est refusé', async () => {
    const c = await holder();
    await verify(c);
    expect(await consumed(c.id)).toBe(false);
    await verify(c); // vérifiable à nouveau tant qu'il n'est pas consommé
    await consume(c);
    expect(await consumed(c.id)).toBe(true);
    await expect(consume(c)).rejects.toMatchObject({ code: 'OTP_INVALID' });
    await expect(verify(c)).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });

  it('consommer sans avoir vérifié le bon lien (mauvais usage, sujet ou numéro) : refusé, code intact', async () => {
    const c = await holder();
    await expect(consume(c, { purpose: 'LOGIN' })).rejects.toMatchObject({ code: 'OTP_INVALID' });
    await expect(consume(c, { subjectId: randomUUID() })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    await expect(consume(c, { expectedPhone: freshPhone() })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    await expect(consume(c, { otpRequestId: 'otp_not-a-uuid' })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    expect(await consumed(c.id)).toBe(false);
  });

  it('une erreur après la vérification annule la consommation : le code reste utilisable', async () => {
    const c = await holder();
    await verify(c);
    await expect(
      tx.run(w.ops.a, async (client) => {
        await auth.consumeChallenge(client, {
          otpRequestId: c.id,
          expectedPhone: c.phone,
          purpose: 'REFUND_HOLDER',
          subjectId: c.subjectId,
          operatorId: w.ops.a,
        });
        throw new Error('écriture de la décision refusée');
      }),
    ).rejects.toThrow('écriture de la décision refusée');
    expect(await consumed(c.id)).toBe(false);
    await verify(c);
    await consume(c);
    expect(await consumed(c.id)).toBe(true);
  });

  it('essais faux comptés sans consommation, blocage au 5e, puis le bon code est refusé ; autre prestataire : refusé', async () => {
    const c = await holder();
    const wrong = { code: wrongCode(c.code) };
    for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i += 1)
      await expect(verify(c, wrong)).rejects.toMatchObject({ code: 'OTP_INVALID' });
    await expect(verify(c, wrong)).rejects.toMatchObject({ code: 'OTP_RATE_LIMITED' });
    await expect(verify(c)).rejects.toMatchObject({ code: 'OTP_RATE_LIMITED' });
    expect(await consumed(c.id)).toBe(false);
    const d = await holder();
    await expect(verify(d, { operatorId: w.ops.b })).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });

  it('deux consommations simultanées du même code : une seule réussit', async () => {
    const c = await holder();
    await verify(c);
    const results = await Promise.allSettled([consume(c), consume(c), consume(c)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await consumed(c.id)).toBe(true);
  });
});
