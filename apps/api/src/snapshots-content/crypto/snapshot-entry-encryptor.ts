// Chiffrement des mots de passe d'un snapshot (WP12, T050, R-08 et R-30.9) : chaque `pwd_pack_enc`
// de la
// source est rouvert (clé de données, `DecryptPort`) puis rechiffré sous la clé de contenu `K_v`
// de la
// version (`DataKeyPort`), AAD `CASHLESS/SNAPPWD/v1`. `pwd_pack_sha256` = SHA-256 du chiffré de 34
// octets.
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (règle 4 de CLAUDE.md) : cryptographie et secrets en
// mémoire.
// Aucun repli en clair : une ligne dont le mot de passe ne s'ouvre pas part SANS mot de passe,
// avec une
// erreur nommée qui ne porte aucun secret. Tout secret (K_v, clé de données, PWD‖PACK) est mis à
// zéro
// dès l'usage, y compris en cas d'erreur. Aucun appel au service de clés ni calcul dans une
// transaction.
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  openPwdPack,
  pwdPackAad,
  sealPwdPack,
  snapshotPwdAad,
  TagFormatError,
} from '@cashless/tag-format';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { TenantTx } from '../../db/tenant-tx';
import {
  DATA_KEY_PORT,
  DECRYPT_PORT,
  KmsKeyError,
  type DataKeyPort,
  type DecryptPort,
} from '../../kms/kms.ports';
import { zeroize } from '../../kms/zeroize';
import { DataKeyRepository } from '../../media/keys/data-key.repository';
import { DekCache } from '../../media/keys/dek-cache';
import { SLICE_ROWS, yieldToLoop } from '../../processes/cooperative';
import type { EncryptedEntry, EntryEncryptor, LiveRow } from '../entry-encryptor';

/** Causes nommées d'une ligne rendue sans mot de passe (aucune ne porte de valeur secrète). */
export type PwdSkipCode =
  | 'PWD_INCOMPLETE_ROW'
  | 'PWD_DEK_MISSING'
  | 'PWD_DEK_RETIRED'
  | 'PWD_DEK_UNREADABLE'
  | 'PWD_OPEN_FAILED';

export class SnapshotPwdError extends Error {
  constructor(readonly code: PwdSkipCode) {
    super(`Mot de passe de snapshot non rechiffré : ${code}`);
    this.name = 'SnapshotPwdError';
  }
}

type Skipped = Array<{ tokenHash: Buffer; code: PwdSkipCode }>;

@Injectable()
export class SnapshotEntryEncryptor implements EntryEncryptor {
  private readonly logger = new Logger(SnapshotEntryEncryptor.name);

  constructor(
    @Inject(DATA_KEY_PORT) private readonly dataKeys: DataKeyPort,
    @Inject(DECRYPT_PORT) private readonly kms: DecryptPort,
    private readonly tx: TenantTx,
    private readonly keys: DataKeyRepository,
    private readonly cache: DekCache,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'tagWrappingKeyRef'>,
  ) {}

