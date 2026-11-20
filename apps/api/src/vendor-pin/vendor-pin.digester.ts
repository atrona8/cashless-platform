// Empreinte du PIN des vendeurs (mission 5b, lot WP08 ; mission 11a, lot WP06, OP-N76 levée ;
// FR-003, FR-005, NFR-002, NFR-004 ; research R-01, R-10). argon2id, paramètres figés, secret des
// PIN hors de la base : la base ne voit que l'empreinte PHC (`$argon2id$v=19$…`).
//
// Ce fichier détient le secret : seul le processus `vendor-pin` l'atteint (test d'architecture).
// L'API ne voit que `vendor-pin.hasher.ts` (motif, paramètres, dérivé d'idempotence).
//
// Règles tenues ici :
// - le PIN fait exactement 6 chiffres ; refus sans écho de la valeur ;
// - `verify` calcule TOUJOURS un argon2 : sans empreinte (vendeur inconnu, bloqué, désactivé, d'un
//   autre commerçant), la vérification porte sur l'empreinte factice, calculée au démarrage depuis
//   32 octets aléatoires (hors motif : jamais égale à un PIN), mêmes paramètres et même secret, et
//   rend faux (même durée qu'un vrai refus, NFR-004) ;
// - aucune méthode ne journalise le PIN ni l'empreinte ; une erreur d'argon2 est relancée sans son
//   message (qui pourrait citer l'entrée).
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { ProblemException } from '../errors/problem';
import { PIN_PATTERN } from '../common/pin-pattern';
import { VENDOR_PIN_PARAMS, VendorPinHashError, type Argon2Impl } from './vendor-pin.hasher';

export class VendorPinDigester {
  private dummy?: Promise<string>;

  constructor(
    private readonly secret: Buffer,
    private readonly impl: Argon2Impl = argon2,
  ) {
    if (secret.length < 32) throw new Error('secret des PIN : 32 octets au moins attendus');
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
