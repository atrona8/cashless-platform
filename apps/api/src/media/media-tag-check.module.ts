// Fonctionnalités des bracelets servies par le processus « tag-check » (mission bracelets-nfc). Chaque lot y ajoute son
// module ; ce fichier ne contient aucune logique.
import { Module } from '@nestjs/common';
import { DailyCheckModule } from './daily-check/daily-check.module';

@Module({ imports: [DailyCheckModule] })
export class MediaTagCheckModule {}
