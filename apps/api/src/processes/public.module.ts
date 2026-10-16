// Processus « API publique » (SPECIFICATION §3.2) : AUCUN droit sur le service de clés des bracelets. Il ne charge
// aucun port de clé (pas de KmsModule) et son rôle de base, cashless_app, ne lit ni les mots de passe chiffrés ni les
// clés de données chiffrées (post-roles.sql). Vérifié par test/unit/architecture.spec.ts.
import { Module } from '@nestjs/common';
import { AppModule } from '../app.module';

@Module({ imports: [AppModule] })
export class PublicProcessModule {}
