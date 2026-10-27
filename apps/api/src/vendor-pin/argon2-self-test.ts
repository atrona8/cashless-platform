// Test d'argon2 au démarrage (mission 5b, lot WP08 ; A16, NFR-009 ; research R-01 ;
// contracts/vendors.md, « Secret VENDOR_PIN_SECRET »). Échec → exception → démarrage refusé.
//
// 1. Vecteur connu INDÉPENDANT du binaire : RFC 9106 §5.3 (Argon2id) — mot de passe 32 × 0x01,
//    sel 16 × 0x02, secret 8 × 0x03, données associées 12 × 0x04, m = 32 Kio, t = 3, p = 4,
//    version 0x13, sortie brute de 32 octets. L'étiquette attendue est recopiée du texte de la RFC
//    (pas calculée par le binaire) : elle prouve que le binaire chargé calcule argon2id ET applique
//    le secret (un binaire qui l'ignorerait donnerait une autre étiquette).
// 2. Aller-retour avec le vrai secret : `hash` puis `verify` vrai, autre PIN faux, et une empreinte
//    calculée SANS secret refusée (le secret est bien appliqué à la vérification).
// Précision du plan (« empreinte calculée avec le secret ») : un vecteur figé avec le secret de
// production est impossible (le secret n'est connu que du déploiement) ; le secret de production
// est donc éprouvé par l'aller-retour (2), le calcul lui-même par le vecteur de la RFC (1).
import { timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { VENDOR_PIN_PARAMS, type Argon2Impl, type VendorPinHasher } from './vendor-pin.hasher';

/** RFC 9106 §5.3, « Tag[32] » d'Argon2id, recopié du texte de la RFC. */
export const RFC9106_ARGON2ID_TAG = Buffer.from(
  '0d 64 0d f5 8d 78 76 6c 08 c0 37 a3 4a 8b 53 c9 d0 1e f0 45 2d 75 b6 5e b5 25 20 e9 6b 01 e6 59'.replace(
    / /g,
    '',
  ),
  'hex',
);

export class Argon2SelfTestError extends Error {
  constructor(step: string) {
    super(`argon2 : test au démarrage échoué (${step}) ; démarrage refusé`);
    this.name = 'Argon2SelfTestError';
  }
}

/** Étape 1 : vecteur de la RFC 9106 §5.3. */
export async function checkRfc9106Vector(impl: Argon2Impl = argon2): Promise<void> {
  let tag: Buffer;
  try {
    tag = await impl.hash(Buffer.alloc(32, 0x01), {
      type: argon2.argon2id,
      version: 0x13,
      memoryCost: 32,
      timeCost: 3,
      parallelism: 4,
      hashLength: 32,
      salt: Buffer.alloc(16, 0x02),
      secret: Buffer.alloc(8, 0x03),
      associatedData: Buffer.alloc(12, 0x04),
      raw: true,
    });
  } catch {
    throw new Argon2SelfTestError('vecteur RFC 9106 : calcul impossible');
  }
  if (
    !Buffer.isBuffer(tag) ||
    tag.length !== RFC9106_ARGON2ID_TAG.length ||
    !timingSafeEqual(tag, RFC9106_ARGON2ID_TAG)
  )
    throw new Argon2SelfTestError('vecteur RFC 9106 §5.3 différent');
}

/** Étape 2 : aller-retour avec le secret du déploiement (PIN de test, jamais journalisé). */
export async function checkRoundTrip(
  hasher: VendorPinHasher,
  impl: Argon2Impl = argon2,
): Promise<void> {
  const pin = '246813';
  const digest = await hasher.hash(pin);
  if (!digest.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'))
    throw new Argon2SelfTestError('empreinte hors des paramètres figés');
  if (!(await hasher.verify(digest, pin))) throw new Argon2SelfTestError('aller-retour refusé');
  if (await hasher.verify(digest, '135792')) throw new Argon2SelfTestError('autre PIN accepté');
  const withoutSecret = await impl.hash(pin, { ...VENDOR_PIN_PARAMS });
  if (await hasher.verify(withoutSecret, pin))
    throw new Argon2SelfTestError('empreinte sans secret acceptée');
  if (await hasher.verify(null, pin)) throw new Argon2SelfTestError('empreinte factice acceptée');
}

/** Les deux étapes, dans l'ordre ; appelé par `VendorPinModule.onModuleInit`. */
export async function runArgon2SelfTest(
  hasher: VendorPinHasher,
  impl: Argon2Impl = argon2,
): Promise<void> {
  await checkRfc9106Vector(impl);
  await hasher.ready();
  await checkRoundTrip(hasher, impl);
}
