// Identité du festivalier pour l'API publique : faux fournisseur (hors production) et vérification du compte en base.
import { Global, Injectable, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { TenantTx } from '../db/tenant-tx';
import { FakeInProductionError } from '../kms/production-guard';
import { CustomerGuard } from './customer.guard';
import {
  CUSTOMER_DIRECTORY,
  CUSTOMER_IDENTITY,
  type CustomerDirectory,
} from './customer-identity.port';
import { FakeCustomerIdentity } from './fake-customer-identity';

@Injectable()
export class TenantCustomerDirectory implements CustomerDirectory {
  constructor(private readonly tx: TenantTx) {}

  exists(operatorId: string, customerId: string): Promise<boolean> {
    return this.tx.run(operatorId, async (client) => {
      const { rowCount } = await client.query(
        "SELECT 1 FROM party WHERE id = $1 AND kind = 'CUSTOMER' AND operator_id = $2",
        [customerId, operatorId],
      );
      return rowCount === 1;
    });
  }
}

export function createCustomerIdentity(
  config: Pick<AppConfig, 'production'>,
): FakeCustomerIdentity {
  if (config.production) throw new FakeInProductionError(['l’identité du festivalier']);
  return new FakeCustomerIdentity();
}

@Global()
@Module({
  providers: [
    { provide: CUSTOMER_IDENTITY, inject: [APP_CONFIG], useFactory: createCustomerIdentity },
    { provide: CUSTOMER_DIRECTORY, useClass: TenantCustomerDirectory },
    CustomerGuard,
  ],
  exports: [CUSTOMER_IDENTITY, CUSTOMER_DIRECTORY, CustomerGuard],
})
export class CustomerIdentityModule {}
