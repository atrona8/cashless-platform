// Clé `<serial>:<seq>` d'une route de terminal seul et refus non définitifs (mission 5b, lot WP08,
// T035 ; A14 ; contracts/payments.md, « Clé et registre des numéros »). Sans base : registre des
// clés simulé, intercepteur réel.
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { ModuleRef, Reflector } from '@nestjs/core';
import { lastValueFrom, throwError } from 'rxjs';
import { loadConfig } from '../../../src/config/config';
import type { DeviceContext } from '../../../src/device-identity/device-identity.port';
import { ProblemException } from '../../../src/errors/problem';
import {
  deviceScope,
  NON_FINAL_CODES,
  parseDeviceKey,
  requestDeviceSeq,
} from '../../../src/idempotency/device-key';
import { IdempotencyInterceptor } from '../../../src/idempotency/idempotency.interceptor';
import type { IdempotencyRepository } from '../../../src/idempotency/idempotency.repository';
import type { IdempotentOptions } from '../../../src/idempotency/idempotent.decorator';

const OPERATOR = '00000000-0000-0000-0000-00000000a001';
const DEVICE: DeviceContext = {
  deviceId: '00000000-0000-0000-0000-00000000d001',
  operatorId: OPERATOR,
  eventId: '00000000-0000-0000-0000-00000000e001',
  posId: null,
  agreementPublicKey: null,
  serial: 'SN-TEST-0001',
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof ProblemException ? `${error.status} ${error.code}` : String(error);
  }
  return 'aucune erreur';
}

describe('parseDeviceKey (A14)', () => {
  it('clé du terminal : seq rendu en bigint', () => {
    expect(parseDeviceKey('SN-TEST-0001:0001', DEVICE)).toBe(1n);
    expect(parseDeviceKey('SN-TEST-0001:9223372036854775807', DEVICE)).toBe(9223372036854775807n);
  });

  it('seq au-delà de 2^63 − 1 (borne du registre) → 422, jamais un 500 de la base (WP08, constat 3)', () => {
    expect(() => parseDeviceKey('SN-TEST-0001:9223372036854775808', DEVICE)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', status: 422 }),
    );
    expect(() => parseDeviceKey('SN-TEST-0001:123456789012345678901', DEVICE)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', status: 422 }),
    );
  });

  it('un « : » dans le numéro de série : le dernier sépare seq', () => {
    expect(parseDeviceKey('AB:CD:0042', { ...DEVICE, serial: 'AB:CD' })).toBe(42n);
  });

  it.each([
    ['autre numéro de série', 'SN-AUTRE:0001'],
    ['numéro de série préfixe', 'SN-TEST-000:10001'],
    ['seq de 3 chiffres', 'SN-TEST-0001:001'],
    ['seq non numérique', 'SN-TEST-0001:00a1'],
    ['seq négatif', 'SN-TEST-0001:-0001'],
    ['sans seq', 'SN-TEST-0001'],
    ['UUID', '6f1c2a9e-3b4f-4c5d-8e6f-0a1b2c3d4e5f'],
    ['serial vide', ':0001'],
  ])('%s → 422 VALIDATION_FAILED', (_name, key) => {
    expect(codeOf(() => parseDeviceKey(key, DEVICE))).toBe('422 VALIDATION_FAILED');
  });

  it('terminal sans numéro de série lu (processus des clés, contexte à la main) → 422', () => {
    const { serial: _s, ...withoutSerial } = DEVICE;
    expect(codeOf(() => parseDeviceKey('SN-TEST-0001:0001', withoutSerial))).toBe(
      '422 VALIDATION_FAILED',
    );
  });

  it('portée : celle du terminal posé par la garde (même forme que counterScope)', () => {
    expect(deviceScope({ device: DEVICE } as never)).toBe(`device:${DEVICE.deviceId}:`);
    expect(codeOf(() => deviceScope({} as never))).toBe('401 UNAUTHENTICATED');
  });

  it('liste fermée des refus non définitifs', () => {
    expect([...NON_FINAL_CODES].sort()).toEqual(['DEBIT_AUTHORITY_EDGE', 'DEBIT_AUTHORITY_MOVING']);
  });
});

/** Intercepteur réel, registre simulé ; `error` : ce que la route lève. */
function harness(options: IdempotentOptions, key: string, error?: unknown, withDevice = true) {
  const repository = {
    reserve: jest.fn(async () => ({
      kind: 'execute' as const,
      reservation: { id: 'r1', operatorId: OPERATOR, leaseToken: 't' },
    })),
    release: jest.fn(async () => undefined),
    completeAlone: jest.fn(async () => undefined),
    transaction: jest.fn(),
  };
  const reflector = { get: () => options } as unknown as Reflector;
  const moduleRef = {
    get: () => ({ current: () => ({ operatorId: OPERATOR }) }),
  } as unknown as ModuleRef;
  const interceptor = new IdempotencyInterceptor(
    reflector,
    moduleRef,
    repository as unknown as IdempotencyRepository,
    loadConfig({ NODE_ENV: 'test' }),
  );
  const headers: Record<string, string> = { 'idempotency-key': key };
  const req: Record<string, unknown> = {
    method: 'POST',
    baseUrl: '',
    path: '/payments',
    body: {},
    ...(withDevice ? { device: DEVICE } : {}),
    header: (name: string) => headers[name.toLowerCase()],
  };
  const res = {
    statusCode: 200,
    status: jest.fn(),
    setHeader: jest.fn(),
    getHeader: () => undefined,
  };
  const context = {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => throwError(() => error) };
  const run = async () => lastValueFrom(await interceptor.intercept(context, next));
  return { repository, req, res, run };
}

