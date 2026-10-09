// Fabrique d'application de test. Deux modes d'identité :
// - `header` (défaut, mission 1) : la garde d'authentification laisse passer et le prestataire est lu dans l'en-tête
//   X-Test-Operator-Id ; ce fournisseur de test n'est jamais enregistré dans l'AppModule de production ;
// - un vérifieur (faux serveur d'identité, `FakeIdp`) : vraie garde, vrai contexte de prestataire.
import { Injectable, type INestApplication, type ModuleMetadata, type Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { AppModule } from '../../src/app.module';
import { API_PREFIX } from '../../src/config/config';
import { ProblemException } from '../../src/errors/problem';
import { AuthenticationGuard } from '../../src/identity/authentication.guard';
import { IDENTITY_VERIFIER, type IdentityVerifier } from '../../src/identity/oidc-verifier';
import { TENANT_CONTEXT, type TenantContext, type TenantContextProvider } from '../../src/tenancy/tenant-context';
import { APP_URL } from './db';

export const TEST_OPERATOR_HEADER = 'X-Test-Operator-Id';

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
}

export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  process.env.DATABASE_URL_APP = APP_URL;
  const builder = Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
    providers: options.providers ?? [],
  });
  const identity = options.identity ?? 'header';
  if (identity === 'header') {
    builder.overrideProvider(AuthenticationGuard).useValue({ canActivate: () => true });
    builder.overrideProvider(TENANT_CONTEXT).useClass(HeaderTenantContext);
  } else {
    builder.overrideProvider(IDENTITY_VERIFIER).useValue(identity.verifier());
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix(API_PREFIX);
  await app.init();
  return app;
}
