// Partie secrète du processus snapshot-content (WP12) : chiffreur d'entrées (jeton ENTRY_ENCRYPTOR
// de WP11)
// et travailleur d'enveloppes. Droits de clé du processus : `decrypt` et `dataKey`, rien d'autre.
import { Module } from '@nestjs/common';
import { DataKeyRepository } from '../../media/keys/data-key.repository';
import { DekCache } from '../../media/keys/dek-cache';
import { ENTRY_ENCRYPTOR } from '../entry-encryptor';
import { DeviceWrappingRepository } from './device-wrapping.repository';
import { DeviceWrappingWorker } from './device-wrapping.worker';
import { SnapshotEntryEncryptor } from './snapshot-entry-encryptor';
import { SnapshotKeyWrapper } from './snapshot-key-wrapper';

@Module({
  providers: [
    DataKeyRepository,
    DekCache,
    SnapshotEntryEncryptor,
    SnapshotKeyWrapper,
    DeviceWrappingRepository,
    DeviceWrappingWorker,
    { provide: ENTRY_ENCRYPTOR, useExisting: SnapshotEntryEncryptor },
  ],
  exports: [ENTRY_ENCRYPTOR],
})
export class SnapshotCryptoModule {}
