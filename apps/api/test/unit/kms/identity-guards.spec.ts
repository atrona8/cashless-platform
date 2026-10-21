// Gardes d'identité du terminal et du festivalier : l'identité annoncée est toujours revérifiée en base.
import type { ExecutionContext } from '@nestjs/common';
import { CustomerGuard } from '../../../src/customer-identity/customer.guard';
import {
  requestCustomer,
  type CustomerDirectory,
} from '../../../src/customer-identity/customer-identity.port';
import { FakeCustomerIdentity } from '../../../src/customer-identity/fake-customer-identity';
import { DeviceGuard } from '../../../src/device-identity/device.guard';
import {
  requestDevice,
  type DeviceDirectory,
} from '../../../src/device-identity/device-identity.port';
import { FakeDeviceIdentity } from '../../../src/device-identity/fake-device-identity';
import { ProblemException } from '../../../src/errors/problem';

const OPERATOR = '00000000-0000-0000-0000-00000000a001';
const DEVICE = '00000000-0000-0000-0000-00000000d001';
const CUSTOMER = '00000000-0000-0000-0000-00000000c001';

function http(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { header: (name: string) => lower[name.toLowerCase()] } as Record<string, unknown>;
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { req, context };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof ProblemException ? error.code : `autre: ${String(error)}`;
  }
  return 'aucune erreur';
}

describe('garde du terminal', () => {
  const directory = (status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | null): DeviceDirectory => ({
    find: async (operatorId, deviceId) =>
      status === null || operatorId !== OPERATOR || deviceId !== DEVICE
        ? null
        : {
            deviceId,
            operatorId,
            eventId: 'e',
            posId: null,
            agreementPublicKey: Buffer.alloc(65, 4),
            status,
            os: 'ANDROID',
            nfcEnabled: true,
            publicKey: null,
            certSha256: null,
          },
    findForAuthentication: async () => null,
  });
  const guard = (status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | null) =>
    new DeviceGuard(new FakeDeviceIdentity(), directory(status));
  const headers = { 'X-Test-Device-Id': DEVICE, 'X-Test-Operator-Id': OPERATOR };

  it('terminal actif : contexte posé à partir de la base', async () => {
    const { req, context } = http(headers);
    expect(await guard('ACTIVE').canActivate(context)).toBe(true);
    expect(requestDevice(req as never)).toMatchObject({
      deviceId: DEVICE,
      operatorId: OPERATOR,
      eventId: 'e',
    });
  });

  it('aucune identité, ou identité mal formée : 401', async () => {
    expect(await codeOf(guard('ACTIVE').canActivate(http({}).context))).toBe('UNAUTHENTICATED');
    expect(
      await codeOf(
        guard('ACTIVE').canActivate(
          http({ 'X-Test-Device-Id': 'x', 'X-Test-Operator-Id': OPERATOR }).context,
        ),
      ),
    ).toBe('UNAUTHENTICATED');
    expect(
      await codeOf(guard('ACTIVE').canActivate(http({ 'X-Test-Device-Id': DEVICE }).context)),
    ).toBe('UNAUTHENTICATED');
  });

  it('terminal inconnu du prestataire annoncé : 401', async () => {
    expect(await codeOf(guard(null).canActivate(http(headers).context))).toBe('UNAUTHENTICATED');
    const other = {
      'X-Test-Device-Id': DEVICE,
      'X-Test-Operator-Id': '00000000-0000-0000-0000-00000000a002',
    };
    expect(await codeOf(guard('ACTIVE').canActivate(http(other).context))).toBe('UNAUTHENTICATED');
  });

  it('terminal révoqué ou suspendu : refusé', async () => {
    expect(await codeOf(guard('REVOKED').canActivate(http(headers).context))).toBe(
      'DEVICE_REVOKED',
    );
    expect(await codeOf(guard('SUSPENDED').canActivate(http(headers).context))).toBe(
      'DEVICE_SUSPENDED',
    );
  });

  it('sans garde, aucun terminal : 401', () => {
    expect(() => requestDevice(http({}).req as never)).toThrow(ProblemException);
  });
});

describe('garde du festivalier', () => {
  const directory = (known: boolean): CustomerDirectory => ({
    exists: async (operatorId, customerId) =>
      known && operatorId === OPERATOR && customerId === CUSTOMER,
  });
  const guard = (known: boolean) => new CustomerGuard(new FakeCustomerIdentity(), directory(known));
  const headers = {
    'X-Test-Customer-Id': CUSTOMER,
    'X-Test-Operator-Id': OPERATOR,
    'X-Test-Customer-Device': 'app-1',
  };

  it('compte connu : contexte posé, avec la référence de l’appareil', async () => {
    const { req, context } = http(headers);
    expect(await guard(true).canActivate(context)).toBe(true);
    expect(requestCustomer(req as never)).toEqual({
      customerId: CUSTOMER,
      operatorId: OPERATOR,
      deviceRef: 'app-1',
    });
  });

  it('compte inconnu, d’un autre prestataire, ou sans identité : 401', async () => {
    expect(await codeOf(guard(false).canActivate(http(headers).context))).toBe('UNAUTHENTICATED');
    expect(
      await codeOf(
        guard(true).canActivate(
          http({ ...headers, 'X-Test-Operator-Id': '00000000-0000-0000-0000-00000000a002' })
            .context,
        ),
      ),
    ).toBe('UNAUTHENTICATED');
    expect(await codeOf(guard(true).canActivate(http({}).context))).toBe('UNAUTHENTICATED');
    expect(
      await codeOf(
        guard(true).canActivate(
          http({ ...headers, 'X-Test-Customer-Device': 'réf avec espace' }).context,
        ),
      ),
    ).toBe('UNAUTHENTICATED');
  });
});