  async encrypt(input: {
    operatorId: string;
    ledgerId: string;
    version: number;
    rows: readonly LiveRow[];
  }): Promise<{ contentKeyWrapped: Buffer; entries: EncryptedEntry[]; skipped: Skipped }> {
    if (!Number.isSafeInteger(input.version) || input.version < 1)
      throw new Error('Version de snapshot invalide');
    const version = BigInt(input.version);
    // Un K_v par version, tiré à chaque appel, jamais réutilisé. Une panne du service de clés
    // (KmsUnavailableError) remonte telle quelle.
    const content = await this.dataKeys.generateDataKey(this.config.tagWrappingKeyRef);
    const kv = content.plaintext;
    try {
      const entries = new Array<EncryptedEntry>(input.rows.length);
      const skipped: Skipped = [];
      const withPwd = new Map<string, number[]>();
      input.rows.forEach((row, index) => {
        if (row.pwdPackEnc === null && row.pwdPackDekId === null) {
          entries[index] = withoutPassword(row);
        } else if (row.pwdPackEnc === null || row.pwdPackDekId === null || row.nfcUid === null) {
          entries[index] = withoutPassword(row);
          skipped.push({ tokenHash: row.tokenHash, code: 'PWD_INCOMPLETE_ROW' });
        } else {
          const group = withPwd.get(row.pwdPackDekId) ?? [];
          group.push(index);
          withPwd.set(row.pwdPackDekId, group);
        }
      });
      // Un déchiffrement par clé de données (DekCache.withKey), pas par bracelet.
      for (const [dekId, indexes] of withPwd) {
        try {
          await this.cache.withKey(
            dekId,
            () => this.loadDek(input.operatorId, dekId),
            async (dek) => {
              // Par tranches, en rendant la main à la boucle (NFR-005) : `withKey` garde la clé en vie (et
              // non mise à zéro) tant que cette fonction n'a pas fini.
              for (let from = 0; from < indexes.length; from += SLICE_ROWS) {
                for (const index of indexes.slice(from, from + SLICE_ROWS)) {
                  const row = input.rows[index]!;
                  try {
                    entries[index] = this.sealRow({ ...input, version }, kv, dek, row);
                  } catch (error) {
                    entries[index] = withoutPassword(row);
                    skipped.push({ tokenHash: row.tokenHash, code: skipCode(error) });
                  }
                }
                await yieldToLoop();
              }
            },
          );
        } catch (error) {
          // La clé de données elle-même est inutilisable : toutes ses lignes partent sans mot de
          // passe.
          const code = skipCode(error);
          for (const index of indexes) {
            const row = input.rows[index]!;
            entries[index] = withoutPassword(row);
            skipped.push({ tokenHash: row.tokenHash, code });
          }
        }
      }
      if (skipped.length > 0) {
        const counts = new Map<PwdSkipCode, number>();
        for (const item of skipped) counts.set(item.code, (counts.get(item.code) ?? 0) + 1);
        this.logger.error(
          `snapshot ${input.ledgerId} v${input.version} : mots de passe non rechiffrés ` +
            [...counts].map(([code, n]) => `${code}=${n}`).join(' '),
        );
      }
      return { contentKeyWrapped: content.encrypted, entries, skipped };
    } finally {
      zeroize(kv);
    }
  }

  /** Charge la clé de données en clair ; le tampon est celui du DekCache, qui le met à zéro. */
  private async loadDek(operatorId: string, dekId: string): Promise<Buffer> {
    // Transaction courte, fermée avant tout appel au service de clés.
    const stored = await this.tx.run(operatorId, (client) => this.keys.encrypted(client, dekId));
    if (!stored) throw new SnapshotPwdError('PWD_DEK_MISSING');
    if (stored.status === 'RETIRED') throw new SnapshotPwdError('PWD_DEK_RETIRED');
    try {
      return await this.kms.decrypt(stored.wrappingKeyRef, stored.encrypted);
    } catch (error) {
      if (error instanceof KmsKeyError) throw new SnapshotPwdError('PWD_DEK_UNREADABLE');
      throw error;
    }
  }

  private sealRow(
    ctx: { operatorId: string; ledgerId: string; version: bigint },
    kv: Buffer,
    dek: Buffer,
    row: LiveRow,
  ): EncryptedEntry {
    let pwdPack: Buffer | undefined;
    try {
      pwdPack = openPwdPack({
        dek,
        blob: row.pwdPackEnc!,
        aad: pwdPackAad({
          mediaId: row.mediaId,
          operatorId: ctx.operatorId,
          keyIndex: row.keyIndex,
          uid: row.nfcUid!,
        }),
      });
      const sealed = sealPwdPack({
        dek: kv,
        nonce: randomBytes(12),
        pwdPack,
        aad: snapshotPwdAad(ctx.ledgerId, ctx.version, row.tokenHash, row.nfcUid!),
      });
      return {
        tokenHash: row.tokenHash,
        entry: { ...row.entry, pwd_pack_sha256: createHash('sha256').update(sealed).digest('hex') },
        pwdPackEncHex: sealed.toString('hex'),
      };
    } finally {
      zeroize(pwdPack);
    }
  }
}

function withoutPassword(row: LiveRow): EncryptedEntry {
  return {
    tokenHash: row.tokenHash,
    entry: { ...row.entry, pwd_pack_sha256: null },
    pwdPackEncHex: null,
  };
}

/** Cause nommée d'un échec par ligne ; toute autre erreur (base, service de clés) remonte. */
function skipCode(error: unknown): PwdSkipCode {
  if (error instanceof SnapshotPwdError) return error.code;
  if (error instanceof TagFormatError) return 'PWD_OPEN_FAILED';
  throw error;
}
