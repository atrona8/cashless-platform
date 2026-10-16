// Fonctionnalités des bracelets servies par le processus « public » (mission bracelets-nfc). Chaque lot y ajoute son
// module ; ce fichier ne contient aucune logique.
import { Module } from '@nestjs/common';
import { BatchesModule } from './batches/batches.module';
import { BlacklistModule } from './blacklist/blacklist.module';
import { ClaimsModule } from './claims/claims.module';
import { KeysPublicModule } from './keys/keys-public.module';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { ReturnModule } from './lifecycle/return.module';
import { TapsModule } from './taps/taps.module';

@Module({
  imports: [
    KeysPublicModule,
    BatchesModule,
    TapsModule,
    LifecycleModule,
    ReturnModule,
    ClaimsModule,
    BlacklistModule,
  ],
})
export class MediaPublicModule {}
