// Processus « clés de bracelet » (SPECIFICATION §3.2, §7.4) : sert POST /media/auth-keys et rechiffre après une
// rotation. Seul droit sur le service de clés : déchiffrer une clé de données. Rôle de base : cashless_tagkeys.
// Aucune garde des personnes ici : les routes sont celles d'un terminal, et toute route non marquée est refusée.
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { ProcessDbModule } from '../db/process-db.module';
import { DeviceIdentityModule } from '../device-identity/device-identity.module';
import { HealthModule } from '../health/health.controller';
import { KmsModule } from '../kms/kms.module';
import { MediaTagKeysModule } from '../media/media-tag-keys.module';
import { DenyUnmarkedRoutesGuard, ProcessBaseModule } from './process-base';

@Module({
  imports: [ProcessDbModule.forProcess('tag-keys'), ProcessBaseModule, HealthModule, DeviceIdentityModule, AuditModule, KmsModule.forCapabilities(['decrypt']), MediaTagKeysModule],
  providers: [DenyUnmarkedRoutesGuard, { provide: APP_GUARD, useExisting: DenyUnmarkedRoutesGuard }],
})
export class TagKeysProcessModule {}
