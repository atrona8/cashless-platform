// Empreinte à clé des codes de rattachement et des codes de confirmation (mission bracelets-nfc, research R-06,
// contracts/claim-codes.md). Un code fait 50 bits et un code de confirmation 6 chiffres : une empreinte simple se
// retrouverait par essais si la base fuyait. Le secret (`CLAIM_CODE_HMAC_KEY`) vit hors de la base ; ce fichier est le
// seul à le lire. La base ne stocke et ne compare que ces empreintes.
import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { normalizeClaimCode, uuidToBytes } from '@cashless/tag-format';
import { APP_CONFIG, type AppConfig } from '../config/config';

const CLAIM_PREFIX = Buffer.from('CASHLESS/CLAIM/v1', 'ascii');
const CONFIRM_PREFIX = Buffer.from('CASHLESS/CLAIM-CONFIRM/v1', 'ascii');
const DIGITS = /^[0-9]{6}$/;

@Injectable()
export class ClaimHasher {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, 'claimCodeHmacKey'>) {
    this.key = config.claimCodeHmacKey;
  }

  /** Empreinte d'un code de rattachement ; la saisie est normalisée (tirets, espaces, casse), un code mal formé lève. */
  claimCodeHash(code: string): Buffer {
    return createHmac('sha256', this.key)
      .update(CLAIM_PREFIX)
      .update(normalizeClaimCode(code), 'ascii')
      .digest();
  }

  /** Empreinte du code de confirmation d'une demande en attente, liée à cette demande. */
  confirmationHash(claimId: string, digits: string): Buffer {
    if (!DIGITS.test(digits)) throw new Error('Code de confirmation : 6 chiffres attendus');
    return createHmac('sha256', this.key)
      .update(CONFIRM_PREFIX)
      .update(uuidToBytes(claimId))
      .update(digits, 'ascii')
      .digest();
  }

  /** Référence d'une adresse appelante (consultation anonyme) : jamais l'adresse en clair en base. */
  addressRef(address: string): string {
    return createHmac('sha256', this.key)
      .update('CASHLESS/CLAIM-ADDR/v1')
      .update(address)
      .digest('hex')
      .slice(0, 32);
  }
}
