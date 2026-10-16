// Les cinq processus (mission bracelets-nfc, research R-01) : chacun démarre avec son rôle de base et ses seuls droits
// sur le service de clés ; aucun ne démarre en production avec un faux (NFR-010).
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CUSTOMER_IDENTITY } from '../../src/customer-identity/customer-identity.port';
import { NO_OPERATOR, TenantTx } from '../../src/db/tenant-tx';
import { DEVICE_IDENTITY } from '../../src/device-identity/device-identity.port';
import { FakeKms } from '../../src/kms/fake-kms';
import { KMS_PROVIDER } from '../../src/kms/kms.module';
import { DATA_KEY_PORT, DECRYPT_PORT, KEY_ADMIN_PORT, MAC_PORT } from '../../src/kms/kms.ports';
import { FakeInProductionError } from '../../src/kms/production-guard';
import { assertProcessIsSafe } from '../../src/processes/bootstrap';
import { KeyAdminProcessModule } from '../../src/processes/key-admin.module';
import { PersonalizationProcessModule } from '../../src/processes/personalization.module';
import { DenyUnmarkedRoutesGuard } from '../../src/processes/process-base';
import { PublicProcessModule } from '../../src/processes/public.module';
import { TagCheckProcessModule } from '../../src/processes/tag-check.module';
import { TagKeysProcessModule } from '../../src/processes/tag-keys.module';
import { WorkerRegistry } from '../../src/processes/worker';
import { createKeyProcess, createTestApp, type KeyProcessName } from '../support/app';
import { FakeIdp } from '../support/fake-idp';

const PORTS = {
  mac: MAC_PORT,
  dataKey: DATA_KEY_PORT,
  decrypt: DECRYPT_PORT,
  keyAdmin: KEY_ADMIN_PORT,
} as const;
const RIGHTS: Record<KeyProcessName, Array<keyof typeof PORTS>> = {
  'tag-keys': ['decrypt'],
  personalization: ['mac', 'dataKey'],
  'tag-check': ['mac', 'decrypt'],
  'key-admin': ['keyAdmin'],
};
const DB_ROLE: Record<KeyProcessName, string> = {
  'tag-keys': 'cashless_tagkeys',
  personalization: 'cashless_perso',
  'tag-check': 'cashless_tagcheck',
  'key-admin': 'cashless_keyadmin',
};

function has(
  app: { get(token: symbol, options: { strict: boolean }): unknown },
  token: symbol,
): boolean {
  try {
    app.get(token, { strict: false });
    return true;
  } catch {
    return false;
  }
}

describe('processus des clés de bracelet', () => {
  let idp: FakeIdp;
  beforeAll(async () => {
    idp = await FakeIdp.create();
  });

  it.each(Object.keys(RIGHTS) as KeyProcessName[])(
    '%s : démarre sous son rôle de base, avec ses seuls droits de clé',
    async (name) => {
      const { app, kms, workers } = await createKeyProcess(
        name,
        name === 'personalization' ? { identity: idp } : {},
      );
      try {
        expect(kms).toBeInstanceOf(FakeKms);
        expect(workers).toBeInstanceOf(WorkerRegistry);
        for (const capability of Object.keys(PORTS) as Array<keyof typeof PORTS>) {
          expect([capability, has(app, PORTS[capability])]).toEqual([
            capability,
            RIGHTS[name].includes(capability),
          ]);
        }
        const tx = app.get(TenantTx, { strict: false });
        const role = await tx.unscoped(
          async (client) =>
            (
              await client.query<{ u: string; o: string }>(
                "SELECT session_user AS u, current_setting('app.operator_id') AS o",
              )
            ).rows[0]!,
        );
        expect(role).toEqual({ u: DB_ROLE[name], o: NO_OPERATOR });
        // Aucun processus des clés ne porte l'identité du festivalier ; seul celui des clés de bracelet porte celle du terminal.
        expect(has(app, CUSTOMER_IDENTITY)).toBe(false);
        expect(has(app, DEVICE_IDENTITY)).toBe(name === 'tag-keys');
      } finally {
        await app.close();
      }
    },
  );

  it('clés de bracelet et personnalisation : santé publique, toute autre route refusée ou inconnue', async () => {
    for (const name of ['tag-keys', 'personalization'] as const) {
      const { app } = await createKeyProcess(
        name,
        name === 'personalization' ? { identity: idp } : {},
      );
      try {
        expect((await request(app.getHttpServer()).get('/v1/health')).body).toEqual({
          status: 'ok',
          db: 'ok',
        });
        // Les routes de l'API publique n'existent pas dans ces processus.
        const res = await request(app.getHttpServer()).get('/v1/approval-requests');
        expect([401, 404]).toContain(res.status);
      } finally {
        await app.close();
      }
    }
  });

  it('refus par défaut : une route non marquée d’un processus sans garde des personnes répond 401', () => {
    const reflector = { getAllAndOverride: () => undefined };
    const guard = new DenyUnmarkedRoutesGuard(reflector as never);
    const context = { getType: () => 'http', getHandler: () => null, getClass: () => null };
    expect(() => guard.canActivate(context as never)).toThrow('UNAUTHENTICATED');
    expect(
      new DenyUnmarkedRoutesGuard({ getAllAndOverride: () => true } as never).canActivate(
        context as never,
      ),
    ).toBe(true);
  });
});

