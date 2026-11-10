// Intégration : essais faux, blocage du numéro, code expiré ou réutilisé (`exchangeCustomerOtp`).
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../support/app';
import { createPublicCode, exchange, freshPhone, requestOtp } from '../../support/customer-auth';
import { withOwner } from '../../support/db';
import { createMediaWorld, ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';

describe('authentification des festivaliers : essais, blocage, expiration', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let code: string;

  beforeAll(async () => {
    w = await createMediaWorld();
    code = await createPublicCode(w.ops.a);
    app = await createTestApp({ identity: w.idp, trustProxyHops: 1 });
  });
  afterAll(async () => {
    await app.close();
  });

  const ask = async (phone = freshPhone()) => {
    const res = await requestOtp(app, { phone, operator_code: code });
    expect(res.status).toBe(202);
    return {
      phone,
      id: res.body.otp_request_id as string,
      otp: res.headers['x-test-otp-code'] as string,
    };
  };
  const wrong = (otp: string) => (otp === '000000' ? '000001' : '000000');
  const challenge = async (id: string) =>
    (
      await rows<{ attempts: number; invalidated_at: Date | null; consumed_at: Date | null }>(
        'SELECT attempts, invalidated_at, consumed_at FROM otp_challenge WHERE id = $1',
        [id.slice(4)],
      )
    )[0]!;

  it('un code faux : 422 OTP_INVALID et un essai de plus, validé en base', async () => {
    const c = await ask();
    for (let i = 1; i <= 2; i += 1) {
      const res = await exchange(app, { otp_request_id: c.id, code: wrong(c.otp) });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('OTP_INVALID');
      expect((await challenge(c.id)).attempts).toBe(i);
    }
    // Le bon code passe encore, puis ne passe plus (usage unique).
    expect((await exchange(app, { otp_request_id: c.id, code: c.otp })).status).toBe(200);
    expect((await challenge(c.id)).consumed_at).not.toBeNull();
    const again = await exchange(app, { otp_request_id: c.id, code: c.otp });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('OTP_INVALID');
  });

  it('5e essai faux : 429 avec Retry-After, défi invalidé, numéro bloqué 30 min, le blocage persiste', async () => {
    const c = await ask();
    for (let i = 0; i < 4; i += 1)
      expect((await exchange(app, { otp_request_id: c.id, code: wrong(c.otp) })).status).toBe(422);
    const fifth = await exchange(app, { otp_request_id: c.id, code: wrong(c.otp) });
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('OTP_RATE_LIMITED');
    const wait = Number(fifth.headers['retry-after']);
    expect(wait).toBeGreaterThan(1700);
    expect(wait).toBeLessThanOrEqual(1800);
    // Validé en base malgré la réponse d'erreur : essais, invalidation et blocage.
    const row = await challenge(c.id);
    expect(row.attempts).toBe(5);
    expect(row.invalidated_at).not.toBeNull();
    const [block] = await rows<{ minutes: number }>(
      `SELECT extract(epoch FROM blocked_until - now()) / 60 AS minutes FROM otp_phone_block
        WHERE operator_id = $1 AND phone = $2`,
      [w.ops.a, c.phone],
    );
    expect(Number(block!.minutes)).toBeGreaterThan(29);
    expect(Number(block!.minutes)).toBeLessThanOrEqual(30);
    // Même le bon code est refusé, sans nouvel essai compté ; une nouvelle demande aussi.
    const right = await exchange(app, { otp_request_id: c.id, code: c.otp });
    expect(right.status).toBe(429);
    const nextRequest = await requestOtp(app, { phone: c.phone, operator_code: code });
    expect(nextRequest.status).toBe(429);
    expect(nextRequest.body.code).toBe('OTP_RATE_LIMITED');
    expect(Number(nextRequest.headers['retry-after'])).toBeGreaterThan(1700);
    expect((await challenge(c.id)).attempts).toBe(5);
    // Un autre numéro n'est pas bloqué.
    await ask();
  });

  it('essais cumulés : 4 faux sur un code, nouveau code, 1 faux : 429 et numéro bloqué', async () => {
    const phone = freshPhone();
    const first = await ask(phone);
    for (let i = 0; i < 4; i += 1)
      expect(
        (await exchange(app, { otp_request_id: first.id, code: wrong(first.otp) })).status,
      ).toBe(422);
    const second = await ask(phone);
    const res = await exchange(app, { otp_request_id: second.id, code: wrong(second.otp) });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('OTP_RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(1700);
    expect((await requestOtp(app, { phone, operator_code: code })).status).toBe(429);
    const [block] = await rows<{ n: number }>(
      'SELECT count(*)::int AS n FROM otp_phone_block WHERE operator_id = $1 AND phone = $2',
      [w.ops.a, phone],
    );
    expect(block!.n).toBe(1);
  });

  it('le blocage d’un numéro chez A ne touche pas le même numéro chez B', async () => {
    const codeB = await createPublicCode(w.ops.b);
    const phone = freshPhone();
    const c = await ask(phone);
    for (let i = 0; i < 5; i += 1)
      await exchange(app, { otp_request_id: c.id, code: wrong(c.otp) });
    expect((await requestOtp(app, { phone, operator_code: code })).status).toBe(429);
    expect((await requestOtp(app, { phone, operator_code: codeB })).status).toBe(202);
  });

  it('blocage levé à son échéance : le numéro peut redemander un code', async () => {
    const c = await ask();
    for (let i = 0; i < 5; i += 1)
      await exchange(app, { otp_request_id: c.id, code: wrong(c.otp) });
    await withOwner((db) =>
      db.query(
        `UPDATE otp_phone_block SET blocked_until = now() - interval '1 second'
          WHERE operator_id = $1 AND phone = $2`,
        [w.ops.a, c.phone],
      ),
    );
    expect((await requestOtp(app, { phone: c.phone, operator_code: code })).status).toBe(202);
  });

  it('code expiré : 422 OTP_INVALID, même avec le bon code', async () => {
    const c = await ask();
    await withOwner((db) =>
      db.query("UPDATE otp_challenge SET expires_at = now() - interval '1 second' WHERE id = $1", [
        c.id.slice(4),
      ]),
    );
    const res = await exchange(app, { otp_request_id: c.id, code: c.otp });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OTP_INVALID');
    expect((await challenge(c.id)).consumed_at).toBeNull();
  });

  it('le code d’un défi ne vaut pas pour un autre défi', async () => {
    const first = await ask();
    const second = await ask();
    const res = await exchange(app, { otp_request_id: first.id, code: second.otp });
    // Soit le code est faux pour ce défi (422), soit, par hasard, identique : seul 422 est attendu ici.
    if (first.otp !== second.otp) expect(res.status).toBe(422);
  });
});
