// Clés de bracelet dans le processus des clés de bracelet : cache court de la clé de données, rechiffrement.
import { Module } from '@nestjs/common';
import { DataKeyRepository } from './data-key.repository';
import { DekCache } from './dek-cache';
import { ReencryptWorker } from './reencrypt.worker';

@Module({
  providers: [DataKeyRepository, DekCache, ReencryptWorker],
  exports: [DataKeyRepository, DekCache],
})
export class KeysTagKeysModule {}