describe('intercepteur : route de terminal `deviceSeq` (A14)', () => {
  const OPTIONS: IdempotentOptions = { scope: deviceScope, deviceSeq: true };

  it('autre numéro de série → 422 avant la réservation : rien d’écrit', async () => {
    const { repository, run } = harness(OPTIONS, 'SN-AUTRE:0001', new Error('non atteint'));
    await expect(run()).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect(repository.reserve).not.toHaveBeenCalled();
    expect(repository.completeAlone).not.toHaveBeenCalled();
  });

  it('seq de moins de 4 chiffres → 422 avant la réservation', async () => {
    const { repository, run } = harness(OPTIONS, 'SN-TEST-0001:12', new Error('non atteint'));
    await expect(run()).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect(repository.reserve).not.toHaveBeenCalled();
  });

  it('clé juste : seq posé pour le contrôleur, portée du terminal', async () => {
    const { repository, req, run } = harness(
      OPTIONS,
      'SN-TEST-0001:0042',
      new ProblemException('VALIDATION_FAILED', { status: 422 }),
    );
    await run();
    expect(requestDeviceSeq(req as never)).toBe(42n);
    expect(repository.reserve).toHaveBeenCalledWith(
      OPERATOR,
      `device:${DEVICE.deviceId}:`,
      'SN-TEST-0001:0042',
      expect.any(String),
    );
  });

  it('route sans `deviceSeq` : une clé UUID reste admise, seq non posé', async () => {
    const { repository, req, run } = harness(
      { scope: deviceScope },
      '6f1c2a9e-3b4f-4c5d-8e6f-0a1b2c3d4e5f',
      new ProblemException('VALIDATION_FAILED', { status: 422 }),
    );
    await run();
    expect(repository.reserve).toHaveBeenCalled();
    expect(() => requestDeviceSeq(req as never)).toThrow(/non marquée deviceSeq/);
  });

  it('route `deviceSeq: true` appelée sans terminal : refusée par sa garde (401), rien d’écrit', async () => {
    const { repository, run } = harness(
      OPTIONS,
      '6f1c2a9e-3b4f-4c5d-8e6f-0a1b2c3d4e5f',
      new Error('non atteint'),
      false,
    );
    await expect(run()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(repository.reserve).not.toHaveBeenCalled();
  });

  describe('route partagée terminal ou personne (`when-device` + `without-device`)', () => {
    const SHARED: IdempotentOptions = {
      scope: () => 'bo:',
      deviceSeq: 'when-device',
      keyUuid: 'without-device',
    };
    const UUID = '6f1c2a9e-3b4f-4c5d-8e6f-0a1b2c3d4e5f';
    const refused = new ProblemException('VALIDATION_FAILED', { status: 422 });

    it('personne : clé non UUID → 422 avant la réservation', async () => {
      const { repository, run } = harness(SHARED, 'pas-un-uuid', new Error('non atteint'), false);
      await expect(run()).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
      expect(repository.reserve).not.toHaveBeenCalled();
    });

    it('personne : clé UUID admise, seq non posé', async () => {
      const { repository, req, run } = harness(SHARED, UUID, refused, false);
      await run();
      expect(repository.reserve).toHaveBeenCalled();
      expect(() => requestDeviceSeq(req as never)).toThrow(/non marquée deviceSeq/);
    });

    it('terminal : la clé UUID est refusée (clé <serial>:<seq> exigée), la bonne clé passe', async () => {
      const bad = harness(SHARED, UUID, new Error('non atteint'));
      await expect(bad.run()).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
      expect(bad.repository.reserve).not.toHaveBeenCalled();
      const good = harness(SHARED, 'SN-TEST-0001:0007', refused);
      await good.run();
      expect(requestDeviceSeq(good.req as never)).toBe(7n);
    });
  });

  it.each(['DEBIT_AUTHORITY_MOVING', 'DEBIT_AUTHORITY_EDGE'] as const)(
    '409 %s (non définitif) : clé relâchée, rien d’enregistré, erreur relancée telle quelle',
    async (code) => {
      const error = new ProblemException(code);
      expect(error.status).toBe(409);
      const { repository, run } = harness(OPTIONS, 'SN-TEST-0001:0001', error);
      await expect(run()).rejects.toBe(error);
      expect(repository.release).toHaveBeenCalledTimes(1);
      expect(repository.completeAlone).not.toHaveBeenCalled();
    },
  );

  it('un autre 409 (définitif) reste enregistré et n’est pas relâché', async () => {
    const { repository, res, run } = harness(
      OPTIONS,
      'SN-TEST-0001:0001',
      new ProblemException('ALREADY_REVERSED'),
    );
    await run();
    expect(repository.release).not.toHaveBeenCalled();
    expect(repository.completeAlone).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('5xx : clé relâchée (comportement inchangé)', async () => {
    const { repository, run } = harness(OPTIONS, 'SN-TEST-0001:0001', new Error('panne'));
    await expect(run()).rejects.toThrow('panne');
    expect(repository.release).toHaveBeenCalledTimes(1);
    expect(repository.completeAlone).not.toHaveBeenCalled();
  });

  it('refus non définitif levé par la base (CL006) : relâché aussi', async () => {
    const { repository, run } = harness(OPTIONS, 'SN-TEST-0001:0001', {
      code: 'CL006',
      message: 'bord',
    });
    await expect(run()).rejects.toMatchObject({ code: 'CL006' });
    expect(repository.release).toHaveBeenCalledTimes(1);
    expect(repository.completeAlone).not.toHaveBeenCalled();
  });
});
