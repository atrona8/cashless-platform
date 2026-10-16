// Processus « personnalisation » (SPECIFICATION §3.2, §7.5) : enregistre les bracelets personnalisés. Droits sur le
// service de clés : calculer un mot de passe, ouvrir une clé de données ; PAS de déchiffrement. Rôle de base :
// cashless_perso. Routes appelées par une personne (rôle PERSONALIZER) : garde d'authentification des personnes.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProcessDbModule } from '../db/process-db.module';
import { HealthModule } from '../health/health.controller';
import { IdentityModule } from '../identity/identity.module';
import { KmsModule } from '../kms/kms.module';
import { MediaPersonalizationModule } from '../media/media-personalization.module';
import { ProcessBaseModule } from './process-base';

@Module({
  imports: [
    ProcessDbModule.forProcess('personalization'),
    ProcessBaseModule,
    HealthModule,
    IdentityModule,
    AuditModule,
    KmsModule.forCapabilities(['mac', 'dataKey']),
    MediaPersonalizationModule,
  ],
})
export class PersonalizationProcessModule {}
