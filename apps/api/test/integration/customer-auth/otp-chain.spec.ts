// Intégration de la chaîne d'envoi des codes (WP10 ; FR-011 à FR-013, NFR-002, SC-005). Vraie base, minuteries
// RÉELLES (délais réglés à 1 s : une passe réelle), faux fournisseurs réglés. Comptages limités au prestataire.
import { ChainedOtpSender } from '../../../src/customer-auth/otp-chain';
import {
  FakeSmsFallbackProvider,
  FakeSmsPrimaryProvider,
  FakeWhatsAppProvider,
  OTP_SMS_FALLBACK_PROVIDER,
  OTP_SMS_PRIMARY_PROVIDER,
  OTP_WHATSAPP_PROVIDER,
} from '../../../src/customer-auth/otp-providers';
import { OTP_SENDER } from '../../../src/customer-auth/otp-sender';
import { createTestApp } from '../../support/app';
import { createPublicCode, exchange, freshPhone, requestOtp } from '../../support/customer-auth';
import { createMediaWorld, ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Attempt {
  channel: string;
  provider: string;
  confirmed_at: Date | null;
  failed_reason: string | null;
}

describe('chaîne d’envoi des codes : une passe réelle', () => {
  let w: MediaWorld;
  let publicCode: string;
  const saved = {
    wa: process.env.OTP_WHATSAPP_TIMEOUT_MS,
    sp: process.env.OTP_SMS_PRIMARY_TIMEOUT_MS,
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    publicCode = await createPublicCode(w.ops.a);
    process.env.OTP_WHATSAPP_TIMEOUT_MS = '1000';
    process.env.OTP_SMS_PRIMARY_TIMEOUT_MS = '1000';
  });
  afterAll(() => {
    for (const [name, value] of [
      ['OTP_WHATSAPP_TIMEOUT_MS', saved.wa],
      ['OTP_SMS_PRIMARY_TIMEOUT_MS', saved.sp],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const start = async (behaviors: [string, string, string], extra: { real?: boolean } = {}) => {
    const wa = new FakeWhatsAppProvider();
    const sp = new FakeSmsPrimaryProvider();
    const sf = new FakeSmsFallbackProvider();
    [wa, sp, sf].forEach((p, i) => (p.behavior = behaviors[i] as never));
    const real = (p: FakeWhatsAppProvider | FakeSmsPrimaryProvider | FakeSmsFallbackProvider) => ({
      name: 'reel',
      send: p.send.bind(p),
      onDelivery: p.onDelivery.bind(p),
    });
    const app = await createTestApp({
      identity: w.idp,
      trustProxyHops: 1,
      overrides: [
        { provide: OTP_WHATSAPP_PROVIDER, useValue: extra.real ? real(wa) : wa },
        { provide: OTP_SMS_PRIMARY_PROVIDER, useValue: extra.real ? real(sp) : sp },
        { provide: OTP_SMS_FALLBACK_PROVIDER, useValue: extra.real ? real(sf) : sf },
      ],
    });
    return { app, wa, sp, sf, code: publicCode };
  };

  const attempts = (challengeId: string) =>
    rows<Attempt>(
      `SELECT channel, provider, confirmed_at, failed_reason FROM otp_channel_attempt
        WHERE operator_id = $1 AND challenge_id = $2 ORDER BY sent_at`,
      [w.ops.a, challengeId],
    );
  const idOf = (res: { body: { otp_request_id: string } }) => res.body.otp_request_id.slice(4);

  it('WhatsApp et SMS principal muets, repli qui confirme : 202 immédiat, trois essais, un code', async () => {
    const { app, wa, sp, sf, code } = await start(['SILENT', 'SILENT', 'CONFIRMS']);
    const seen: string[] = [];
    const out = jest.spyOn(process.stdout, 'write');
    const err = jest.spyOn(process.stderr, 'write');
    try {
      const phone = freshPhone();
      const began = Date.now();
      const res = await requestOtp(app, { phone, operator_code: code, channel: 'AUTO' });
      expect(res.status).toBe(202);
      expect(Date.now() - began).toBeLessThan(900); // la route n'attend pas la chaîne
      const secret = res.headers['x-test-otp-code'] as string;
      expect(secret).toMatch(/^[0-9]{6}$/); // X-Test-Otp-Code inchangé avec des faux
      await sleep(2_500);
      const rowsOfChallenge = await attempts(idOf(res));
      expect(rowsOfChallenge.map((r) => r.channel)).toEqual([
        'WHATSAPP',
        'SMS_PRIMARY',
        'SMS_FALLBACK',
      ]);
      expect(rowsOfChallenge.map((r) => r.confirmed_at !== null)).toEqual([false, false, true]);
      // Un seul défi, le même code reçu par les trois faux.
      const challenges = await rows<{ n: string }>(
        'SELECT count(*) AS n FROM otp_challenge WHERE operator_id = $1 AND phone = $2',
        [w.ops.a, phone],
      );
      expect(Number(challenges[0]!.n)).toBe(1);
      expect([wa, sp, sf].map((p) => p.sent().find((s) => s.phone === phone)?.code)).toEqual([
        secret,
        secret,
        secret,
      ]);
      // L'échange de ce code rend les jetons (SC-005).
      const done = await exchange(app, { otp_request_id: res.body.otp_request_id, code: secret });
      expect(done.status).toBe(200);
      expect(done.body.access_token).toBeDefined();
      // NFR-002 : le code n'est dans aucune colonne du prestataire, ni dans les sorties.
      for (const table of [
        'otp_challenge',
        'otp_channel_attempt',
        'audit_log',
        'api_idempotency',
      ]) {
        const found = await rows<{ n: string }>(
          `SELECT count(*) AS n FROM ${table} t WHERE t.operator_id = $1 AND row_to_json(t)::text LIKE $2`,
          [w.ops.a, `%${secret}%`],
        );
        expect(Number(found[0]!.n)).toBe(0);
      }
      seen.push(JSON.stringify([out.mock.calls, err.mock.calls]));
      expect(seen[0]).not.toContain(secret);
      expect(JSON.stringify([res.body])).not.toContain(secret);
    } finally {
      out.mockRestore();
      err.mockRestore();
      await app.close();
    }
  }, 20_000);

  it('les bascules ne comptent pas dans les limites : trois demandes puis la quatrième en 429', async () => {
    const { app, code } = await start(['SILENT', 'SILENT', 'SILENT']);
    try {
      const phone = freshPhone();
      for (let i = 0; i < 3; i++)
        expect(
          (await requestOtp(app, { phone, operator_code: code, channel: 'AUTO' })).status,
        ).toBe(202);
      await sleep(2_500); // toutes les bascules ont eu lieu
      const challenges = await rows<{ n: string }>(
        'SELECT count(*) AS n FROM otp_challenge WHERE operator_id = $1 AND phone = $2',
        [w.ops.a, phone],
      );
      expect(Number(challenges[0]!.n)).toBe(3); // les bascules n'ont créé aucun défi
      const fourth = await requestOtp(app, { phone, operator_code: code, channel: 'AUTO' });
      expect(fourth.status).toBe(429);
      expect(fourth.body.code).toBe('OTP_RATE_LIMITED');
    } finally {
      await app.close();
    }
  }, 20_000);

  it('canal SMS : aucun essai WhatsApp ; WhatsApp sans compte : SMS principal aussitôt', async () => {
    const { app, wa, sp, code } = await start(['NO_WHATSAPP', 'CONFIRMS', 'CONFIRMS']);
    try {
      const phone = freshPhone();
      const sms = await requestOtp(app, { phone, operator_code: code, channel: 'SMS' });
      const auto = await requestOtp(app, { phone: freshPhone(), operator_code: code });
      await sleep(300);
      expect((await attempts(idOf(sms))).map((r) => r.channel)).toEqual(['SMS_PRIMARY']);
      expect(wa.sent().map((s) => s.phone)).not.toContain(phone);
      const rowsAuto = await attempts(idOf(auto));
      expect(rowsAuto.map((r) => [r.channel, r.failed_reason])).toEqual([
        ['WHATSAPP', 'NO_WHATSAPP'],
        ['SMS_PRIMARY', null],
      ]);
      expect(sp.sent()).toHaveLength(2);
    } finally {
      await app.close();
    }
  }, 20_000);

  it('un fournisseur non factice : aucun en-tête X-Test-Otp-Code', async () => {
    const { app, code } = await start(['CONFIRMS', 'CONFIRMS', 'CONFIRMS'], { real: true });
    try {
      const res = await requestOtp(app, { phone: freshPhone(), operator_code: code });
      expect(res.status).toBe(202);
      expect(res.headers['x-test-otp-code']).toBeUndefined();
      expect(Object.keys(res.body).sort()).toEqual(['expires_in', 'otp_request_id']);
    } finally {
      await app.close();
    }
  }, 20_000);

  it('arrêt pendant une chaîne : plus de code en mémoire, plus de bascule, plus d’écriture', async () => {
    const { app, wa, sp, sf, code } = await start(['SILENT', 'SILENT', 'SILENT']);
    const phone = freshPhone();
    const res = await requestOtp(app, { phone, operator_code: code, channel: 'AUTO' });
    expect(res.status).toBe(202);
    const chain = app.get<ChainedOtpSender>(OTP_SENDER, { strict: false });
    expect(chain.inFlightCount()).toBe(1);
    await app.close();
    expect(chain.inFlightCount()).toBe(0);
    await sleep(1_800);
    expect(wa.sent().filter((s) => s.phone === phone)).toHaveLength(1);
    expect(sp.sent().filter((s) => s.phone === phone)).toHaveLength(0);
    expect(sf.sent().filter((s) => s.phone === phone)).toHaveLength(0);
    const after = await attempts(idOf(res));
    expect(after.length).toBeLessThanOrEqual(1);
  }, 20_000);
});
