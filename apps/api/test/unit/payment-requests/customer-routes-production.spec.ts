// Côté festivalier : aucun faux en production et aucune route servie sans garde (mission 5b, lot WP13, T064 ;
// NFR-009, C-009 ; contracts/qr-payments.md « Règles communes »). Seul le faux du port d'identité existe ; il est
// refusé au démarrage en configuration de production, et les routes du festivalier ne sont servies que derrière
// `CustomerGuard` (jamais `@Public()` seul).
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG } from '../../../src/config/config';
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
      { provide: APP_CONFIG, useValue: { production } },
      { provide: TenantTx, useValue: {} },
    ],
    exports: [APP_CONFIG, TenantTx],
  })
  class ConfigForTest {}
  return ConfigForTest;
}

describe('festivalier : faux refusé en production, routes derrière la garde (WP13, NFR-009)', () => {
  it('le graphe de production refuse de démarrer avec le faux du festivalier', async () => {
    await expect(
      Test.createTestingModule({
        imports: [configModule(true), CustomerIdentityModule],
      }).compile(),
    ).rejects.toThrow(FakeInProductionError);
  });

  it('hors production, le même graphe démarre (le test ci-dessus ne passe pas pour une autre raison)', async () => {
    const module = await Test.createTestingModule({
      imports: [configModule(false), CustomerIdentityModule],
    }).compile();
    await module.close();
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
