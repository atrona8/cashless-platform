// Câblage du scellement (mission 9b, WP12) : copie externe, scellement des grands livres et du journal d'audit,
// vérification quotidienne. Importé par `processes/maintenance.module.ts` seulement (rôle `cashless_maint`).
// `SEAL_COPY=fake` (défaut hors production) : le faux ; `real` : S3 Object Lock (WP09). En production, la fabrique
// refuse le faux (`FakeInProductionError`) et le réel tant que `seal-copy` n'est pas dans `PRODUCTION_ENABLED_SERVICES`
// (`UntriedInProductionError`) ; sans compartiment, `S3SealCopy` refuse aussi. Seuls les processus qui scellent
// importent ce module : l'absence de `SEAL_COPY_BUCKET` n'empêche pas les autres de démarrer.
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { S3Client } from '@aws-sdk/client-s3';
import { PRODUCTION_ENABLED_SERVICES } from '../external-services/production-enabled';
import type { ExternalService } from '../external-services/services';
import { FakeInProductionError, UntriedInProductionError } from '../kms/production-guard';
import { OpsAlertsModule } from '../processes/ops-alerts';
import { SEAL_COPY } from '../security/port-tokens';
import { AuditSealWorker } from './audit-seal.worker';
import { FakeSealCopy } from './fake-seal-copy';
import { LedgerSealWorker } from './ledger-seal.worker';
import type { SealExternalCopy } from './seal-copy';
import { S3SealCopy } from './s3-seal-copy';
import { SealVerifyWorker } from './seal-verify.worker';

type SealCopyConfig = Pick<AppConfig, 'production'> &
  Partial<Pick<AppConfig, 'externalModes' | 'aws' | 'sealCopy'>>;

/** `enabled` : la liste du code ; le paramètre ne sert qu'aux tests. `client` : faux serveur local des tests. */
export function createSealCopy(
  config: SealCopyConfig,
  enabled: readonly ExternalService[] = PRODUCTION_ENABLED_SERVICES,
  client?: S3Client,
): SealExternalCopy {
  const mode = config.externalModes?.sealCopy ?? (config.production ? 'real' : 'fake');
  if (mode === 'fake') {
    if (config.production) throw new FakeInProductionError(['la copie externe des scellements']);
    return new FakeSealCopy();
  }
  if (config.production && !enabled.includes('seal-copy'))
    throw new UntriedInProductionError('seal-copy');
  const aws = config.aws ?? { region: 'eu-west-3', endpoint: null };
  return new S3SealCopy(
    client ??
      new S3Client({
        region: aws.region,
        ...(aws.endpoint === null ? {} : { endpoint: aws.endpoint, forcePathStyle: true }),
      }),
    { sealCopy: config.sealCopy ?? { bucket: null, retentionDays: 3650 } },
  );
}

@Module({
  imports: [OpsAlertsModule],
  providers: [
    {
      provide: SEAL_COPY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createSealCopy(config),
    },
    LedgerSealWorker,
    AuditSealWorker,
    SealVerifyWorker,
  ],
})
export class SealingModule {}
