// Unitaires de la chaîne d'envoi des codes (WP10 ; FR-011 à FR-013, NFR-001, NFR-002, NFR-005). Horloge simulée :
// aucune attente réelle. L'enregistreur est en mémoire ; le code n'y arrive jamais.
import { APP_CONFIG } from '../../../src/config/config';
import {
  ChainedOtpSender,
  OTP_CHAIN_MAX_ENTRIES,
  OTP_CODE_HARD_CAP_MS,
  type AttemptRecorder,
} from '../../../src/customer-auth/otp-chain';
import {
  createSmsFallbackProvider,
  createSmsPrimaryProvider,
  createWhatsAppProvider,
  FakeSmsFallbackProvider,
  FakeSmsPrimaryProvider,
  FakeWhatsAppProvider,
  OTP_SMS_FALLBACK_PROVIDER,
  OTP_SMS_PRIMARY_PROVIDER,
  OTP_WHATSAPP_PROVIDER,
  type OtpProvider,
} from '../../../src/customer-auth/otp-providers';
import { FakeInProductionError } from '../../../src/kms/production-guard';
import { assertProcessIsSafe } from '../../../src/processes/bootstrap';

const CODE = '734918';
const OP = '11111111-1111-4111-8111-111111111111';
const challenge = (n: number) => ({
  challengeId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  operatorId: OP,
});

interface Call {
  op: 'start' | 'confirm' | 'fail';
  args: unknown[];
}

function memoryRecorder() {
  const calls: Call[] = [];
  let n = 0;
  const recorder: AttemptRecorder = {
    start: (ctx, channel, provider) => {
      calls.push({ op: 'start', args: [ctx, channel, provider] });
      return Promise.resolve(`attempt-${++n}`);
    },
    confirm: (id) => {
      calls.push({ op: 'confirm', args: [id] });
      return Promise.resolve();
    },
    fail: (id, reason) => {
      calls.push({ op: 'fail', args: [id, reason] });
      return Promise.resolve();
    },
  };
  return { recorder, calls, of: (op: Call['op']) => calls.filter((c) => c.op === op) };
}

function build(timeouts = { wa: 10_000, sp: 20_000 }) {
  const wa = new FakeWhatsAppProvider();
  const sp = new FakeSmsPrimaryProvider();
  const sf = new FakeSmsFallbackProvider();
  const rec = memoryRecorder();
  const chain = new ChainedOtpSender({
    whatsapp: wa,
    smsPrimary: sp,
    smsFallback: sf,
    whatsappTimeoutMs: timeouts.wa,
    smsPrimaryTimeoutMs: timeouts.sp,
    recorder: rec.recorder,
  });
  return { wa, sp, sf, rec, chain };
}
const silence = (...providers: Array<{ behavior: string }>) =>
  providers.forEach((p) => (p.behavior = 'SILENT'));

