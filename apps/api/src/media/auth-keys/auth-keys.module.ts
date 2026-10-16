// Mot de passe d'un bracelet pour un terminal, dans le processus des clés de bracelet.
import { Module } from '@nestjs/common';
import { KeysTagKeysModule } from '../keys/keys-tag-keys.module';
import { AuthKeysController } from './auth-keys.controller';
import { AuthKeysService } from './auth-keys.service';

@Module({
  imports: [KeysTagKeysModule],
  controllers: [AuthKeysController],
  providers: [AuthKeysService],
})
export class AuthKeysModule {}
