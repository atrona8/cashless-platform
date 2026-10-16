// Poste de personnalisation : enregistrement d'un bracelet et association de son code imprimé.
import { Module } from '@nestjs/common';
import { ClaimHasher } from '../../kms/claim-hash';
import { KeysPersonalizationModule } from '../keys/keys-personalization.module';
import { PersonalizationController } from './personalization.controller';
import { PersonalizationService } from './personalization.service';

@Module({ imports: [KeysPersonalizationModule], controllers: [PersonalizationController], providers: [ClaimHasher, PersonalizationService] })
export class PersonalizationModule {}
