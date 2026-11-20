// Rejeu d'un appel signé vers le processus `vendor-pin` (mission 11a, lot WP07 ; décision du porteur
// du 19/11/2026) : une signature n'est acceptée qu'une fois (cache borné, échec sûr s'il est plein) ;
// un appel qui porte un corps sans `rawBody` est refusé. Le processus est le vrai (route `hash`,
// sans effet sur la base) ; la garde est aussi exercée seule pour les cas sans `rawBody` et le cache plein.
import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import {
  PIN_CALL_WINDOW_MS,
  PIN_SIG_HEADER,
  PIN_TS_HEADER,
  signCall,
} from '../../../src/vendor-pin/vendor-pin-call-signature';
import {
  REPLAY_CACHE_MAX,
  REPLAY_TTL_MS,
  VendorPinCallGuard,
} from '../../../src/vendor-pin/vendor-pin-call.guard';
import { call, createPinWorld, HASH_PATH, type PinWorld } from '../vendor-pin/vendor-pin-fixtures';

jest.setTimeout(120_000);

const KEY = Buffer.alloc(32, 0x3c);

interface FakeReq {
  method: string;
  originalUrl: string;
  headers: Record<string, string>;
  rawBody?: Buffer;
  body?: unknown;
}

/**
 * Contexte d'exécution minimal d'une requête signée par `signCall`. Sans `rawBody`, la signature porte
 * sur un corps VIDE alors que la requête annonce un corps : c'est le cas que la garde refuse.
 */
function context(options: { body: string; ts: number; withRaw: boolean; nonce?: number }): {
  ctx: ExecutionContext;
} {
  const raw = Buffer.from(options.body, 'utf8');
  const req: FakeReq = {
    method: 'POST',
    originalUrl: HASH_PATH,
    headers: {
      [PIN_TS_HEADER]: String(options.ts),
      [PIN_SIG_HEADER]: signCall(
        KEY,
        options.ts,
        'POST',
        HASH_PATH,
        options.withRaw ? raw : Buffer.alloc(0),
      ),
      ...(raw.length > 0 ? { 'content-length': String(raw.length) } : {}),
    },
    ...(options.withRaw ? { rawBody: raw } : {}),
    body: raw.length > 0 ? JSON.parse(options.body) : {},
  };
  return {
    ctx: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext,
  };
}

const refused = (guard: VendorPinCallGuard, ctx: ExecutionContext): boolean => {
  try {
    return !guard.canActivate(ctx);
  } catch (error) {
    return (error as { code?: string }).code === 'UNAUTHENTICATED';
  }
};

describe('Rejeu d’un appel signé vers vendor-pin', () => {
  let world: PinWorld;
  beforeAll(async () => {
    world = await createPinWorld();
  });
  afterAll(async () => {
    await world?.close();
  });

  it('le même appel envoyé deux fois : le premier passe, le second reçoit 401 (comme une fausse signature)', async () => {
    const ts = Date.now();
    const body = { pin: '123456' };
    const first = await call(world, body, { path: HASH_PATH, ts });
    expect(first.status).toBe(200);
    const replay = await call(world, body, { path: HASH_PATH, ts });
    expect(replay.status).toBe(401);
    const forged = await call(world, body, { path: HASH_PATH, ts, sig: 'a'.repeat(64) });
    const strip = (b: Record<string, unknown>) => {
      const { request_id: _r, instance: _i, ...rest } = b;
      return rest;
    };
    expect(strip(replay.body as Record<string, unknown>)).toEqual(
      strip(forged.body as Record<string, unknown>),
    );
    expect(replay.text).not.toContain('123456');
  });

  it('deux appels distincts dans la même milliseconde : les deux passent', async () => {
    const ts = Date.now();
    const [a, b] = await Promise.all([
      call(world, { pin: '111111' }, { path: HASH_PATH, ts }),
      call(world, { pin: '222222' }, { path: HASH_PATH, ts }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it('un appel refusé pour une autre raison n’occupe pas le cache : il reste rejouable une fois corrigé', async () => {
    const ts = Date.now() - 31_000;
    expect((await call(world, { pin: '333333' }, { path: HASH_PATH, ts })).status).toBe(401);
    expect((await call(world, { pin: '333333' }, { path: HASH_PATH })).status).toBe(200);
  });

  describe('garde seule', () => {
    it('corps annoncé sans rawBody → 401 ; sans corps ni rawBody → passe ; avec rawBody → passe', () => {
      const guard = new VendorPinCallGuard(KEY);
      const now = Date.now();
      expect(
        refused(guard, context({ body: '{"pin":"123456"}', ts: now, withRaw: false }).ctx),
      ).toBe(true);
      expect(
        refused(guard, context({ body: '{"pin":"123456"}', ts: now, withRaw: true }).ctx),
      ).toBe(false);
      expect(refused(guard, context({ body: '', ts: now + 1, withRaw: false }).ctx)).toBe(false);
    });

    // OP-N158 : bornes figées en LITTÉRAL (le test existant ci-dessous n'utilise que la constante, donc
    // ne bougerait pas si la taille était agrandie). Élargir la fenêtre, la durée de garde ou la taille
    // fait échouer ces trois tests ; les élargir est un écart de sécurité à soumettre au porteur.
    it('bornes figées : fenêtre 30 s, garde 70 s, cache 20 000 signatures', () => {
      expect(PIN_CALL_WINDOW_MS).toBe(30_000);
      expect(REPLAY_TTL_MS).toBe(70_000);
      expect(REPLAY_CACHE_MAX).toBe(20_000);
    });

    it('fenêtre : ts à +29 s accepté, à +31 s et à -31 s refusés (jamais élargie)', () => {
      const now = Date.now();
      const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
      try {
        const guard = new VendorPinCallGuard(KEY);
        const at = (ts: number) =>
          refused(guard, context({ body: '{"pin":"123456"}', ts, withRaw: true }).ctx);
        expect(at(now + 29_000)).toBe(false);
        expect(at(now - 29_000)).toBe(false);
        expect(at(now + 31_000)).toBe(true);
        expect(at(now - 31_000)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it('garde : une signature acceptée reste refusée tant que son horodatage reste valide (58 s), puis le ts la refuse', () => {
      const now = Date.now();
      const spy = jest.spyOn(Date, 'now');
      try {
        const guard = new VendorPinCallGuard(KEY);
        const ts = now + 29_000;
        const same = () =>
          refused(guard, context({ body: '{"pin":"123456"}', ts, withRaw: true }).ctx);
        spy.mockReturnValue(now);
        expect(same()).toBe(false);
        // Encore valide par son horodatage (ts - 30 s ≤ t ≤ ts + 30 s) : rejeu refusé par le cache.
        for (const later of [1_000, 30_000, 58_000]) {
          spy.mockReturnValue(now + later);
          expect([later, same()]).toEqual([later, true]);
        }
        // Au-delà de la fenêtre du ts : refus par l'horodatage, jamais par défaut d'un cache vidé.
        spy.mockReturnValue(now + 61_000);
        expect(same()).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it('cache plein : refus (échec sûr), jamais d’acceptation sans contrôle', () => {
      const guard = new VendorPinCallGuard(KEY);
      const now = Date.now();
      for (let i = 0; i < REPLAY_CACHE_MAX; i += 1)
        expect(refused(guard, context({ body: `{"n":${i}}`, ts: now, withRaw: true }).ctx)).toBe(
          false,
        );
      expect(refused(guard, context({ body: '{"n":-1}', ts: now, withRaw: true }).ctx)).toBe(true);
    });
  });
});
