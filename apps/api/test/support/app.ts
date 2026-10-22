// Fabrique d'application de test. Deux modes d'identité :
// - `header` (défaut, mission 1) : la garde d'authentification laisse passer et le prestataire est lu dans l'en-tête
//   X-Test-Operator-Id ; ce fournisseur de test n'est jamais enregistré dans l'AppModule de production ;
// - un vérifieur (faux serveur d'identité, `FakeIdp`) : vraie garde, vrai contexte de prestataire.
import type { AddressInfo } from 'node:net';
import {
  Injectable,
  type INestApplication,
  type ModuleMetadata,
  type Provider,
  type Type,
} from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { Request } from 'express';
import { AppModule } from '../../src/app.module';
import { API_PREFIX, APP_CONFIG, type AppConfig } from '../../src/config/config';
import { ProblemException } from '../../src/errors/problem';
import { AuthenticationGuard } from '../../src/identity/authentication.guard';
import { IDENTITY_VERIFIER, type IdentityVerifier } from '../../src/identity/oidc-verifier';
import {
  TENANT_CONTEXT,
  type TenantContext,
  type TenantContextProvider,
} from '../../src/tenancy/tenant-context';
import { KMS_PROVIDER } from '../../src/kms/kms.module';
import type { FakeKms } from '../../src/kms/fake-kms';
import { KeyAdminProcessModule } from '../../src/processes/key-admin.module';
import { PersonalizationProcessModule } from '../../src/processes/personalization.module';
import { TagCheckProcessModule } from '../../src/processes/tag-check.module';
import { TagKeysProcessModule } from '../../src/processes/tag-keys.module';
import { applyTrustProxy, tlsServerOptions } from '../../src/processes/bootstrap';
import { PublicProcessModule } from '../../src/processes/public.module';
import { WorkerRegistry } from '../../src/processes/worker';
import { APP_URL, KEYADMIN_URL, PERSO_URL, PLATFORM_URL, TAGCHECK_URL, TAGKEYS_URL } from './db';
import { useTestTls, type TestTls } from './tls';

export const TEST_OPERATOR_HEADER = 'X-Test-Operator-Id';

/**
 * Identité du terminal d'une application de test (mission 5a, lot WP12). Une application servie en
 * clair (supertest) ne peut pas porter de certificat client : elle demande le faux de la mission 4
 * (`DEVICE_IDENTITY_FAKE=1`, refusé en production) ; le serveur HTTPS (`startHttpsApp`) sert
 * l'identité réelle. La variable n'est posée que le temps de construire les modules.
 */
async function compileWithDeviceIdentity<T>(
  identity: 'fake' | 'real',
  compile: () => Promise<T>,
): Promise<T> {
  const saved = process.env.DEVICE_IDENTITY_FAKE;
  if (identity === 'fake') process.env.DEVICE_IDENTITY_FAKE = '1';
  else delete process.env.DEVICE_IDENTITY_FAKE;
  try {
    return await compile();
  } finally {
    if (saved === undefined) delete process.env.DEVICE_IDENTITY_FAKE;
    else process.env.DEVICE_IDENTITY_FAKE = saved;
  }
}

@Injectable()
export class HeaderTenantContext implements TenantContextProvider {
  current(req: Request): TenantContext {
    const operatorId = req.header(TEST_OPERATOR_HEADER);
    if (!operatorId) throw new ProblemException('UNAUTHENTICATED');
    return { operatorId };
  }
}

export interface TestAppOptions {
  imports?: ModuleMetadata['imports'];
  providers?: Provider[];
  /** `header` par défaut ; sinon la source du vérifieur de jetons (ex. `FakeIdp`). */
  identity?: 'header' | { verifier(): IdentityVerifier };
  /** Fournisseurs de l'application remplacés pour ce test (ex. neutraliser l'enregistrement d'actions réelles). */
  overrides?: Array<{
    provide: Parameters<TestingModuleBuilder['overrideProvider']>[0];
    useValue: unknown;
  }>;
  /** Répartiteurs de confiance (OP-N53) ; défaut : la configuration (0 hors production). */
  trustProxyHops?: number;
  /** Identité du terminal : le faux (défaut, application en clair) ou la réelle. */
  deviceIdentity?: 'fake' | 'real';
}

export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  process.env.DATABASE_URL_APP = APP_URL;
  process.env.DATABASE_URL_PLATFORM = PLATFORM_URL;
  const builder = Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
    providers: options.providers ?? [],
  });
  for (const override of options.overrides ?? [])
    builder.overrideProvider(override.provide).useValue(override.useValue);
  const identity = options.identity ?? 'header';
  if (identity === 'header') {
    builder.overrideProvider(AuthenticationGuard).useValue({ canActivate: () => true });
    builder.overrideProvider(TENANT_CONTEXT).useClass(HeaderTenantContext);
  } else {
    builder.overrideProvider(IDENTITY_VERIFIER).useValue(identity.verifier());
  }
  const moduleRef = await compileWithDeviceIdentity(options.deviceIdentity ?? 'fake', () =>
    builder.compile(),
  );
  // Mêmes réglages que `serve` (processes/bootstrap.ts) : corps brut gardé (`Content-Digest`), répartiteurs.
  const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  applyTrustProxy(
    app,
    options.trustProxyHops ?? app.get<AppConfig>(APP_CONFIG, { strict: false }).trustProxyHops,
  );
  app.setGlobalPrefix(API_PREFIX);
  await app.init();
  return app;
}

