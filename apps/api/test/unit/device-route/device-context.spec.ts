// Contexte du terminal enrichi (mission 5b, lot WP08, T034) : l'API publique lit `serial`, mode,
// téléphone personnel, commerçant et participation par `DEVICE_DETAILS_QUERY` ; le processus des
// clés garde la requête étroite `DEVICE_QUERY` (son rôle `cashless_tagkeys` n'a pas ces colonnes,
// post-roles.sql §2a, et ne doit pas les recevoir). Sans base : transaction simulée.
import type { ExecutionContext } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import type { TenantTx } from '../../../src/db/tenant-tx';
import {
  DEVICE_DETAILS_QUERY,
  DEVICE_QUERY,
  DeviceIdentityModule,
  PublicDeviceDirectory,
  PublicDeviceIdentityModule,
  TenantDeviceDirectory,
} from '../../../src/device-identity/device-identity.module';
import {
  assertDeviceMode,
  DEVICE_DIRECTORY,
  requestDevice,
  type DeviceContext,
  type DeviceDirectory,
  type DeviceRecord,
} from '../../../src/device-identity/device-identity.port';
import { DeviceGuard } from '../../../src/device-identity/device.guard';
import { FakeDeviceIdentity } from '../../../src/device-identity/fake-device-identity';
import { ProblemException } from '../../../src/errors/problem';
import { TagKeysProcessModule } from '../../../src/processes/tag-keys.module';
import { AppModule } from '../../../src/app.module';

const OPERATOR = '00000000-0000-0000-0000-00000000a001';
const DEVICE = '00000000-0000-0000-0000-00000000d001';
const FAMILY = '00000000-0000-0000-0000-00000000f001';

const NARROW_ROW = {
  id: DEVICE,
  operator_id: OPERATOR,
  event_id: 'e',
  pos_id: 'p',
  status: 'ACTIVE',
  agreement_public_key: null,
  public_key: null,
  cert_sha256: null,
  os: 'ANDROID',
  nfc_enabled: true,
};
const DETAILS_ROW = {
  ...NARROW_ROW,
  serial: 'SN-1',
  app_mode: 'CATALOG_POS',
  personal_phone: false,
  participation_id: 'mp-1',
  merchant_id: 'm-1',
};

/** Transaction simulée : journal des requêtes, une ligne rendue selon la requête. */
function fakeTx() {
  const queries: string[] = [];
  const tx = {
    run: jest.fn(async (_op: string, fn: (client: unknown) => Promise<unknown>) =>
      fn({
        query: async (sql: string) => {
          queries.push(sql);
          if (sql === DEVICE_DETAILS_QUERY) return { rows: [DETAILS_ROW] };
          if (sql === DEVICE_QUERY) return { rows: [NARROW_ROW] };
          return { rows: [{ active: true }] };
        },
      }),
    ),
  };
  return { tx: tx as unknown as TenantTx, queries };
}

/** Classe fournie pour `DEVICE_DIRECTORY` par un module. */
function directoryClassOf(module: object): unknown {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) as {
    provide?: unknown;
    useClass?: unknown;
  }[];
  return providers.find((p) => p.provide === DEVICE_DIRECTORY)?.useClass;
}

function importsOf(module: object): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) as unknown[];
}

