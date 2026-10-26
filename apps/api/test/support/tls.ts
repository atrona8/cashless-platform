// Certificats de test du serveur HTTPS (mission identite-enrolement-terminaux, research R-03) : générés à l'exécution
// dans un répertoire temporaire privé, jamais écrits dans le dépôt. Une fois par fichier de test (Jest isole le
// registre des modules de chaque fichier ; la génération ne prend que quelques millisecondes).
// - autorité DE TEST des terminaux (certificat et clé) : `DEVICE_CA_CERT_FILE`, seule autorité cliente du mTLS, et
//   `DEVICE_CA_FAKE_KEY_FILE`, lue par le faux de l'autorité qui émet les certificats à l'enrôlement ; le serveur de
//   test fait donc confiance aux certificats émis par ce faux ;
// - autorité de test du SERVEUR, distincte, et certificat serveur pour `localhost` et 127.0.0.1 : `TLS_CERT_FILE`,
//   `TLS_KEY_FILE` ; les clients de test font confiance à `serverCaPem`.
import 'reflect-metadata';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as x509 from '@peculiar/x509';

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;

const crypto = webcrypto;
// Types DOM absents (lib ES2022) : `webcrypto` de Node est le fournisseur attendu.
x509.cryptoProvider.set(crypto as never);

const EC_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DAY = 86_400_000;

export interface TestTls {
  dir: string;
  tlsCertFile: string;
  tlsKeyFile: string;
  deviceCaCertFile: string;
  deviceCaFakeKeyFile: string;
  /** Autorité du certificat serveur : `ca` des clients HTTPS de test. */
  serverCaPem: string;
  /** Autorité de test des terminaux (PEM), pour les tests qui émettent eux-mêmes un certificat client. */
  deviceCaCertPem: string;
  deviceCaKeyPem: string;
}

async function keyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(EC_P256, true, ['sign', 'verify']);
}

async function pkcs8Pem(key: CryptoKey): Promise<string> {
  return x509.PemConverter.encode(await crypto.subtle.exportKey('pkcs8', key), 'PRIVATE KEY');
}

/** Numéro de série aléatoire de 128 bits, premier bit nul (entier positif). */
function serial(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = bytes[0]! & 0x7f;
  return Buffer.from(bytes).toString('hex');
}

async function authority(
  name: string,
): Promise<{ cert: x509.X509Certificate; keys: CryptoKeyPair }> {
  const keys = await keyPair();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 30 * DAY),
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
  return { cert, keys };
}

async function generate(): Promise<TestTls> {
  const dir = mkdtempSync(join(tmpdir(), 'cashless-tls-'));
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  const deviceCa = await authority('CN=Autorite de test des terminaux Cashless');
  const serverCa = await authority('CN=Autorite de test du serveur Cashless');
  const serverKeys = await keyPair();
  const server = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: 'CN=localhost',
    issuer: serverCa.cert.subject,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 30 * DAY),
    signingAlgorithm: ECDSA_SHA256,
    publicKey: serverKeys.publicKey,
    signingKey: serverCa.keys.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension([
        { type: 'dns', value: 'localhost' },
        { type: 'ip', value: '127.0.0.1' },
      ]),
      await x509.AuthorityKeyIdentifierExtension.create(serverCa.cert),
    ],
  });
  const files = {
    tlsCertFile: join(dir, 'server.crt'),
    tlsKeyFile: join(dir, 'server.key'),
    deviceCaCertFile: join(dir, 'device-ca.crt'),
    deviceCaFakeKeyFile: join(dir, 'device-ca.key'),
  };
  const deviceCaKeyPem = await pkcs8Pem(deviceCa.keys.privateKey);
  const write = (path: string, text: string) => writeFileSync(path, text, { mode: 0o600 });
  write(files.tlsCertFile, server.toString('pem'));
  write(files.tlsKeyFile, await pkcs8Pem(serverKeys.privateKey));
  write(files.deviceCaCertFile, deviceCa.cert.toString('pem'));
  write(files.deviceCaFakeKeyFile, deviceCaKeyPem);
  return {
    dir,
    ...files,
    serverCaPem: serverCa.cert.toString('pem'),
    deviceCaCertPem: deviceCa.cert.toString('pem'),
    deviceCaKeyPem,
  };
}

let pending: Promise<TestTls> | null = null;

/** Certificats de test de ce fichier de test (générés au premier appel). */
export function testTls(): Promise<TestTls> {
  pending ??= generate();
  return pending;
}

/** Pose les certificats de test dans la configuration (`process.env`), lue par `loadConfig`. */
export async function useTestTls(): Promise<TestTls> {
  const tls = await testTls();
  process.env.TLS_CERT_FILE = tls.tlsCertFile;
  process.env.TLS_KEY_FILE = tls.tlsKeyFile;
  process.env.DEVICE_CA_CERT_FILE = tls.deviceCaCertFile;
  process.env.DEVICE_CA_FAKE_KEY_FILE = tls.deviceCaFakeKeyFile;
  return tls;
}

/**
 * Réglages des terminaux d'un déploiement de production, pour les tests de configuration et de démarrage : valeurs
 * fictives, chemins jamais lus par `loadConfig` (seul `serve` lit les certificats).
 */
export const DEVICE_PRODUCTION = {
  TLS_CERT_FILE: '/etc/cashless/tls/server.crt',
  TLS_KEY_FILE: '/etc/cashless/tls/server.key',
  DEVICE_CA_CERT_FILE: '/etc/cashless/tls/device-ca.crt',
  DEVICE_TOKEN_ISSUER: 'https://api.cashless.example',
  DEVICE_TOKEN_TTL_SECONDS: '900',
  DEVICE_REFRESH_TOKEN_TTL_DAYS: '30',
  DEVICE_CERT_VALIDITY_DAYS: '365',
  ANDROID_ATTESTATION_ROOTS: '/etc/cashless/attestation/google-roots.pem',
  ANDROID_APP_PACKAGE: 'org.cashless.terminal',
  ANDROID_APP_SIGNING_DIGESTS: 'cd'.repeat(32),
  ANDROID_MIN_PATCH_LEVEL: '202501',
  IOS_APP_ATTEST_ROOT: '/etc/cashless/attestation/apple-app-attest-root.pem',
  IOS_TEAM_ID: 'ABCDE12345',
  IOS_BUNDLE_ID: 'org.cashless.terminal',
  IOS_APP_ATTEST_ENVIRONMENT: 'production',
  IDEMPOTENCY_HMAC_KEY: '01'.repeat(32),
  ENROLLMENT_CODE_HMAC_KEY: '02'.repeat(32),
  VENDOR_PIN_SECRET: '04'.repeat(32),
  VENDOR_PIN_IDEMPOTENCY_SECRET: '05'.repeat(32),
  CLOCK_TOLERANCE_SECONDS: '120',
  DEVICE_REQUEST_AUTHORITIES: 'api.cashless.example',
};
