// Fonctionnalités des bracelets servies par le processus « key-admin » (mission bracelets-nfc). Chaque lot y ajoute son
// module ; ce fichier ne contient aucune logique.
import { Module } from '@nestjs/common';
import { KeysAdminModule } from './keys/keys-admin.module';

@Module({ imports: [KeysAdminModule] })
export class MediaKeyAdminModule {}
