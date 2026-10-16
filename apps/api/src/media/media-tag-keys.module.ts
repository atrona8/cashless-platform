// Fonctionnalités des bracelets servies par le processus « tag-keys » (mission bracelets-nfc). Chaque lot y ajoute son
// module ; ce fichier ne contient aucune logique.
import { Module } from '@nestjs/common';
import { AuthKeysModule } from './auth-keys/auth-keys.module';
import { KeysTagKeysModule } from './keys/keys-tag-keys.module';

@Module({ imports: [KeysTagKeysModule, AuthKeysModule] })
export class MediaTagKeysModule {}
