// Côté API du PIN des vendeurs (mission 5b, lot WP08 ; mission 11a, lot WP06, OP-N76 levée).
// Depuis la mission 11a, l'API ne détient PLUS le secret des empreintes : `hash`, `verify` et
// l'empreinte factice sont dans `vendor-pin.digester.ts`, atteignable du seul processus `vendor-pin`.
// Reste ici : le motif du PIN, les paramètres argon2id figés (partagés avec le processus) et le
// dérivé d'idempotence du PIN (ADR-126), sous son propre secret.
//
// Aucune méthode ne journalise le PIN ni un dérivé ; une erreur d'argon2 est relancée sans son
// message (qui pourrait citer l'entrée).
import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { PIN_PATTERN } from '../common/pin-pattern';

/** Motif du PIN : défini dans un module neutre (`common/pin-pattern.ts`), réexporté ici. */
export { PIN_PATTERN };

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
  constructor(
    private readonly idempotencySecret: Buffer,
    private readonly impl: Argon2Impl = argon2,
  ) {
    if (idempotencySecret.length < 32)
      throw new Error('VENDOR_PIN_IDEMPOTENCY_SECRET : 32 octets au moins attendus');
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

  /** Vérifie que le binaire d'argon2 calcule un dérivé (appelé au démarrage par le module) ; idempotent. */
  async ready(): Promise<void> {
    await this.idempotencyBody({ pin: '000000' }, ['pin'], 'ready', 'ready');
  }
}
