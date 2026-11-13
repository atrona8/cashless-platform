// Autorité de test avec `basicConstraints CA:TRUE` : OpenSSL (TLS) refuse une chaîne dont l'émetteur
// n'est pas une autorité, ce que la fabrique de WP16 (`startup/_support/pki.ts`) ne pose pas.
import { webcrypto } from 'node:crypto';
import {
  BasicConstraintsExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  X509CertificateGenerator,
} from '@peculiar/x509';
export interface RealCa {
  certPem: string;
  keyPem: string;
  sign(
    subject: string,
    spki: Buffer,
    leaf?: { notBefore?: Date; notAfter?: Date },
  ): Promise<string>;
}

const subtle = webcrypto.subtle;
const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;

export async function makeRealCa(
  name: string,
  validity: { notBefore?: Date; notAfter?: Date } = {},
): Promise<RealCa> {
  const keys = await subtle.generateKey(ALG, true, ['sign', 'verify']);
  const notBefore = validity.notBefore ?? new Date(Date.now() - 3_600_000);
  const notAfter = validity.notAfter ?? new Date(Date.now() + 86_400_000);
  const cert = await X509CertificateGenerator.createSelfSigned({
    name,
    keys,
    signingAlgorithm: SIGNING,
    notBefore,
    notAfter,
    extensions: [
      new BasicConstraintsExtension(true, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    ],
  });
  const pkcs8 = Buffer.from(await subtle.exportKey('pkcs8', keys.privateKey));
  const b64 = (b: Buffer): string => (b.toString('base64').match(/.{1,64}/g) ?? []).join('\n');
  return {
    certPem: cert.toString('pem'),
    keyPem: `-----BEGIN PRIVATE KEY-----\n${b64(pkcs8)}\n-----END PRIVATE KEY-----\n`,
    async sign(subject, spki, leaf?: { notBefore?: Date; notAfter?: Date }) {
      const publicKey = await subtle.importKey('spki', spki, ALG, true, ['verify']);
      const issued = await X509CertificateGenerator.create({
        subject,
        issuer: cert.subject,
        publicKey,
        signingKey: keys.privateKey,
        signingAlgorithm: SIGNING,
        notBefore: leaf?.notBefore ?? new Date(Date.now() - 3_600_000),
        notAfter: leaf?.notAfter ?? new Date(Date.now() + 86_400_000),
      });
      return issued.toString('pem');
    },
  };
}