describe('chaîne d’envoi des codes', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('1. AUTO : WhatsApp confirme, aucun SMS, plus rien en mémoire ni minuterie', async () => {
    const { wa, sp, sf, rec, chain } = build();
    await chain.send('+221700000001', CODE, 'AUTO', undefined, challenge(1));
    await jest.advanceTimersByTimeAsync(40_000);
    expect(wa.sent()).toHaveLength(1);
    expect(sp.sent()).toHaveLength(0);
    expect(sf.sent()).toHaveLength(0);
    expect(rec.of('confirm')).toHaveLength(1);
    expect(chain.inFlightCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('2. WhatsApp muet : SMS principal à 10 000 ms (NFR-001), repli à +20 000 ms', async () => {
    const { wa, sp, sf, chain } = build();
    silence(wa, sp, sf);
    await chain.send('+221700000002', CODE, 'AUTO', undefined, challenge(2));
    await jest.advanceTimersByTimeAsync(9_999);
    expect(sp.sent()).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1); // t = 10 000 (borne NFR-001 : 11 000)
    expect(sp.sent()).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(19_999);
    expect(sf.sent()).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1); // t = 30 000, soit +20 000 (borne +21 000)
    expect(sf.sent()).toHaveLength(1);
    expect(chain.inFlightCount()).toBe(0);
  });

  it('3. numéro sans WhatsApp : SMS principal sans attendre', async () => {
    const { wa, sp, rec, chain } = build();
    wa.behavior = 'NO_WHATSAPP';
    silence(sp);
    await chain.send('+221700000003', CODE, 'AUTO', undefined, challenge(3));
    expect(sp.sent()).toHaveLength(1);
    expect(rec.of('fail').map((c) => c.args[1])).toEqual(['NO_WHATSAPP']);
  });

  it('4. canal SMS : WhatsApp jamais appelé, aucun essai WhatsApp noté', async () => {
    const { wa, sp, rec, chain } = build();
    await chain.send('+221700000004', CODE, 'SMS', undefined, challenge(4));
    expect(wa.sent()).toHaveLength(0);
    expect(sp.sent()).toHaveLength(1);
    expect(rec.of('start').map((c) => c.args[1])).toEqual(['SMS_PRIMARY']);
  });

  it('5. le même code part aux trois étapes, un seul défi, le lien du titulaire suit', async () => {
    const { wa, sp, sf, rec, chain } = build();
    silence(wa, sp, sf);
    const link = { refundRequestId: 'r1', otpRequestId: 'otp_x' };
    await chain.send('+221700000005', CODE, 'AUTO', link, challenge(5));
    await jest.advanceTimersByTimeAsync(30_000);
    expect([wa, sp, sf].map((p) => p.sent()[0]!.code)).toEqual([CODE, CODE, CODE]);
    expect([wa, sp, sf].map((p) => p.sent()[0]!.link)).toEqual([link, link, link]);
    expect(
      new Set(rec.of('start').map((c) => (c.args[0] as { challengeId: string }).challengeId)).size,
    ).toBe(1);
    expect(rec.of('start').map((c) => c.args[1])).toEqual([
      'WHATSAPP',
      'SMS_PRIMARY',
      'SMS_FALLBACK',
    ]);
  });

  it('6. accusé tardif d’une étape passée : confirmation notée, aucun envoi de plus', async () => {
    const { wa, sp, sf, rec, chain } = build();
    silence(wa, sp, sf);
    const spy = jest.spyOn(wa, 'send');
    await chain.send('+221700000006', CODE, 'AUTO', undefined, challenge(6));
    await jest.advanceTimersByTimeAsync(30_000);
    const { deliveryRef } = await spy.mock.results[0]!.value;
    wa.confirm(deliveryRef);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(rec.of('confirm').map((c) => c.args[0])).toEqual(['attempt-1']);
    expect([wa, sp, sf].map((p) => p.sent().length)).toEqual([1, 1, 1]);
  });

  it('6b. accusé de l’étape courante : la chaîne s’arrête et le code est effacé', async () => {
    const { wa, sp, sf, chain } = build();
    silence(wa, sp, sf);
    const spy = jest.spyOn(sp, 'send');
    await chain.send('+221700000016', CODE, 'AUTO', undefined, challenge(16));
    await jest.advanceTimersByTimeAsync(10_000);
    const { deliveryRef } = await spy.mock.results[0]!.value;
    sp.confirm(deliveryRef);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(sf.sent()).toHaveLength(0);
    expect(chain.inFlightCount()).toBe(0);
  });

  it('7. tous échouent : `send` n’échoue pas, plus rien en mémoire', async () => {
    const { wa, sp, sf, rec, chain } = build();
    wa.behavior = 'THROWS';
    sp.behavior = 'REFUSES';
    sf.behavior = 'THROWS';
    await expect(
      chain.send('+221700000007', CODE, 'AUTO', undefined, challenge(7)),
    ).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(0);
    expect(chain.inFlightCount()).toBe(0);
    expect(rec.of('fail').map((c) => c.args[1])).toEqual(['ERROR', 'REFUSED', 'ERROR']);
    expect(jest.getTimerCount()).toBe(0);
  });

  describe('8. mémoire bornée', () => {
    it('revient à 0 après confirmation, fin de chaîne et close()', async () => {
      const { wa, sp, sf, chain } = build();
      await chain.send('+221700000008', CODE, 'AUTO', undefined, challenge(8));
      await jest.advanceTimersByTimeAsync(0);
      expect(chain.inFlightCount()).toBe(0); // confirmation
      silence(wa, sp, sf);
      await chain.send('+221700000009', CODE, 'AUTO', undefined, challenge(9));
      expect(chain.inFlightCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(30_000);
      expect(chain.inFlightCount()).toBe(0); // fin de chaîne
      await chain.send('+221700000010', CODE, 'AUTO', undefined, challenge(10));
      await chain.send('+221700000011', CODE, 'AUTO', undefined, challenge(11));
      expect(chain.inFlightCount()).toBe(2);
      chain.close();
      expect(chain.inFlightCount()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
      await expect(chain.send('+221700000012', CODE, 'AUTO')).rejects.toThrow();
    });

    it('borne de 1 000 : la 1 001e efface la plus ancienne, qui ne se déclenche plus', async () => {
      const { wa, sp, sf, chain } = build();
      silence(wa, sp, sf);
      for (let i = 0; i <= OTP_CHAIN_MAX_ENTRIES; i++)
        await chain.send(
          `+22170${String(i).padStart(7, '0')}`,
          CODE,
          'AUTO',
          undefined,
          challenge(i),
        );
      expect(chain.inFlightCount()).toBe(OTP_CHAIN_MAX_ENTRIES);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(sp.sent()).toHaveLength(OTP_CHAIN_MAX_ENTRIES);
      expect(sp.sent().some((s) => s.phone === '+221700000000')).toBe(false);
      chain.close();
    });

    it('plafond dur : un fournisseur qui ne répond jamais n’y garde pas le code', async () => {
      const { wa, sp, chain } = build({ wa: 15_000, sp: 20_000 });
      for (const p of [wa, sp])
        jest.spyOn(p, 'send').mockImplementation(() => new Promise(() => undefined));
      await Promise.race([
        chain.send('+221700000013', CODE, 'AUTO', undefined, challenge(13)),
        jest.advanceTimersByTimeAsync(0),
      ]);
      expect(chain.inFlightCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(OTP_CODE_HARD_CAP_MS);
      expect(chain.inFlightCount()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('plafond dur seul : envois lents, l’étape suivante tomberait après 35 s, le code est effacé', async () => {
      const { wa, sp, sf, chain } = build({ wa: 15_000, sp: 20_000 });
      const slow = (ms: number) => () =>
        new Promise<{ accepted: true }>((resolve) =>
          setTimeout(() => resolve({ accepted: true }), ms),
        );
      jest.spyOn(wa, 'send').mockImplementation(slow(14_000)); // accepté à 14 s, sans accusé
      jest.spyOn(sp, 'send').mockImplementation(slow(5_000)); // lancé à 29 s, accepté à 34 s
      const sfSend = jest.spyOn(sf, 'send');
      const sent = chain.send('+221700000016', CODE, 'AUTO', undefined, challenge(16));
      await jest.advanceTimersByTimeAsync(14_000);
      await sent;
      await jest.advanceTimersByTimeAsync(20_999); // t = 34 999 : repli dû à 54 s, code encore là
      expect(chain.inFlightCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(1); // t = 35 000 : seul le plafond efface
      expect(chain.inFlightCount()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(sfSend).not.toHaveBeenCalled(); // code injoignable : la chaîne s'arrête sans repli
    });

    it('deux demandes du même défi : la seconde remplace la première, qui ne se déclenche plus', async () => {
      const { wa, sp, chain } = build();
      silence(wa, sp);
      await chain.send('+221700000014', '111111', 'AUTO', undefined, challenge(14));
      await chain.send('+221700000014', '222222', 'AUTO', undefined, challenge(14));
      expect(chain.inFlightCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(sp.sent().map((s) => s.code)).toEqual(['222222']);
      chain.close();
    });

    it('code du titulaire et connexion du même numéro : deux défis, deux entrées', async () => {
      const { wa, sp, chain } = build();
      silence(wa, sp);
      const link = { refundRequestId: 'r', otpRequestId: 'otp_y' };
      await chain.send('+221700000015', '111111', 'AUTO', link, challenge(15));
      await chain.send('+221700000015', '222222', 'AUTO', undefined, challenge(115));
      expect(chain.inFlightCount()).toBe(2);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(
        sp
          .sent()
          .map((s) => s.code)
          .sort(),
      ).toEqual(['111111', '222222']);
      chain.close();
    });
  });

  it('9. l’enregistreur ne reçoit jamais le code ni le numéro', async () => {
    const { wa, sp, sf, rec, chain } = build();
    silence(wa, sp, sf);
    await chain.send('+221700000017', CODE, 'AUTO', undefined, challenge(17));
    await jest.advanceTimersByTimeAsync(30_000);
    const text = JSON.stringify(rec.calls);
    expect(text).not.toContain(CODE);
    expect(text).not.toContain('+221700000017');
    expect(rec.calls.length).toBeGreaterThan(0);
  });

  it('10. une erreur de fournisseur qui contient le code : aucune sortie ne le porte', async () => {
    const { wa, sp, sf, rec, chain } = build();
    for (const p of [wa, sp, sf])
      jest.spyOn(p, 'send').mockRejectedValue(new Error(`échec pour le code ${CODE}`));
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await chain.send('+221700000018', CODE, 'AUTO', undefined, challenge(18));
      await jest.advanceTimersByTimeAsync(30_000);
      const seen = JSON.stringify(
        [out, err, log, warn, error].map((spy) => spy.mock.calls).concat([rec.calls as never]),
      );
      expect(seen).not.toContain(CODE);
      expect(rec.of('fail').map((c) => c.args[1])).toEqual(['ERROR', 'ERROR', 'ERROR']);
    } finally {
      for (const spy of [out, err, log, warn, error]) spy.mockRestore();
    }
  });

  describe('11. production : les trois faux refusent le démarrage', () => {
    const PRODUCTION = { production: true };
    const only = (token: symbol, provider: object) => ({
      get: (wanted: unknown) => {
        if (wanted === token) return provider;
        if (wanted === APP_CONFIG) return { production: true };
        throw new Error('absent');
      },
    });
    it.each<[string, (c: { production: boolean }) => OtpProvider, symbol, OtpProvider]>([
      [
        'l’envoi des codes par WhatsApp',
        createWhatsAppProvider,
        OTP_WHATSAPP_PROVIDER,
        new FakeWhatsAppProvider(),
      ],
      [
        'l’envoi des codes par SMS (principal)',
        createSmsPrimaryProvider,
        OTP_SMS_PRIMARY_PROVIDER,
        new FakeSmsPrimaryProvider(),
      ],
      [
        'l’envoi des codes par SMS (repli)',
        createSmsFallbackProvider,
        OTP_SMS_FALLBACK_PROVIDER,
        new FakeSmsFallbackProvider(),
      ],
    ])('%s', (label, create, token, fake) => {
      let thrown: unknown;
      try {
        create(PRODUCTION);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(FakeInProductionError);
      expect((thrown as FakeInProductionError).names).toEqual([label]);
      let refused: unknown;
      try {
        assertProcessIsSafe(only(token, fake) as never);
      } catch (error) {
        refused = error;
      }
      expect(refused).toBeInstanceOf(FakeInProductionError);
      expect((refused as FakeInProductionError).names).toEqual([label]);
      expect(() => assertProcessIsSafe(only(token, { name: 'reel' }) as never)).not.toThrow();
    });
  });
});
