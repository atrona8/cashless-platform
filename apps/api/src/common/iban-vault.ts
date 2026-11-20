// Coffre d'IBAN (mission durcissements-serveur, lot WP08, OP-N140, FR-010).
// Chiffrement applicatif AES-256-GCM d'un IBAN lié au prestataire.
// Format : `enc:v1:<kid>:<base64url(iv12 ‖ chiffré ‖ tag16)>`, données associées (AAD)
// `CASHLESS/IBAN/v1|<operator_id>`. IV de 12 octets aléatoires à chaque `seal`.
// Anneau de clés lu en configuration de l'API (décision du porteur du 18/11/2026) : plusieurs clés
// en lecture, une seule (`kid` actif) en écriture. Limite résiduelle : la clé est dans le processus
// public ; levée par un vrai KMS (OP-N41). Aucun message d'erreur ne cite la valeur, l'enveloppe
// ni la clé.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Global, Injectable, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';

const PREFIX = 'enc:v1:';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const KID = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Erreur nommée du coffre : message fixe, jamais de valeur, d'enveloppe ni de clé. */
export class IbanVaultError extends Error {
  constructor(
    readonly code:
      | 'IBAN_VAULT_CONFIG'
      | 'IBAN_VAULT_ALREADY_SEALED'
      | 'IBAN_VAULT_BAD_FORMAT'
      | 'IBAN_VAULT_UNKNOWN_KID'
      | 'IBAN_VAULT_OPEN_FAILED',
  ) {
    super(code);
    this.name = 'IbanVaultError';
  }
}

function aad(operatorId: string): Buffer {
  return Buffer.from(`CASHLESS/IBAN/v1|${operatorId}`, 'utf8');
}

@Injectable()
export class IbanVault {
  readonly #keys: ReadonlyMap<string, Buffer>;
  readonly #activeKid: string;

  constructor(keyring: ReadonlyMap<string, Buffer>, activeKid: string) {
    for (const [kid, key] of keyring) {
      if (!KID.test(kid) || key.length !== KEY_LENGTH)
        throw new IbanVaultError('IBAN_VAULT_CONFIG');
    }
    if (!keyring.has(activeKid)) throw new IbanVaultError('IBAN_VAULT_CONFIG');
    this.#keys = new Map(keyring);
    this.#activeKid = activeKid;
  }

  /** Vrai si la valeur est une enveloppe `enc:v1:` (préfixe exact, sensible à la casse). */
  isSealed(value: string): boolean {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  /** Chiffre un IBAN (déjà normalisé par l'appelant) lié à `operatorId`, avec le `kid` actif. */
  seal(iban: string, operatorId: string): string {
    if (this.isSealed(iban)) throw new IbanVaultError('IBAN_VAULT_ALREADY_SEALED');
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.#keys.get(this.#activeKid)!, iv, {
      authTagLength: TAG_LENGTH,
    });
    cipher.setAAD(aad(operatorId));
    const body = Buffer.concat([cipher.update(iban, 'utf8'), cipher.final()]);
    const packed = Buffer.concat([iv, body, cipher.getAuthTag()]);
    return `${PREFIX}${this.#activeKid}:${packed.toString('base64url')}`;
  }

  /** Ouvre une enveloppe ; toute anomalie lève une erreur nommée, jamais le clair en repli. */
  open(envelope: string, operatorId: string): string {
    if (typeof envelope !== 'string' || !envelope.startsWith(PREFIX))
      throw new IbanVaultError('IBAN_VAULT_BAD_FORMAT');
    const rest = envelope.slice(PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep < 1) throw new IbanVaultError('IBAN_VAULT_BAD_FORMAT');
    const kid = rest.slice(0, sep);
    const payload = rest.slice(sep + 1);
    if (!KID.test(kid) || !BASE64URL.test(payload))
      throw new IbanVaultError('IBAN_VAULT_BAD_FORMAT');
    const packed = Buffer.from(payload, 'base64url');
    if (packed.length < IV_LENGTH + TAG_LENGTH + 1)
      throw new IbanVaultError('IBAN_VAULT_BAD_FORMAT');
    const key = this.#keys.get(kid);
    if (!key) throw new IbanVaultError('IBAN_VAULT_UNKNOWN_KID');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, IV_LENGTH), {
        authTagLength: TAG_LENGTH,
      });
      decipher.setAAD(aad(operatorId));
      decipher.setAuthTag(packed.subarray(packed.length - TAG_LENGTH));
      const clear = Buffer.concat([
        decipher.update(packed.subarray(IV_LENGTH, packed.length - TAG_LENGTH)),
        decipher.final(),
      ]);
      return clear.toString('utf8');
    } catch {
      // Message fixe : l'erreur d'origine peut décrire le contexte, jamais la valeur.
      throw new IbanVaultError('IBAN_VAULT_OPEN_FAILED');
    }
  }

  toString(): string {
    return 'IbanVault';
  }

  toJSON(): string {
    return 'IbanVault';
  }
}

/** Fourni au seul processus public (`app.module.ts`) : aucun autre processus n'a l'anneau. */
@Global()
@Module({
  providers: [
    {
      provide: IbanVault,
      inject: [APP_CONFIG],
      useFactory: (config: Pick<AppConfig, 'ibanKeyring' | 'ibanActiveKid'>) =>
        new IbanVault(config.ibanKeyring, config.ibanActiveKid),
    },
  ],
  exports: [IbanVault],
})
export class IbanVaultModule {}
