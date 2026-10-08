// Fabrique d'application de test : AppModule + prestataire lu dans l'en-tête X-Test-Operator-Id.
// Ce fournisseur de test n'est jamais enregistré dans l'AppModule de production.
import { Injectable, type INestApplication, type ModuleMetadata, type Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { AppModule } from '../../src/app.module';
import { API_PREFIX } from '../../src/config/config';
import { ProblemException } from '../../src/errors/problem';
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
}

export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  process.env.DATABASE_URL_APP = APP_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
    providers: options.providers ?? [],
  })
    .overrideProvider(TENANT_CONTEXT)
    .useClass(HeaderTenantContext)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix(API_PREFIX);
  await app.init();
  return app;
}
