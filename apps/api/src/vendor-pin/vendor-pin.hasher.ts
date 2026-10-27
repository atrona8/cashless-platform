// Empreinte du PIN des vendeurs (mission 5b, lot WP08 ; FR-003, NFR-002, NFR-004 ; research R-01,
// R-10 ; contracts/vendors.md, « Empreinte du PIN »). argon2id, paramètres figés, secret
// `VENDOR_PIN_SECRET` hors de la base : la base ne voit que l'empreinte PHC (`$argon2id$v=19$…`).
//
// Règles tenues ici :
// - le PIN fait exactement 6 chiffres ; refus sans écho de la valeur ;
// - `verify` calcule TOUJOURS un argon2 : sans empreinte (vendeur inconnu, bloqué, désactivé, d'un
//   autre commerçant), la vérification porte sur l'empreinte factice, calculée au démarrage depuis
//   32 octets aléatoires (hors motif : jamais égale à un PIN), mêmes paramètres et même secret, et
//   rend faux (même durée qu'un vrai refus, NFR-004) ;
// - aucune méthode ne journalise le PIN ni l'empreinte ; une erreur d'argon2 est relancée sans son
//   message (qui pourrait citer l'entrée).
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { ProblemException } from '../errors/problem';

/** Motif du PIN (contracts/vendors.md) : exactement 6 chiffres. */
export const PIN_PATTERN = /^[0-9]{6}$/;

/** Paramètres argon2id figés (R-01 : minimum OWASP). Sel de 16 octets tiré par argon2. */
export const VENDOR_PIN_PARAMS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
  version: 0x13,
});

/** Ce que le hacheur lit d'argon2 (remplaçable en test pour simuler un binaire faux). */
export interface Argon2Impl {
  hash(password: Buffer | string, options: argon2.Options & { raw: true }): Promise<Buffer>;
  hash(password: Buffer | string, options?: argon2.Options & { raw?: false }): Promise<string>;
  verify(
    digest: string,
    password: Buffer | string,
    options?: { secret?: Buffer },
  ): Promise<boolean>;
}

/** Erreur d'argon2 relancée sans le message d'origine (jamais le PIN ni l'empreinte). */
export class VendorPinHashError extends Error {
  constructor(operation: 'hash' | 'verify', cause: unknown) {
    super(
      `VendorPinHasher.${operation} : échec d'argon2 (${cause instanceof Error ? cause.name : 'inconnu'})`,
    );
    this.name = 'VendorPinHashError';
  }
}

export class VendorPinHasher {
  private dummy?: Promise<string>;

  constructor(
    private readonly secret: Buffer,
    private readonly idempotencySecret: Buffer,
    private readonly impl: Argon2Impl = argon2,
  ) {
    if (secret.length < 32) throw new Error('VENDOR_PIN_SECRET : 32 octets au moins attendus');
    if (idempotencySecret.length < 32)
      throw new Error('VENDOR_PIN_IDEMPOTENCY_SECRET : 32 octets au moins attendus');
    if (secret.equals(idempotencySecret))
      throw new Error('VENDOR_PIN_SECRET et VENDOR_PIN_IDEMPOTENCY_SECRET : secrets distincts');
  }

  /** Empreinte PHC d'un PIN de 6 chiffres ; sinon `422 VALIDATION_FAILED`, sans écho. */
  async hash(pin: string): Promise<string> {
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin))
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: 'Le PIN doit compter exactement 6 chiffres.',
      });
    try {
      return await this.impl.hash(pin, { ...VENDOR_PIN_PARAMS, secret: this.secret });
    } catch (error) {
      throw new VendorPinHashError('hash', error);
    }
  }

  /**
   * Vrai seulement si `pinHash` est posé et que `pin` (6 chiffres) lui correspond. Toujours un
   * calcul argon2, y compris sans empreinte ou avec un PIN hors motif.
   */
  async verify(pinHash: string | null, pin: string): Promise<boolean> {
    const digest = pinHash ?? (await this.dummyHash());
    const candidate = typeof pin === 'string' ? pin : '';
    let matches: boolean;
    try {
      matches = await this.impl.verify(digest, candidate, { secret: this.secret });
    } catch (error) {
      throw new VendorPinHashError('verify', error);
    }
    return pinHash !== null && PIN_PATTERN.test(candidate) && matches;
  }

  /**
   * ADR-126 : copie du corps d'une requête idempotente où chaque champ PIN est remplacé par un dérivé
   * argon2id déterministe (mêmes paramètres que l'empreinte du PIN, mais sous son propre secret
   * `VENDOR_PIN_IDEMPOTENCY_SECRET` ; sel tiré de la portée et de la clé d'idempotence). Le rejeu
   * reste lié au PIN, et un registre volé avec la clé HMAC ne se force pas plus vite que
   * `vendor.pin_hash`, sans que l'un des deux secrets serve à attaquer l'autre. Une valeur qui n'est pas un PIN de 6
   * chiffres (refusée plus loin en 422) est remplacée par un repère constant, sans argon2. Un corps
   * qui n'est pas un objet est rendu tel quel.
   */
  async idempotencyBody(
    body: unknown,
    fields: readonly string[],
    scope: string,
    key: string,
  ): Promise<unknown> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
    const masked: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    const salt = createHash('sha256')
      .update(`vendor-pin-idempotency\n${scope}\n${key}`, 'utf8')
      .digest()
      .subarray(0, 16);
    for (const field of fields) {
      if (!(field in masked)) continue;
      const value = masked[field];
      if (typeof value !== 'string' || !PIN_PATTERN.test(value)) {
        masked[field] = 'pin-invalide';
        continue;
      }
      try {
        const raw = await this.impl.hash(value, {
          ...VENDOR_PIN_PARAMS,
          secret: this.idempotencySecret,
          salt,
          raw: true,
        });
        masked[field] = `argon2id:${raw.toString('hex')}`;
      } catch (error) {
        throw new VendorPinHashError('hash', error);
      }
    }
    return masked;
  }

  /** Calcule l'empreinte factice (appelé au démarrage par le module) ; idempotent. */
  async ready(): Promise<void> {
    await this.dummyHash();
  }

  private dummyHash(): Promise<string> {
    // 32 octets aléatoires : jamais un PIN de 6 chiffres. Mêmes paramètres, même secret.
    this.dummy ??= this.impl
      .hash(randomBytes(32), { ...VENDOR_PIN_PARAMS, secret: this.secret })
      .catch((error: unknown) => {
        this.dummy = undefined;
        throw new VendorPinHashError('hash', error);
      });
    return this.dummy;
  }
}