// ----- Processus des clés de bracelet (mission bracelets-nfc) -----

function setKeyProcessUrls(): void {
  process.env.DATABASE_URL_TAGKEYS = TAGKEYS_URL;
  process.env.DATABASE_URL_PERSO = PERSO_URL;
  process.env.DATABASE_URL_TAGCHECK = TAGCHECK_URL;
  process.env.DATABASE_URL_KEYADMIN = KEYADMIN_URL;
}

const KEY_PROCESS_ROOTS = {
  'tag-keys': TagKeysProcessModule,
  personalization: PersonalizationProcessModule,
  'tag-check': TagCheckProcessModule,
  'key-admin': KeyAdminProcessModule,
} as const;

export type KeyProcessName = keyof typeof KEY_PROCESS_ROOTS;

export interface KeyProcessApp {
  app: INestApplication;
  /** Faux service de clés de CE processus (chaque processus a le sien, comme en exploitation). */
  kms: FakeKms;
  workers: WorkerRegistry;
}

/**
 * Démarre un processus des clés avec son vrai module racine, son vrai rôle de base et son faux service de clés.
 * `personalization` exige un vérifieur d'identité (les routes y sont appelées par une personne).
 */
export async function createKeyProcess(
  name: KeyProcessName,
  options: {
    identity?: { verifier(): IdentityVerifier };
    overrides?: TestAppOptions['overrides'];
    deviceIdentity?: 'fake' | 'real';
  } = {},
): Promise<KeyProcessApp> {
  setKeyProcessUrls();
  const builder = Test.createTestingModule({ imports: [KEY_PROCESS_ROOTS[name]] });
  for (const override of options.overrides ?? [])
    builder.overrideProvider(override.provide).useValue(override.useValue);
  if (options.identity)
    builder.overrideProvider(IDENTITY_VERIFIER).useValue(options.identity.verifier());
  const moduleRef = await compileWithDeviceIdentity(options.deviceIdentity ?? 'fake', () =>
    builder.compile(),
  );
  const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  applyTrustProxy(app, app.get<AppConfig>(APP_CONFIG, { strict: false }).trustProxyHops);
  app.setGlobalPrefix(API_PREFIX);
  await app.init();
  return {
    app,
    kms: app.get<FakeKms>(KMS_PROVIDER, { strict: false }),
    workers: app.get(WorkerRegistry, { strict: false }),
  };
}

// ----- Serveur HTTPS de test (mission identite-enrolement-terminaux, research R-03) -----

export interface HttpsTestApp {
  app: INestApplication;
  /** `https://localhost:<port>/v1` : préfixe global compris. */
  baseUrl: string;
  /** Certificats de test : `serverCaPem` pour le `ca` du client, autorité des terminaux pour le faux de WP09. */
  tls: TestTls;
  close(): Promise<void>;
}

/**
 * Démarre un processus HTTP en HTTPS réel, comme `serve` : TLS 1.3, certificat client demandé et jugé contre la seule
 * autorité de test des terminaux, identité RÉELLE du terminal (trois preuves, lot WP12).
 * `rootModule` : l'API publique par défaut, ou le module racine du processus des clés
 * de bracelet (`TagKeysProcessModule`, pour `/media/auth-keys`). Écoute sur un port libre de 127.0.0.1.
 */
export async function startHttpsApp(
  rootModule: Type<unknown> = PublicProcessModule,
  options: {
    identity?: { verifier(): IdentityVerifier };
    overrides?: TestAppOptions['overrides'];
    /**
     * Répartiteurs de confiance (défaut : la configuration). Une suite qui teste les limites par
     * adresse pose 1 et choisit son adresse par `X-Forwarded-For`, sans partager 127.0.0.1.
     */
    trustProxyHops?: number;
  } = {},
): Promise<HttpsTestApp> {
  process.env.DATABASE_URL_APP = APP_URL;
  process.env.DATABASE_URL_PLATFORM = PLATFORM_URL;
  setKeyProcessUrls();
  const tls = await useTestTls();
  const builder = Test.createTestingModule({ imports: [rootModule] });
  for (const override of options.overrides ?? [])
    builder.overrideProvider(override.provide).useValue(override.useValue);
  if (options.identity)
    builder.overrideProvider(IDENTITY_VERIFIER).useValue(options.identity.verifier());
  const moduleRef = await compileWithDeviceIdentity('real', () => builder.compile());
  const config = moduleRef.get<AppConfig>(APP_CONFIG, { strict: false });
  const httpsOptions = tlsServerOptions(config);
  if (!httpsOptions)
    throw new Error('startHttpsApp : certificats de test absents de la configuration');
  const app = moduleRef.createNestApplication({ logger: false, rawBody: true, httpsOptions });
  applyTrustProxy(app, options.trustProxyHops ?? config.trustProxyHops);
  app.setGlobalPrefix(API_PREFIX);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return {
    app,
    baseUrl: `https://localhost:${port}/${API_PREFIX}`,
    tls,
    close: () => app.close(),
  };
}
