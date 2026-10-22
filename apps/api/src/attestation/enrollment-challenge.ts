// Défis d'enrôlement (research R-08). Fonctions pures, partagées par le vérificateur et le terminal de test (WP12).
//
// Encodage : préfixe de domaine ASCII fixe, puis chaque champ précédé de sa longueur sur 4 octets (gros-boutiste).
// Les préfixes de domaine diffèrent dès leur 20e octet (aucun n'est préfixe d'un autre) et chaque champ porte sa
// longueur : deux suites de champs différentes ne donnent jamais la même entrée de SHA-256 (pas d'ambiguïté de
// concaténation). Le code et le `serial` sont encodés en UTF-8, les SPKI en DER brut.
//
// Ordre imposé sur Android : le terminal scanne le code, PUIS génère la clé d'accord (défi A), puis la clé de signature
// (défi S, qui lie la clé d'accord). Sur iOS, `clientDataHash` lie les deux clés publiques (la clé App Attest est
// distincte, limite consignée en R-06).
import { createHash } from 'node:crypto';

const ANDROID_AGREE_DOMAIN = 'cashless-enroll-v1/agree';
const ANDROID_SIGN_DOMAIN = 'cashless-enroll-v1/sign';
const IOS_DOMAIN = 'cashless-enroll-v1/ios';

function field(value: Buffer | string, name: string): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  if (bytes.length === 0) throw new Error(`défi d’enrôlement : ${name} vide`);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function challenge(domain: string, fields: Array<[Buffer | string, string]>): Buffer {
  const hash = createHash('sha256').update(Buffer.from(domain, 'ascii'));
  for (const [value, name] of fields) hash.update(field(value, name));
  return hash.digest();
}

/** `A = SHA-256("cashless-enroll-v1/agree" ‖ code ‖ serial)` : défi de la clé d'accord Android. */
export function androidAgreeChallenge(code: string, serial: string): Buffer {
  return challenge(ANDROID_AGREE_DOMAIN, [
    [code, 'code'],
    [serial, 'serial'],
  ]);
}

/** `S = SHA-256("cashless-enroll-v1/sign" ‖ code ‖ serial ‖ SPKI accord)` : défi de la clé de signature Android. */
export function androidSignChallenge(code: string, serial: string, agreementSpki: Buffer): Buffer {
  return challenge(ANDROID_SIGN_DOMAIN, [
    [code, 'code'],
    [serial, 'serial'],
    [agreementSpki, 'SPKI de la clé d’accord'],
  ]);
}

/** `clientDataHash = SHA-256("cashless-enroll-v1/ios" ‖ code ‖ serial ‖ SPKI signature ‖ SPKI accord)`. */
export function iosClientDataHash(
  code: string,
  serial: string,
  signingSpki: Buffer,
  agreementSpki: Buffer,
): Buffer {
  return challenge(IOS_DOMAIN, [
    [code, 'code'],
    [serial, 'serial'],
    [signingSpki, 'SPKI de la clé de signature'],
    [agreementSpki, 'SPKI de la clé d’accord'],
  ]);
}
