// Processus « contrôle quotidien » (SPECIFICATION §3.2, §7.4) : recalcule un échantillon de mots de passe et compare.
// Droits sur le service de clés : calculer un mot de passe, déchiffrer une clé de données. Rôle de base :
// cashless_tagcheck. Aucune route métier : un travailleur, lancé une fois (`--once`) ou à intervalle.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProcessDbModule } from '../db/process-db.module';
import { KmsModule } from '../kms/kms.module';
import { MediaTagCheckModule } from '../media/media-tag-check.module';
import { ProcessBaseModule } from './process-base';

@Module({
  imports: [ProcessDbModule.forProcess('tag-check'), ProcessBaseModule, AuditModule, KmsModule.forCapabilities(['mac', 'decrypt']), MediaTagCheckModule],
})
export class TagCheckProcessModule {}
