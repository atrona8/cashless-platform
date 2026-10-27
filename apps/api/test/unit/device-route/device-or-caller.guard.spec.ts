// Garde exclusive « terminal ou personne / festivalier » (mission 5b, lot WP08, T036 ; A13 ; FR-016,
// FR-025). Un marqueur de terminal (certificat présenté, `Signature`, `Signature-Input`) → chemin
// terminal complet, SANS repli vers la personne ou le festivalier. Sans base : identités simulées.
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type {
  CustomerDirectory,
  CustomerIdentityPort,
} from '../../../src/customer-identity/customer-identity.port';
import type { TenantTx } from '../../../src/db/tenant-tx';
import type {
  DeviceDirectory,
  DeviceIdentityPort,
  DeviceRecord,
} from '../../../src/device-identity/device-identity.port';
import {
  DeviceOrCallerAuth,
  DeviceOrCallerGuard,
  hasDeviceMarker,
  type DeviceOrCallerOptions,
} from '../../../src/device-identity/device-or-caller.guard';
import { ProblemException } from '../../../src/errors/problem';
import type { IdentityVerifier } from '../../../src/identity/oidc-verifier';
import { IS_PUBLIC } from '../../../src/identity/public.decorator';

const OPERATOR = '00000000-0000-0000-0000-00000000a001';
const DEVICE = '00000000-0000-0000-0000-00000000d001';
const CUSTOMER = '00000000-0000-0000-0000-00000000c001';
const PERSON = {
  user_id: '00000000-0000-0000-0000-000000000001',
  operator_id: OPERATOR,
  status: 'ACTIVE',
  assignments: [],
};
/** Ce que le faux terminal exige pour réussir : les trois preuves (simulées par un en-tête). */
const THREE_PROOFS = 'x-three-proofs';

