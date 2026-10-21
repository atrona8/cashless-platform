// Enrôlement des terminaux (lot WP14), dans l'API publique : vérificateur d'attestation, autorité
// des terminaux et jetons d'appareil. Chacun de ces ports n'a qu'un faux hors production, ou refuse
// de se construire en production (sauf l'attestation réelle) ; la garde de démarrage
// (`assertProcessIsSafe`) refuse en outre tout faux restant.
import { Module } from '@nestjs/common';
import { AttestationModule } from '../../attestation/attestation.module';
import { DeviceCaModule } from '../../device-ca/device-ca.module';
import { DeviceTokensModule } from '../../device-tokens/device-tokens.module';
import { EnrollmentController } from './enrollment.controller';
import { EnrollmentService } from './enrollment.service';

@Module({
  imports: [AttestationModule, DeviceCaModule, DeviceTokensModule],
  controllers: [EnrollmentController],
  providers: [EnrollmentService],
})
export class EnrollmentModule {}
