// Côté festivalier : aucun faux en production et aucune route servie sans garde (mission 5b, lot WP13, T064 ;
// NFR-009, C-009 ; contracts/qr-payments.md « Règles communes »). L'identité du festivalier, par jeton, n'est plus un
// faux : en production elle ignore les en-têtes de test (401 sans jeton). Le faux qui reste est l'envoyeur des codes
// à usage unique (jusqu'à la mission 12b) : il fait refuser le démarrage en production. Les routes du festivalier ne
// sont servies que derrière `CustomerGuard` (jamais `@Public()` seul).
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Global, Module, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG, loadConfig } from '../../../src/config/config';
import { CustomerAuthModule } from '../../../src/customer-auth/customer-auth.module';
import { CustomerGuard } from '../../../src/customer-identity/customer.guard';
import { CustomerIdentityModule } from '../../../src/customer-identity/customer-identity.module';
import { TenantTx } from '../../../src/db/tenant-tx';
import { DeviceOrCallerGuard } from '../../../src/device-identity/device-or-caller.guard';
import { FakeInProductionError } from '../../../src/kms/production-guard';
import { IS_PUBLIC } from '../../../src/identity/public.decorator';
import { CustomerPaymentRequestsController } from '../../../src/payment-requests/customer-payment-requests.controller';
import { TerminalPaymentRequestsController } from '../../../src/payment-requests/terminal-payment-requests.controller';

const guardsOf = (controller: object, method: string): unknown[] => {
  const handler = (controller as Record<string, unknown>)[method];
  return (Reflect.getMetadata(GUARDS_METADATA, handler as object) as unknown[] | undefined) ?? [];
};
const isPublic = (controller: object, method: string): boolean =>
  Reflect.getMetadata(IS_PUBLIC, (controller as Record<string, unknown>)[method] as object) ===
  true;

function configModule(production: boolean) {
  @Global()
  @Module({
    providers: [
      { provide: APP_CONFIG, useValue: { ...loadConfig(), production } },
      { provide: TenantTx, useValue: {} },
    ],
    exports: [APP_CONFIG, TenantTx],
  })
  class ConfigForTest {}
  return ConfigForTest;
}

const contextOf = (headers: Record<string, string>): ExecutionContext => {
  const req = { header: (name: string) => headers[name.toLowerCase()], headers };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
};

describe('festivalier : routes derrière la garde, faux envoyeur refusé en production (WP13, NFR-009)', () => {
  it('en production, le graphe refuse de démarrer tant que l’envoyeur de codes est le faux', async () => {
    await expect(
      Test.createTestingModule({
        imports: [configModule(true), CustomerIdentityModule, CustomerAuthModule],
      }).compile(),
    ).rejects.toThrow(FakeInProductionError);
  });

  it('hors production, le même graphe démarre (le test ci-dessus ne passe pas pour une autre raison)', async () => {
    const module = await Test.createTestingModule({
      imports: [configModule(false), CustomerIdentityModule, CustomerAuthModule],
    }).compile();
    await module.close();
  });

  it('en production, l’identité du festivalier ne démarre pas en faux : 401 sans jeton, en-têtes de test ignorés', async () => {
    const module = await Test.createTestingModule({
      imports: [configModule(true), CustomerIdentityModule],
    }).compile();
    try {
      const guard = module.get(CustomerGuard);
      const testHeaders = {
        'x-test-customer-id': '11111111-1111-4111-8111-111111111111',
        'x-test-operator-id': '22222222-2222-4222-8222-222222222222',
      };
      await expect(guard.canActivate(contextOf({}))).rejects.toMatchObject({ status: 401 });
      await expect(guard.canActivate(contextOf(testHeaders))).rejects.toMatchObject({
        status: 401,
      });
    } finally {
      await module.close();
    }
  });

  it('pay et createCustomerQrToken : servies derrière CustomerGuard, marque publique de la garde globale comprise', () => {
    const proto = CustomerPaymentRequestsController.prototype;
    for (const method of ['pay', 'createToken']) {
      expect([method, guardsOf(proto, method)]).toEqual([method, [CustomerGuard]]);
      // `@Public()` ne retire que la garde des personnes du personnel : la garde du festivalier la remplace.
      expect([method, isPublic(proto, method)]).toEqual([method, true]);
    }
  });

  it('consultation et annulation : garde exclusive « terminal ou festivalier », jamais @Public() seul', () => {
    const proto = TerminalPaymentRequestsController.prototype;
    for (const method of ['get', 'cancel'])
      expect([method, guardsOf(proto, method)]).toEqual([method, [DeviceOrCallerGuard]]);
  });
});