function setup(record: Partial<DeviceRecord> = {}) {
  const deviceIdentity = {
    identify: jest.fn(async (req: { header(n: string): string | undefined }) =>
      req.header(THREE_PROOFS) === '1' ? { deviceId: DEVICE, operatorId: OPERATOR } : null,
    ),
  };
  const deviceDirectory: DeviceDirectory = {
    find: async () => ({
      deviceId: DEVICE,
      operatorId: OPERATOR,
      eventId: 'e',
      posId: null,
      agreementPublicKey: null,
      status: 'ACTIVE',
      os: 'ANDROID',
      nfcEnabled: true,
      publicKey: null,
      certSha256: null,
      serial: 'SN-1',
      ...record,
    }),
    findForAuthentication: async () => null,
  };
  const verifier = {
    verifyAccess: jest.fn(async (token: string) => {
      if (token !== 'personne') throw new Error('jeton refusé');
      return { issuer: 'https://idp.test', subject: 'sub', expiresAt: new Date(Date.now() + 6e4) };
    }),
    verifyApproval: jest.fn(),
  };
  const tx = { identify: jest.fn(async () => PERSON) };
  const customerIdentity = {
    identify: jest.fn(async (req: { header(n: string): string | undefined }) =>
      req.header('authorization') === 'Bearer client'
        ? { customerId: CUSTOMER, operatorId: OPERATOR, deviceRef: 'ref' }
        : null,
    ),
  };
  const customerDirectory: CustomerDirectory = { exists: async () => true };
  const guard = new DeviceOrCallerGuard(
    deviceIdentity as unknown as DeviceIdentityPort,
    deviceDirectory,
    verifier as unknown as IdentityVerifier,
    tx as unknown as TenantTx,
    customerIdentity as unknown as CustomerIdentityPort,
    customerDirectory,
  );

  /** Requête sur une route décorée ; `cert` : certificat client présenté sur la socket TLS. */
  const run = (
    options: DeviceOrCallerOptions | null,
    headers: Record<string, string>,
    cert = false,
  ) => {
    class Controller {
      handler(): void {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(Controller.prototype, 'handler')!;
    if (options) DeviceOrCallerAuth(options)(Controller.prototype, 'handler', descriptor);
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const req: Record<string, unknown> = {
      header: (name: string) => lower[name.toLowerCase()],
      socket: { getPeerX509Certificate: () => (cert ? { subject: 'CN=terminal' } : undefined) },
    };
    const context = {
      getType: () => 'http',
      getHandler: () => descriptor.value as () => void,
      getClass: () => Controller,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { result: guard.canActivate(context), req };
  };
  return { deviceIdentity, verifier, tx, customerIdentity, run };
}

async function outcome(promise: Promise<boolean>): Promise<string> {
  try {
    return (await promise) ? 'admis' : 'refusé (false)';
  } catch (error) {
    return error instanceof ProblemException ? `${error.status} ${error.code}` : String(error);
  }
}

const PERSON_ROUTE: DeviceOrCallerOptions = { other: 'person' };
const CUSTOMER_ROUTE: DeviceOrCallerOptions = { other: 'customer' };

describe('DeviceOrCallerGuard : garde exclusive sans repli (A13)', () => {
  it('certificat seul, sans jeton → 401 (chemin terminal, aucune personne vérifiée)', async () => {
    const { run, verifier, customerIdentity } = setup();
    for (const route of [PERSON_ROUTE, CUSTOMER_ROUTE]) {
      const { result, req } = run(route, {}, true);
      expect(await outcome(result)).toBe('401 UNAUTHENTICATED');
      expect(req.device).toBeUndefined();
    }
    expect(verifier.verifyAccess).not.toHaveBeenCalled();
    expect(customerIdentity.identify).not.toHaveBeenCalled();
  });

  it.each(['Signature', 'Signature-Input'])('en-tête %s seul → 401', async (header) => {
    const { run, verifier } = setup();
    expect(await outcome(run(PERSON_ROUTE, { [header]: 'sig1=:AAAA:' }).result)).toBe(
      '401 UNAUTHENTICATED',
    );
    expect(verifier.verifyAccess).not.toHaveBeenCalled();
  });

  it('jeton de personne valide + certificat → 401 : pas de repli vers la personne', async () => {
    const { run, verifier, tx } = setup();
    const { result, req } = run(PERSON_ROUTE, { Authorization: 'Bearer personne' }, true);
    expect(await outcome(result)).toBe('401 UNAUTHENTICATED');
    expect(verifier.verifyAccess).not.toHaveBeenCalled();
    expect(tx.identify).not.toHaveBeenCalled();
    expect(req.principal).toBeUndefined();
  });

  it('jeton de festivalier valide + signature → 401 : pas de repli vers le festivalier', async () => {
    const { run, customerIdentity } = setup();
    const { result, req } = run(CUSTOMER_ROUTE, {
      Authorization: 'Bearer client',
      Signature: 'sig1=:AAAA:',
    });
    expect(await outcome(result)).toBe('401 UNAUTHENTICATED');
    expect(customerIdentity.identify).not.toHaveBeenCalled();
    expect(req.customer).toBeUndefined();
  });

  it('marqueur vide (en-tête présent sans valeur) : chemin terminal quand même', async () => {
    const { run, verifier } = setup();
    expect(
      await outcome(run(PERSON_ROUTE, { Signature: '', Authorization: 'Bearer personne' }).result),
    ).toBe('401 UNAUTHENTICATED');
    expect(verifier.verifyAccess).not.toHaveBeenCalled();
  });

  it('terminal complet (trois preuves) → req.device posé, aucune personne', async () => {
    const { run, verifier } = setup();
    const { result, req } = run(
      PERSON_ROUTE,
      { [THREE_PROOFS]: '1', Signature: 'sig1=:AAAA:', Authorization: 'Bearer personne' },
      true,
    );
    expect(await outcome(result)).toBe('admis');
    expect(req.device).toMatchObject({ deviceId: DEVICE, operatorId: OPERATOR, serial: 'SN-1' });
    expect(req.principal).toBeUndefined();
    expect(verifier.verifyAccess).not.toHaveBeenCalled();
  });

  it('chemin terminal : refus de la garde du terminal rendu tel quel (révoqué → 403)', async () => {
    const { run } = setup({ status: 'REVOKED' });
    expect(await outcome(run(PERSON_ROUTE, { [THREE_PROOFS]: '1' }, true).result)).toBe(
      '403 DEVICE_REVOKED',
    );
  });

  it('options du terminal transmises (allowSuspended)', async () => {
    const { run } = setup({ status: 'SUSPENDED' });
    expect(await outcome(run(PERSON_ROUTE, { [THREE_PROOFS]: '1' }, true).result)).toBe(
      '403 DEVICE_SUSPENDED',
    );
    expect(
      await outcome(
        run({ other: 'person', device: { allowSuspended: true } }, { [THREE_PROOFS]: '1' }, true)
          .result,
      ),
    ).toBe('admis');
  });

  it('personne sans marqueur → principal posé', async () => {
    const { run } = setup();
    const { result, req } = run(PERSON_ROUTE, { Authorization: 'Bearer personne' });
    expect(await outcome(result)).toBe('admis');
    expect(req.principal).toMatchObject({ operatorId: OPERATOR });
    expect(req.device).toBeUndefined();
  });

  it('route « personne » sans marqueur ni jeton → 401 malgré @Public()', async () => {
    const { run } = setup();
    expect(await outcome(run(PERSON_ROUTE, {}).result)).toBe('401 UNAUTHENTICATED');
    expect(await outcome(run(PERSON_ROUTE, { Authorization: 'Bearer client' }).result)).toBe(
      '401 UNAUTHENTICATED',
    );
  });

  it('festivalier sans marqueur → client posé ; route « festivalier » sans jeton → 401', async () => {
    const { run, verifier } = setup();
    const { result, req } = run(CUSTOMER_ROUTE, { Authorization: 'Bearer client' });
    expect(await outcome(result)).toBe('admis');
    expect(req.customer).toMatchObject({ customerId: CUSTOMER });
    expect(await outcome(run(CUSTOMER_ROUTE, { Authorization: 'Bearer personne' }).result)).toBe(
      '401 UNAUTHENTICATED',
    );
    expect(verifier.verifyAccess).not.toHaveBeenCalled();
  });

  it('X-Staff-Authorization → 401 (pas une route de guichet), avec ou sans marqueur', async () => {
    const { run, verifier, deviceIdentity } = setup();
    const staff = { 'X-Staff-Authorization': 'Bearer personne' };
    expect(await outcome(run(PERSON_ROUTE, staff).result)).toBe('401 UNAUTHENTICATED');
    expect(await outcome(run(PERSON_ROUTE, { ...staff, [THREE_PROOFS]: '1' }, true).result)).toBe(
      '401 UNAUTHENTICATED',
    );
    expect(verifier.verifyAccess).not.toHaveBeenCalled();
    expect(deviceIdentity.identify).not.toHaveBeenCalled();
  });

  it('route mal déclarée (sans options) → 401, jamais un appelant par défaut', async () => {
    const { run } = setup();
    expect(await outcome(run(null, { Authorization: 'Bearer personne' }).result)).toBe(
      '401 UNAUTHENTICATED',
    );
  });
});

describe('DeviceOrCallerAuth et marqueurs', () => {
  it('décorateur : route publique pour la garde globale, garde exclusive posée', () => {
    class C {
      @DeviceOrCallerAuth({ other: 'person' })
      handler(): void {}
    }
    const handler = Object.getOwnPropertyDescriptor(C.prototype, 'handler')!.value as object;
    expect(Reflect.getMetadata(IS_PUBLIC, handler)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([DeviceOrCallerGuard]);
  });

  it('marqueurs : certificat présenté, Signature, Signature-Input ; rien d’autre', () => {
    const req = (headers: Record<string, string>, socket?: unknown) =>
      ({ header: (n: string) => headers[n.toLowerCase()], socket }) as never;
    expect(hasDeviceMarker(req({}))).toBe(false);
    expect(hasDeviceMarker(req({}, {}))).toBe(false);
    expect(hasDeviceMarker(req({}, { getPeerX509Certificate: () => undefined }))).toBe(false);
    expect(hasDeviceMarker(req({}, { getPeerX509Certificate: () => ({}) }))).toBe(true);
    expect(hasDeviceMarker(req({ signature: 'x' }))).toBe(true);
    expect(hasDeviceMarker(req({ 'signature-input': 'x' }))).toBe(true);
    expect(hasDeviceMarker(req({ authorization: 'Bearer x', 'x-test-device-id': DEVICE }))).toBe(
      false,
    );
  });
});
