// Autorité des terminaux (contracts/device-tokens.md « Ports », research R-09, plan IC-08) : émet le certificat client
// d'un terminal à partir d'un CSR vérifié. Aujourd'hui seul un faux existe (refusé en production) ; l'adaptateur réel
// (KMS ou AWS Private CA, SPECIFICATION §13.2) arrive après OP-N11, hors mission (C-004).
import { createHash, createPublicKey, webcrypto, type KeyObject } from 'node:crypto';
import * as x509 from '@peculiar/x509';

export { DEVICE_CA } from '../security/port-tokens';

// Types DOM absents (lib ES2022) : `webcrypto` de Node est le fournisseur attendu.
x509.cryptoProvider.set(webcrypto as never);

/** Demande de certificat PKCS#10, déjà analysée par l'appelant (`new x509.Pkcs10CertificateRequest(pem)`). */
export type Pkcs10 = x509.Pkcs10CertificateRequest;

/** Sujet imposé par le serveur : le sujet demandé par le CSR n'est jamais recopié (R-09). */
export interface DeviceSubject {
  deviceId: string;
  operatorId: string;
}

export interface IssuedDeviceCertificate {
  pem: string;
  /** Empreinte SHA-256 du certificat (DER) : `device.cert_sha256`. */
  sha256: Buffer;
  notAfter: Date;
}

export interface DeviceCaPort {
  readonly isFake?: boolean;
  issue(csr: Pkcs10, subject: DeviceSubject, notAfter: Date): Promise<IssuedDeviceCertificate>;
  /** Autorité(s) des terminaux, PEM : `httpsOptions.ca`. */
  caCertificatesPem(): string[];
}

/** Demande de certificat refusée (signature, clé ou sujet invalides) : l'enrôlement la traduit en refus 4xx. */
export class DeviceCsrError extends Error {
  constructor(readonly reason: string) {
    super(`Demande de certificat refusée : ${reason}`);
    this.name = 'DeviceCsrError';
  }
}

const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const FIVE_MINUTES = 5 * 60_000;
/** Valeurs de sujet admises : identifiants (UUID), jamais un texte libre. */
const IDENTIFIER = /^[0-9A-Za-z-]{1,64}$/;

/** Source d'aléa du numéro de série (injectable pour les tests). */
export type RandomBytes = (length: number) => Uint8Array;

const secureRandom: RandomBytes = (length) => webcrypto.getRandomValues(new Uint8Array(length));

/**
 * Numéro de série : 128 bits aléatoires précédés de l'octet 0x01, en hexadécimal (34 caractères, 17 octets).
 * `@peculiar/x509` lit la chaîne en hexadécimal, supprime les octets nuls de tête et ajoute 0x00 devant un premier
 * octet ≥ 0x80. Sans préfixe, un premier octet aléatoire nul raccourcirait la série (tirage 1 sur 256) et un premier
 * octet ≥ 0x80 l'allongerait. L'octet 0x01 fixe la longueur à 17 octets en DER, garde l'entier positif et conserve
 * les 128 bits aléatoires (RFC 5280 §4.1.2.2 : 20 octets au plus).
 */
export function randomSerial(random: RandomBytes = secureRandom): string {
  const bytes = random(16);
  if (bytes.length !== 16) throw new Error('16 octets aléatoires attendus');
  return `01${Buffer.from(bytes).toString('hex')}`;
}

/** La clé du CSR doit être une clé EC P-256 (spec : clé de signature du terminal, FR-003). */
function assertP256(csr: Pkcs10): void {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: Buffer.from(csr.publicKey.rawData), format: 'der', type: 'spki' });
  } catch {
    throw new DeviceCsrError('clé publique illisible');
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new DeviceCsrError('clé ECDSA P-256 attendue');
}

/**
 * Émission commune (R-09) : CSR signé par sa propre clé, clé P-256, sujet `CN=<device_id>, O=<operator_id>` imposé,
 * extensions fixées par le serveur (celles demandées par le CSR sont ignorées), série aléatoire de 128 bits,
 * `notBefore` = maintenant − 5 min.
 */
export async function issueDeviceCertificate(
  authority: { cert: x509.X509Certificate; signingKey: webcrypto.CryptoKey },
  csr: Pkcs10,
  subject: DeviceSubject,
  notAfter: Date,
  now: Date = new Date(),
  random: RandomBytes = secureRandom,
): Promise<IssuedDeviceCertificate> {
  if (!IDENTIFIER.test(subject.deviceId) || !IDENTIFIER.test(subject.operatorId))
    throw new DeviceCsrError('identifiant de sujet invalide');
  assertP256(csr);
  let signed: boolean;
  try {
    signed = await csr.verify();
  } catch {
    signed = false;
  }
  if (!signed) throw new DeviceCsrError('CSR non signé par sa propre clé');
  const notBefore = new Date(now.getTime() - FIVE_MINUTES);
  if (!(notAfter.getTime() > now.getTime())) throw new DeviceCsrError('échéance déjà passée');
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerial(random),
    subject: [{ CN: [subject.deviceId] }, { O: [subject.operatorId] }],
    issuer: authority.cert.subjectName,
    notBefore,
    notAfter,
    signingAlgorithm: ECDSA_SHA256,
    publicKey: csr.publicKey,
    signingKey: authority.signingKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth], false),
      await x509.AuthorityKeyIdentifierExtension.create(authority.cert, false),
      await x509.SubjectKeyIdentifierExtension.create(csr.publicKey, false),
    ],
  });
  const der = Buffer.from(cert.rawData);
  return {
    pem: cert.toString('pem'),
    sha256: createHash('sha256').update(der).digest(),
    notAfter: cert.notAfter,
  };
}
