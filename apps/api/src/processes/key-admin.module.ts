// Commande d'administration des clés (décision du porteur n° 6 du 13/10/2026) : SEULE à pouvoir créer ou désactiver
// une clé dans le service de clés. Lancée à la demande par l'exploitant, elle exécute les travaux approuvés à deux
// puis s'arrête : aucun service permanent ne détient ce droit. Rôle de base : cashless_keyadmin. Aucune route.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProcessDbModule } from '../db/process-db.module';
import { KmsModule } from '../kms/kms.module';
import { MediaKeyAdminModule } from '../media/media-key-admin.module';
import { ProcessBaseModule } from './process-base';

@Module({
  imports: [ProcessDbModule.forProcess('key-admin'), ProcessBaseModule, AuditModule, KmsModule.forCapabilities(['keyAdmin']), MediaKeyAdminModule],
})
export class KeyAdminProcessModule {}
