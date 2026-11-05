// Enveloppes de la clé de contenu `K_v` pour les terminaux (WP12, T051, R-08 et R-30.9) : `K_v` est
// rouverte UNE fois par version (`DecryptPort`), scellée pour chaque terminal par
// `sealForRecipient`
// (AAD `CASHLESS/SNAPKEY/v1`), puis mise à zéro AVANT toute écriture en base.
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (règle 4 de CLAUDE.md) : cryptographie et secrets en
// mémoire.
import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  sealForRecipient,
  snapshotKeyAad,
  TagFormatError,
  toWrappedKey,
  type WrappedKey,
} from '@cashless/tag-format';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { DECRYPT_PORT, KmsKeyError, type DecryptPort } from '../../kms/kms.ports';
import { zeroize } from '../../kms/zeroize';

export interface WrapTarget {
  deviceId: string;
  agreementPublicKey: Buffer;
  agreementKeySha256: Buffer;
}

export type WrapOutcome =
  | { deviceId: string; envelope: WrappedKey }
  | { deviceId: string; error: 'KEY_FINGERPRINT_MISMATCH' | 'BAD_AGREEMENT_KEY' };

export class ContentKeyUnreadableError extends Error {
  constructor() {
    super('Clé de contenu du snapshot illisible (CONTENT_KEY_UNREADABLE)');
    this.name = 'ContentKeyUnreadableError';
  }
}

@Injectable()
export class SnapshotKeyWrapper {
  constructor(
    @Inject(DECRYPT_PORT) private readonly kms: DecryptPort,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'tagWrappingKeyRef'>,
  ) {}

  /**
   * Scelle `K_v` de (grand livre, version) pour chaque terminal. Un terminal dont la clé d'accord
   * ne correspond pas à son empreinte, ou n'est pas un point P-256 valide, est écarté seul. `K_v`
   * est à zéro au retour, succès ou erreur. `KmsUnavailableError` remonte telle quelle.
   */
  async seal(
    group: { ledgerId: string; version: bigint; contentKeyWrapped: Buffer },
    targets: readonly WrapTarget[],
  ): Promise<WrapOutcome[]> {
    let kv: Buffer | undefined;
    try {
      try {
        kv = await this.kms.decrypt(this.config.tagWrappingKeyRef, group.contentKeyWrapped);
      } catch (error) {
        if (error instanceof KmsKeyError) throw new ContentKeyUnreadableError();
        throw error;
      }
      return targets.map((target) => this.sealOne(group, kv!, target));
    } finally {
      zeroize(kv);
    }
  }

  private sealOne(
    group: { ledgerId: string; version: bigint },
    kv: Buffer,
    target: WrapTarget,
  ): WrapOutcome {
    const actual = createHash('sha256').update(target.agreementPublicKey).digest();
    if (
      actual.length !== target.agreementKeySha256.length ||
      !timingSafeEqual(actual, target.agreementKeySha256)
    )
      return { deviceId: target.deviceId, error: 'KEY_FINGERPRINT_MISMATCH' };
    try {
      const blob = sealForRecipient({
        recipientPublicKey: target.agreementPublicKey,
        plaintext: kv,
        aad: snapshotKeyAad(group.ledgerId, group.version, target.deviceId),
      });
      return { deviceId: target.deviceId, envelope: toWrappedKey(blob) };
    } catch (error) {
      if (error instanceof TagFormatError && error.code === 'BAD_KEY')
        return { deviceId: target.deviceId, error: 'BAD_AGREEMENT_KEY' };
      throw error;
    }
  }
}
