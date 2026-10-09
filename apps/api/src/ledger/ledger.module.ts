// Module du moteur d'écritures. La configuration (port CONFIG_RESOLVER) est fournie par le module appelant : aucune
// implémentation de production dans cette mission (lecture de fee_rule / config_version : mission 3).
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { LedgerEngineService } from './ledger-engine.service';
import { ACCOUNT_RESOLVER, SqlAccountResolver } from './ports/account-resolver';
import { CONFIG_RESOLVER } from './ports/config-resolver';

@Module({})
export class LedgerModule {
  /** `configResolver` : fournisseur du jeton CONFIG_RESOLVER (ex. `{ provide: CONFIG_RESOLVER, useValue: … }`). */
  static register(configResolver: Provider): DynamicModule {
    return {
      module: LedgerModule,
      providers: [configResolver, { provide: ACCOUNT_RESOLVER, useClass: SqlAccountResolver }, LedgerEngineService],
      exports: [LedgerEngineService],
    };
  }
}

export { CONFIG_RESOLVER };
