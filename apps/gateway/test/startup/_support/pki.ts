import 'reflect-metadata';
// Certificats de test (auto-signés, courbe P-256) et fichier d'enrôlement valide.
import { webcrypto, X509Certificate } from 'node:crypto';
import { X509CertificateGenerator } from '@peculiar/x509';
import type { HardwareKeystore } from '../../../src/key-store/hardware-keystore.port';
import type { EnrollmentFile } from '../../../src/enrollment/enrollment.service';

const subtle = webcrypto.subtle;
const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export interface TestCa {
  certPem: string;
  keyPem: string;
  sign(subject: string, spki: Buffer): Promise<string>;
}

export async function makeCa(name = 'CN=ca-test'): Promise<TestCa> {
  const keys = await subtle.generateKey(ALG, true, ['sign', 'verify']);
  const cert = await X509CertificateGenerator.createSelfSigned({
    name,
    keys,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    notBefore: new Date(Date.now() - 3_600_000),
    notAfter: new Date(Date.now() + 86_400_000),
  });
  const pkcs8 = Buffer.from(await subtle.exportKey('pkcs8', keys.privateKey));
  const b64 = (b: Buffer): string => (b.toString('base64').match(/.{1,64}/g) ?? []).join('\n');
  return {
    certPem: cert.toString('pem'),
    keyPem: `-----BEGIN PRIVATE KEY-----\n${b64(pkcs8)}\n-----END PRIVATE KEY-----\n`,
    async sign(subject, spki) {
      const publicKey = await subtle.importKey('spki', spki, ALG, true, ['verify']);
      const leaf = await X509CertificateGenerator.create({
        subject,
        issuer: cert.subject,
        publicKey,
        signingKey: keys.privateKey,
        signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
        notBefore: new Date(Date.now() - 3_600_000),
        notAfter: new Date(Date.now() + 86_400_000),
      });
      return leaf.toString('pem');
    },
  };
}

export async function makeSiteKey(): Promise<string> {
  const keys = await subtle.generateKey(ALG, true, ['sign', 'verify']);
  return Buffer.from(await subtle.exportKey('spki', keys.publicKey)).toString('base64');
}

export async function makeEnrollmentFile(
  keystore: HardwareKeystore,
  overrides: Partial<EnrollmentFile> = {},
): Promise<EnrollmentFile> {
  const ca = await makeCa();
  const device = await makeCa('CN=device-ca-test');
  const serial = 'GW-TEST-1';
  const file: EnrollmentFile = {
    gateway_id: '11111111-1111-4111-8111-111111111111',
    operator_id: '22222222-2222-4222-8222-222222222222',
    event_id: '33333333-3333-4333-8333-333333333333',
    ledger_id: '44444444-4444-4444-8444-444444444444',
    serial,
    role: 'PRIMARY',
    central_url: 'https://central.example.test',
    central_ca_pem: ca.certPem,
    device_ca_pem: device.certPem,
    client_cert_pem: await ca.sign(`CN=${serial}`, await keystore.publicKey('batch')),
    lan_authority: 'passerelle.site.test:8443',
    site_order_keys: [
      { holder: 'Responsable A', public_key: await makeSiteKey() },
      { holder: 'Responsable B', public_key: await makeSiteKey() },
    ],
    ...overrides,
  };
  new X509Certificate(file.client_cert_pem);
  return file;
}