describe('API publique', () => {
  it('ne porte aucun port du service de clés ; porte les identités du terminal et du festivalier', async () => {
    const app = await createTestApp();
    try {
      for (const token of [KMS_PROVIDER, ...Object.values(PORTS)])
        expect(has(app, token)).toBe(false);
      expect([has(app, DEVICE_IDENTITY), has(app, CUSTOMER_IDENTITY)]).toEqual([true, true]);
      const tx = app.get(TenantTx, { strict: false });
      expect(
        await tx.unscoped(
          async (client) =>
            (await client.query<{ u: string }>('SELECT session_user AS u')).rows[0]!.u,
        ),
      ).toBe('cashless_app');
    } finally {
      await app.close();
    }
  });
});

describe('aucun faux en production (démarrage réel)', () => {
  const PRODUCTION = {
    NODE_ENV: 'production',
    DATABASE_URL_APP: 'postgres://cashless_app:s@127.0.0.1:1/c',
    DATABASE_URL_PLATFORM: 'postgres://cashless_platform:s@127.0.0.1:1/c',
    DATABASE_URL_TAGKEYS: 'postgres://cashless_tagkeys:s@127.0.0.1:1/c',
    DATABASE_URL_PERSO: 'postgres://cashless_perso:s@127.0.0.1:1/c',
    DATABASE_URL_TAGCHECK: 'postgres://cashless_tagcheck:s@127.0.0.1:1/c',
    DATABASE_URL_KEYADMIN: 'postgres://cashless_keyadmin:s@127.0.0.1:1/c',
    OIDC_ISSUER: 'https://id.example',
    OIDC_AUDIENCE: 'a',
    OIDC_APPROVAL_AUDIENCE: 'b',
    OIDC_JWKS_URI: 'https://id.example/jwks.json',
    CLAIM_CODE_HMAC_KEY: 'ab'.repeat(32),
    TAG_WRAPPING_KEY_REF: 'arn:aws:kms:eu-west-3:1:key/wrap',
    CLAIM_CODE_DOMAIN: 'pay.example.org',
    TRUST_PROXY_HOPS: '1',
  };
  const saved = { ...process.env };
  beforeEach(() => Object.assign(process.env, PRODUCTION));
  afterEach(() => {
    for (const key of Object.keys(PRODUCTION)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it.each([
    ['API publique', PublicProcessModule],
    ['clés de bracelet', TagKeysProcessModule],
    ['personnalisation', PersonalizationProcessModule],
    ['contrôle quotidien', TagCheckProcessModule],
    ['commande d’administration', KeyAdminProcessModule],
  ])('%s : refuse de démarrer en production tant que seul un faux existe', async (_name, root) => {
    await expect(Test.createTestingModule({ imports: [root] }).compile()).rejects.toThrow(
      FakeInProductionError,
    );
  });

  it.each([
    ['API publique', PublicProcessModule],
    ['clés de bracelet', TagKeysProcessModule],
    ['personnalisation', PersonalizationProcessModule],
    ['contrôle quotidien', TagCheckProcessModule],
    ['commande d’administration', KeyAdminProcessModule],
  ])(
    '%s : refuse de démarrer en production sans TRUST_PROXY_HOPS (OP-N53)',
    async (_name, root) => {
      delete process.env.TRUST_PROXY_HOPS;
      await expect(Test.createTestingModule({ imports: [root] }).compile()).rejects.toThrow(
        /TRUST_PROXY_HOPS manquant/,
      );
    },
  );

  // RISK-3 (revue post-fusion de bracelets-nfc) : sans NODE_ENV, ou avec une valeur inconnue, les
  // faux et le secret de test restaient en service. Chaque processus refuse désormais de démarrer.
  it.each([
    ['API publique', PublicProcessModule, undefined],
    ['clés de bracelet', TagKeysProcessModule, 'prod'],
    ['personnalisation', PersonalizationProcessModule, 'staging'],
    ['contrôle quotidien', TagCheckProcessModule, undefined],
    ['commande d’administration', KeyAdminProcessModule, ''],
  ])('%s : refuse de démarrer avec NODE_ENV absent ou inconnu (%p)', async (_name, root, value) => {
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    await expect(Test.createTestingModule({ imports: [root] }).compile()).rejects.toThrow(
      /NODE_ENV (manquant|inconnu)/,
    );
  });

  it('la garde de démarrage refuse aussi un faux injecté autrement', () => {
    const app = {
      get: (token: unknown) => (token === KMS_PROVIDER ? new FakeKms() : { production: true }),
    };
    expect(() => assertProcessIsSafe(app as never)).toThrow(/service de clés/);
  });
});
