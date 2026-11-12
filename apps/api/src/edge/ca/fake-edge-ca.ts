// Faux de l'autorité des passerelles (développement et tests seulement) : `isFake = true`, donc refusé au démarrage
// en production (`assertProcessIsSafe`, `l’autorité des passerelles`). Autorité éphémère, générée en mémoire, clé non
// exportable ; elle n'est écrite nulle part. L'adaptateur réel est la mission 12b.
import { createPublicKey, webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import type { EdgeCaPort } from '../edge-ca.port';

x509.cryptoProvider.set(webcrypto as never);

const EC_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DAY = 86_400_000;
const SERIAL = /^[0-9A-Za-z._-]{1,64}$/;

export class FakeEdgeCa implements EdgeCaPort {
  readonly isFake = true;

  private constructor(
    private readonly cert: x509.X509Certificate,
    private readonly signingKey: webcrypto.CryptoKey,
  ) {}

  static async inMemory(): Promise<FakeEdgeCa> {
    const keys = await webcrypto.subtle.generateKey(EC_P256, false, ['sign', 'verify']);
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: `01${Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString('hex')}`,
      name: 'CN=Autorite de test des passerelles Cashless (memoire)',
      notBefore: new Date(Date.now() - DAY),
      notAfter: new Date(Date.now() + 800 * DAY),
      signingAlgorithm: ECDSA_SHA256,
      keys,
      extensions: [
        new x509.BasicConstraintsExtension(true, 0, true),
        new x509.KeyUsagesExtension(
          x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
          true,
        ),
        await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      ],
    });
    return new FakeEdgeCa(cert, keys.privateKey);
  }

  caCertPem(): string {
    return this.cert.toString('pem');
  }

  async issue(csrPem: string, serial: string): Promise<string> {
    if (!SERIAL.test(serial)) throw new Error('numéro de série de passerelle invalide');
    const csr = new x509.Pkcs10CertificateRequest(csrPem);
    const key = createPublicKey({
      key: Buffer.from(csr.publicKey.rawData),
      format: 'der',
      type: 'spki',
    });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
      throw new Error('clé ECDSA P-256 attendue');
    if (!(await csr.verify())) throw new Error('CSR non signé par sa propre clé');
    const now = Date.now();
    const cert = await x509.X509CertificateGenerator.create({
      serialNumber: `01${Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString('hex')}`,
      subject: [{ CN: [serial] }],
      issuer: this.cert.subjectName,
      notBefore: new Date(now - 5 * 60_000),
      notAfter: new Date(now + 365 * DAY),
      signingAlgorithm: ECDSA_SHA256,
      publicKey: csr.publicKey,
      signingKey: this.signingKey,
      extensions: [
        new x509.BasicConstraintsExtension(false, undefined, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
        new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth], false),
        await x509.AuthorityKeyIdentifierExtension.create(this.cert, false),
        await x509.SubjectKeyIdentifierExtension.create(csr.publicKey, false),
      ],
    });
    return cert.toString('pem');
  }
}
