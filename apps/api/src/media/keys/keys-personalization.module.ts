// Clés de bracelet dans le processus de personnalisation : clé de données de session, rotation, retrait.
import { Module } from '@nestjs/common';
import { DataKeyRepository } from './data-key.repository';
import { DekWorker } from './dek.worker';
import { TagKeyJobGate } from './job-gate';
import { SessionDataKeyProvider } from './session-data-key';

@Module({
  providers: [DataKeyRepository, SessionDataKeyProvider, TagKeyJobGate, DekWorker],
  exports: [DataKeyRepository, SessionDataKeyProvider],
})
export class KeysPersonalizationModule {}