describe('requêtes du terminal (T034)', () => {
  it('DEVICE_QUERY inchangée : les seules colonnes lisibles par cashless_tagkeys', () => {
    expect(DEVICE_QUERY.replace(/\s+/g, ' ')).toBe(
      'SELECT id, operator_id, event_id, pos_id, status, agreement_public_key, public_key, ' +
        'cert_sha256, os, nfc_enabled FROM device WHERE id = $1 AND operator_id = $2',
    );
  });

  it('DEVICE_DETAILS_QUERY : jointures gauches sous le même prestataire', () => {
    const sql = DEVICE_DETAILS_QUERY.replace(/\s+/g, ' ');
    expect(sql).toContain(
      'LEFT JOIN point_of_sale pos ON pos.id = d.pos_id AND pos.operator_id = d.operator_id',
    );
    expect(sql).toContain(
      'LEFT JOIN merchant_participation mp ON mp.id = pos.participation_id AND mp.operator_id = d.operator_id',
    );
    expect(sql).toContain('WHERE d.id = $1 AND d.operator_id = $2');
  });

  it('processus des clés : find et findForAuthentication n’exécutent que la requête étroite', async () => {
    const { tx, queries } = fakeTx();
    const directory = new TenantDeviceDirectory(tx);
    const found = await directory.find(OPERATOR, DEVICE);
    await directory.findForAuthentication(OPERATOR, DEVICE, FAMILY);
    expect(queries).not.toContain(DEVICE_DETAILS_QUERY);
    expect(queries.filter((q) => q === DEVICE_QUERY)).toHaveLength(2);
    expect(found).not.toHaveProperty('serial');
    expect(found).not.toHaveProperty('appMode');
  });

  it('API publique : find lit le contexte enrichi en une requête, les preuves restent étroites', async () => {
    const { tx, queries } = fakeTx();
    const directory = new PublicDeviceDirectory(tx);
    expect(await directory.find(OPERATOR, DEVICE)).toMatchObject({
      deviceId: DEVICE,
      serial: 'SN-1',
      appMode: 'CATALOG_POS',
      personalPhone: false,
      merchantId: 'm-1',
      participationId: 'mp-1',
    });
    expect(queries).toEqual([DEVICE_DETAILS_QUERY]);
    queries.length = 0;
    await directory.findForAuthentication(OPERATOR, DEVICE, FAMILY);
    expect(queries).not.toContain(DEVICE_DETAILS_QUERY);
  });

  it('identifiants mal formés : aucune requête', async () => {
    const { tx, queries } = fakeTx();
    expect(await new PublicDeviceDirectory(tx).find('x', DEVICE)).toBeNull();
    expect(queries).toEqual([]);
  });

  it('câblage : le processus des clés charge le module étroit, l’API publique le module enrichi', () => {
    expect(directoryClassOf(DeviceIdentityModule)).toBe(TenantDeviceDirectory);
    expect(directoryClassOf(PublicDeviceIdentityModule)).toBe(PublicDeviceDirectory);
    expect(importsOf(TagKeysProcessModule)).toContain(DeviceIdentityModule);
    expect(importsOf(TagKeysProcessModule)).not.toContain(PublicDeviceIdentityModule);
    expect(importsOf(AppModule)).toContain(PublicDeviceIdentityModule);
    expect(importsOf(AppModule)).not.toContain(DeviceIdentityModule);
  });
});

describe('DeviceGuard : recopie du contexte enrichi (T034)', () => {
  const base: DeviceRecord = {
    deviceId: DEVICE,
    operatorId: OPERATOR,
    eventId: 'e',
    posId: 'p',
    agreementPublicKey: null,
    status: 'ACTIVE',
    os: 'ANDROID',
    nfcEnabled: true,
    publicKey: null,
    certSha256: null,
  };
  const run = async (record: DeviceRecord) => {
    const directory: DeviceDirectory = {
      find: async () => record,
      findForAuthentication: async () => null,
    };
    const headers: Record<string, string> = {
      'x-test-device-id': DEVICE,
      'x-test-operator-id': OPERATOR,
    };
    const req = { header: (n: string) => headers[n.toLowerCase()] } as Record<string, unknown>;
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    await new DeviceGuard(new FakeDeviceIdentity(), directory).canActivate(context);
    return requestDevice(req as never);
  };

  it('API publique : serial, mode, téléphone personnel, commerçant, participation recopiés', async () => {
    const device = await run({
      ...base,
      serial: 'SN-1',
      appMode: 'KEYPAD_TPE',
      personalPhone: true,
      merchantId: 'm-1',
      participationId: null,
    });
    expect(device).toMatchObject({
      serial: 'SN-1',
      appMode: 'KEYPAD_TPE',
      personalPhone: true,
      merchantId: 'm-1',
      participationId: null,
    });
  });

  it('processus des clés (lecture étroite) : champs absents, pas inventés', async () => {
    const device = await run(base);
    for (const field of ['serial', 'appMode', 'personalPhone', 'merchantId', 'participationId'])
      expect(device).not.toHaveProperty(field);
  });

  it('le mode n’est pas contrôlé par la garde', async () => {
    expect((await run({ ...base, appMode: 'TOPUP_DESK' })).appMode).toBe('TOPUP_DESK');
  });
});

describe('assertDeviceMode', () => {
  const device: DeviceContext = {
    deviceId: DEVICE,
    operatorId: OPERATOR,
    eventId: 'e',
    posId: null,
    agreementPublicKey: null,
  };
  const codeOf = (fn: () => void): string => {
    try {
      fn();
    } catch (error) {
      return error instanceof ProblemException ? `${error.status} ${error.code}` : String(error);
    }
    return 'admis';
  };

  it('mode admis : rien', () => {
    expect(
      codeOf(() => assertDeviceMode({ ...device, appMode: 'CATALOG_POS' }, ['CATALOG_POS'])),
    ).toBe('admis');
  });

  it('autre mode → 422 DEVICE_MODE_NOT_ALLOWED', () => {
    expect(
      codeOf(() =>
        assertDeviceMode({ ...device, appMode: 'TOPUP_DESK' }, ['CATALOG_POS', 'KEYPAD_TPE']),
      ),
    ).toBe('422 DEVICE_MODE_NOT_ALLOWED');
  });

  it('mode non lu (contexte étroit ou construit à la main) → 422, jamais admis par défaut', () => {
    expect(codeOf(() => assertDeviceMode(device, ['CATALOG_POS']))).toBe(
      '422 DEVICE_MODE_NOT_ALLOWED',
    );
  });
});
