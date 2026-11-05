// Interface de chiffrement des mots de passe d'un snapshot (WP12 branche sa réalisation ici). Le
// chiffrement sous
// la clé de contenu K_v et les enveloppes par terminal ne sont PAS de ce lot.
import { Injectable, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FakeInProductionError } from '../kms/production-guard';
import type { SnapshotEntry } from './content-hash';

export const ENTRY_ENCRYPTOR = Symbol('ENTRY_ENCRYPTOR');

/** Ligne vivante de la source (offline_snapshot_source*), avec le mot de passe tel que stocké. */
export interface LiveRow {
  tokenHash: Buffer;
  /** Bracelet (`media.id`) : entre dans l'AAD du mot de passe tel que stocké. */
  mediaId: string;
  entry: SnapshotEntry;
  pwdPackEnc: Buffer | null;
  pwdPackDekId: string | null;
  keyIndex: number;
  nfcUid: Buffer | null;
}

/** Entrée prête à inscrire : `entry.pwd_pack_sha256` lié à `pwdPackEncHex` (34 octets en
 * hexadécimal) ou nul. */
export interface EncryptedEntry {
  tokenHash: Buffer;
  entry: SnapshotEntry;
  pwdPackEncHex: string | null;
}

export interface EntryEncryptor {
  /** `version` : version attendue du snapshot (elle entre dans l'AAD des mots de passe, WP12). */
  encrypt(input: {
    operatorId: string;
    ledgerId: string;
    version: number;
    rows: readonly LiveRow[];
  }): Promise<{
    contentKeyWrapped: Buffer;
    entries: EncryptedEntry[];
    /** Entrées rendues sans mot de passe parce qu'il n'a pas pu être rechiffré (code sans secret). */
    skipped?: Array<{ tokenHash: Buffer; code: string }>;
  }>;
}

/**
 * Réalisation PROVISOIRE (avant WP12) : refuse toute ligne portant un mot de passe, pour qu'aucun
 * chemin secret à
 * moitié construit n'existe. Sans mot de passe, la clé enveloppée n'est qu'un marqueur (aucune clé
 * n'existe).
 * Faux : `isFake` ; la fabrique refuse de la construire en production.
 */
@Injectable()
export class RefusingEntryEncryptor implements EntryEncryptor {
  readonly isFake = true;

  encrypt(input: {
    operatorId: string;
    ledgerId: string;
    version: number;
    rows: readonly LiveRow[];
  }): Promise<{
    contentKeyWrapped: Buffer;
    entries: EncryptedEntry[];
  }> {
    if (input.rows.some((row) => row.pwdPackEnc !== null || row.pwdPackDekId !== null))
      return Promise.reject(
        new Error('Chiffrement des mots de passe non disponible (WP12) : ligne refusée'),
      );
    return Promise.resolve({
      contentKeyWrapped: Buffer.from('PROVISOIRE:aucun-mot-de-passe', 'utf8'),
      entries: input.rows.map((row) => ({
        tokenHash: row.tokenHash,
        entry: { ...row.entry, pwd_pack_sha256: null },
        pwdPackEncHex: null,
      })),
    });
  }
}

/** Fabrique du chiffreur : le provisoire est interdit en production (aucun faux en production). */
export function createEntryEncryptor(config: Pick<AppConfig, 'production'>): EntryEncryptor {
  if (config.production) throw new FakeInProductionError(['le chiffreur d’entrées provisoire']);
  return new RefusingEntryEncryptor();
}

@Module({
  providers: [
    {
      provide: ENTRY_ENCRYPTOR,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createEntryEncryptor(config),
    },
  ],
  exports: [ENTRY_ENCRYPTOR],
})
export class EntryEncryptorModule {}
