// Câblage du scellement (mission 9b, WP12) : copie externe, scellement des grands livres et du journal d'audit,
// vérification quotidienne. Importé par `processes/maintenance.module.ts` seulement (rôle `cashless_maint`).
// La copie externe n'a qu'un faux : en production, la fabrique refuse de le construire (comme `createKms`).
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FakeInProductionError } from '../kms/production-guard';
import { OpsAlertsModule } from '../processes/ops-alerts';
import { SEAL_COPY } from '../security/port-tokens';
import { AuditSealWorker } from './audit-seal.worker';
import { FakeSealCopy } from './fake-seal-copy';
import { LedgerSealWorker } from './ledger-seal.worker';
import type { SealExternalCopy } from './seal-copy';
import { SealVerifyWorker } from './seal-verify.worker';

export function createSealCopy(config: Pick<AppConfig, 'production'>): SealExternalCopy {
  if (config.production) throw new FakeInProductionError(['la copie externe des scellements']);
  return new FakeSealCopy();
}

@Module({
  imports: [OpsAlertsModule],
  providers: [
    { provide: SEAL_COPY, inject: [APP_CONFIG], useFactory: createSealCopy },
    LedgerSealWorker,
    AuditSealWorker,
    SealVerifyWorker,
  ],
})
export class SealingModule {}
