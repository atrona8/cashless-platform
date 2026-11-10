// Identité du festivalier pour l'API publique : faux fournisseur (hors production) et vérification du compte en base.
import { Global, Injectable, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { TenantTx } from '../db/tenant-tx';
import { CustomerGuard } from './customer.guard';
import {
  CUSTOMER_DIRECTORY,
  CUSTOMER_IDENTITY,
  type CustomerDirectory,
} from './customer-identity.port';
import { CustomerAccessTokens } from './customer-access-token';
import { FakeCustomerIdentity } from './fake-customer-identity';
import { TokenCustomerIdentity } from './token-customer-identity';

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

/**
 * Identité du festivalier : le jeton d'accès, toujours. Hors production, les en-têtes de test sont en plus admis
 * quand aucun `Authorization` n'est présent (OP-N43, décision du porteur du 10/11/2026) ; en production, ils sont
 * ignorés. Ce n'est pas un faux : c'est le faux `OtpSender` qui refuse encore le démarrage en production.
 */
export function createCustomerIdentity(
  config: Pick<AppConfig, 'production' | 'customerAuthHmacKey'>,
): TokenCustomerIdentity {
  return new TokenCustomerIdentity(
    new CustomerAccessTokens(config),
    config.production ? null : new FakeCustomerIdentity(),
  );
}

@Global()
@Module({
  providers: [
    { provide: CUSTOMER_IDENTITY, inject: [APP_CONFIG], useFactory: createCustomerIdentity },
    { provide: CUSTOMER_DIRECTORY, useClass: TenantCustomerDirectory },
    CustomerAccessTokens,
    CustomerGuard,
  ],
  exports: [CUSTOMER_IDENTITY, CUSTOMER_DIRECTORY, CustomerGuard, CustomerAccessTokens],
})
export class CustomerIdentityModule {}
