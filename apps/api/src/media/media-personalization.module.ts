// Fonctionnalités des bracelets servies par le processus « personalization » (mission bracelets-nfc). Chaque lot y ajoute son
// module ; ce fichier ne contient aucune logique.
import { Module } from '@nestjs/common';
import { KeysPersonalizationModule } from './keys/keys-personalization.module';
import { PersonalizationModule } from './personalization/personalization.module';

@Module({ imports: [KeysPersonalizationModule, PersonalizationModule] })
export class MediaPersonalizationModule {}
