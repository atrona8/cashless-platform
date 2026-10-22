// Faux de l'autorité des terminaux (plan IC-08) : jamais en production (la fabrique de `device-ca.module.ts` lève
// `FakeInProductionError`, `assertProcessIsSafe` refuse le démarrage). Aucune clé dans le dépôt : l'autorité de test
// est lue des fichiers produits à l'exécution par `test/support/tls.ts` (`DEVICE_CA_FAKE_KEY_FILE`,
// `DEVICE_CA_CERT_FILE` : le serveur HTTPS de test fait ainsi confiance aux certificats émis à l'enrôlement), ou
// générée en mémoire quand aucun de ces réglages n'est posé (tests unitaires).
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import {
  issueDeviceCertificate,
  randomSerial,
  type DeviceCaPort,
  type DeviceSubject,
  type IssuedDeviceCertificate,
  type Pkcs10,
} from './device-ca.port';

const EC_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DAY = 86_400_000;

export interface FakeDeviceCaFiles {
  /** Certificat de l'autorité de test (PEM). */
  certFile: string;
  /** Clé privée PKCS#8 de l'autorité de test (PEM). */
  keyFile: string;
}

export class FakeDeviceCa implements DeviceCaPort {
  readonly isFake = true;

  private constructor(
    private readonly cert: x509.X509Certificate,
    private readonly signingKey: webcrypto.CryptoKey,
  ) {}

  /** Autorité de test lue des fichiers réglés. La clé doit correspondre au certificat. */
  static async fromFiles(files: FakeDeviceCaFiles): Promise<FakeDeviceCa> {
    const cert = new x509.X509Certificate(readFileSync(files.certFile, 'utf8'));
    const pkcs8 = x509.PemConverter.decodeFirst(readFileSync(files.keyFile, 'utf8'));
    const signingKey = await webcrypto.subtle.importKey('pkcs8', pkcs8, EC_P256, false, ['sign']);
    const ca = new FakeDeviceCa(cert, signingKey);
    await ca.assertKeyMatchesCertificate();
    return ca;
  }

  /** Autorité générée en mémoire (aucun fichier) : clé non exportable, valable 800 jours. */
  static async inMemory(): Promise<FakeDeviceCa> {
    const keys = await webcrypto.subtle.generateKey(EC_P256, false, ['sign', 'verify']);
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: randomSerial(),
      name: 'CN=Autorite de test des terminaux Cashless (memoire)',
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
    return new FakeDeviceCa(cert, keys.privateKey);
  }

  issue(csr: Pkcs10, subject: DeviceSubject, notAfter: Date): Promise<IssuedDeviceCertificate> {
    return issueDeviceCertificate(
      { cert: this.cert, signingKey: this.signingKey },
      csr,
      subject,
      notAfter,
    );
  }

  caCertificatesPem(): string[] {
    return [this.cert.toString('pem')];
  }

  /** Une clé qui ne correspond pas au certificat émettrait des certificats que le serveur refuserait : on s'arrête. */
  private async assertKeyMatchesCertificate(): Promise<void> {
    const probe = Buffer.from('cashless-device-ca-key-check');
    const signature = await webcrypto.subtle.sign(ECDSA_SHA256, this.signingKey, probe);
    const publicKey = await this.cert.publicKey.export(EC_P256, ['verify']);
    if (!(await webcrypto.subtle.verify(ECDSA_SHA256, publicKey, signature, probe)))
      throw new Error('DEVICE_CA_FAKE_KEY_FILE ne correspond pas à DEVICE_CA_CERT_FILE');
  }
}
