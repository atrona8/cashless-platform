// Autorité des terminaux (research R-09, plan IC-08) : certificat émis (extensions, sujet imposé), CSR falsifié ou
// d'une autre clé refusé, faux refusé en production.
import { createHash, webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AsnConvert } from '@peculiar/asn1-schema';
import { Certificate } from '@peculiar/asn1-x509';
import * as x509 from '@peculiar/x509';
import { APP_CONFIG } from '../../src/config/config';
import { DeviceCaModule, createDeviceCa } from '../../src/device-ca/device-ca.module';
import {
  DeviceCsrError,
  issueDeviceCertificate,
  randomSerial,
  type DeviceCaPort,
} from '../../src/device-ca/device-ca.port';
import { FakeDeviceCa } from '../../src/device-ca/fake-device-ca';
import { FakeInProductionError } from '../../src/kms/production-guard';
import { testTls } from '../support/tls';

x509.cryptoProvider.set(webcrypto as never);

const EC_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DAY = 86_400_000;
const SUBJECT = {
  deviceId: '0b6f2a54-3d1e-4c7a-9f3b-1a2b3c4d5e6f',
  operatorId: '7c1d9e20-5a4b-4f6c-8d2e-9a8b7c6d5e4f',
};

async function p256(): Promise<webcrypto.CryptoKeyPair> {
  return webcrypto.subtle.generateKey(EC_P256, true, ['sign', 'verify']);
}

async function csrFor(
  keys: webcrypto.CryptoKeyPair,
  options: { name?: string; extensions?: x509.Extension[] } = {},
): Promise<x509.Pkcs10CertificateRequest> {
  return x509.Pkcs10CertificateRequestGenerator.create({
    name: options.name ?? 'CN=terminal-demande, O=prestataire-pirate',
    keys,
    signingAlgorithm: ECDSA_SHA256,
    extensions: options.extensions,
  });
}

const inOneYear = () => new Date(Date.now() + 365 * DAY);

/** Octets du numéro de série tels qu'encodés en DER (contenu de l'INTEGER). */
function derSerial(cert: x509.X509Certificate): Buffer {
  return Buffer.from(AsnConvert.parse(cert.rawData, Certificate).tbsCertificate.serialNumber);
}

/** Autorité minimale pour appeler `issueDeviceCertificate` avec un aléa injecté. */
async function testAuthority() {
  const keys = await p256();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    name: 'CN=Autorite du test unitaire',
    keys,
    signingAlgorithm: ECDSA_SHA256,
    extensions: [new x509.BasicConstraintsExtension(true, 0, true)],
  });
  return { cert, signingKey: keys.privateKey };
}

describe('FakeDeviceCa.issue', () => {
  let ca: DeviceCaPort;
  beforeAll(async () => {
    ca = await FakeDeviceCa.inMemory();
  });

  it('émet un certificat client au sujet imposé, avec les extensions de R-09', async () => {
    const keys = await p256();
    // Le CSR demande un autre sujet et une extension d'autorité : ni l'un ni l'autre n'est recopié.
    const csr = await csrFor(keys, {
      extensions: [new x509.BasicConstraintsExtension(true, 3, true)],
    });
    const before = Date.now();
    const issued = await ca.issue(csr, SUBJECT, inOneYear());
    const cert = new x509.X509Certificate(issued.pem);

    expect(cert.subject).toBe(`CN=${SUBJECT.deviceId}, O=${SUBJECT.operatorId}`);
    const caCert = new x509.X509Certificate(ca.caCertificatesPem()[0]!);
    expect(cert.issuer).toBe(caCert.subject);
    expect(await cert.verify({ publicKey: caCert.publicKey, signatureOnly: true })).toBe(true);

    const basic = cert.getExtension(x509.BasicConstraintsExtension)!;
    expect(basic.ca).toBe(false);
    expect(basic.critical).toBe(true);
    const usage = cert.getExtension(x509.KeyUsagesExtension)!;
    expect(usage.usages).toBe(x509.KeyUsageFlags.digitalSignature);
    expect(usage.critical).toBe(true);
    const eku = cert.getExtension(x509.ExtendedKeyUsageExtension)!;
    expect(eku.usages).toEqual([x509.ExtendedKeyUsage.clientAuth]);
    expect(cert.getExtensions(x509.BasicConstraintsExtension)).toHaveLength(1);

    // Clé du certificat = clé du CSR.
    expect(Buffer.from(cert.publicKey.rawData)).toEqual(Buffer.from(csr.publicKey.rawData));
    // Série : 0x01 puis 128 bits aléatoires, 17 octets en DER (entier positif, jamais raccourci).
    expect(cert.serialNumber).toMatch(/^01[0-9a-f]{32}$/);
    expect(derSerial(cert)).toHaveLength(17);
    // notBefore = maintenant − 5 min (à la seconde près, X.509 tronque les millisecondes).
    expect(before - cert.notBefore.getTime()).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    expect(before - cert.notBefore.getTime()).toBeLessThanOrEqual(5 * 60_000 + 5000);
    expect(issued.notAfter).toEqual(cert.notAfter);
    expect(issued.sha256).toEqual(createHash('sha256').update(Buffer.from(cert.rawData)).digest());
  });

  it('numéros de série distincts, toujours 17 octets positifs en DER', async () => {
    const keys = await p256();
    const serials = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const cert = new x509.X509Certificate(
        (await ca.issue(await csrFor(keys), SUBJECT, inOneYear())).pem,
      );
      expect(derSerial(cert)).toHaveLength(17);
      expect(derSerial(cert)[0]).toBe(0x01);
      serials.add(cert.serialNumber);
    }
    expect(serials.size).toBe(20);
  });

  it.each([
    ['premier octet aléatoire nul', 0x00],
    ['premier octet aléatoire ≥ 0x80', 0xff],
    ['premier octet aléatoire 0x80', 0x80],
  ])('série exacte quel que soit le tirage : %s', async (_label, first) => {
    const authority = await testAuthority();
    const random = (length: number) => {
      const bytes = new Uint8Array(length).fill(0xab);
      bytes[0] = first;
      bytes[1] = 0x00;
      return bytes;
    };
    const issued = await issueDeviceCertificate(
      authority,
      await csrFor(await p256()),
      SUBJECT,
      inOneYear(),
      new Date(),
      random,
    );
    const cert = new x509.X509Certificate(issued.pem);
    const expected = Buffer.concat([Buffer.from([0x01]), Buffer.from(random(16))]);
    expect(derSerial(cert)).toEqual(expected);
    expect(cert.serialNumber).toBe(expected.toString('hex'));
  });

  it('randomSerial exige 16 octets d’aléa', () => {
    expect(randomSerial((n) => new Uint8Array(n))).toBe(`01${'00'.repeat(16)}`);
    expect(() => randomSerial(() => new Uint8Array(15))).toThrow();
  });

  it('refuse un CSR falsifié après signature', async () => {
    const csr = await csrFor(await p256(), { name: 'CN=terminal-AAAA' });
    const der = Buffer.from(csr.rawData);
    const at = der.indexOf(Buffer.from('terminal-AAAA'));
    expect(at).toBeGreaterThan(0);
    der.write('terminal-BBBB', at, 'ascii');
    const forged = new x509.Pkcs10CertificateRequest(der);
    await expect(ca.issue(forged, SUBJECT, inOneYear())).rejects.toThrow(DeviceCsrError);
  });

  it('refuse un CSR portant une clé mais signé par une autre', async () => {
    const holder = await p256();
    const other = await p256();
    const csr = await csrFor({ publicKey: holder.publicKey, privateKey: other.privateKey });
    await expect(ca.issue(csr, SUBJECT, inOneYear())).rejects.toThrow(DeviceCsrError);
  });

  it('refuse une clé qui n’est pas P-256', async () => {
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, [
      'sign',
      'verify',
    ]);
    const csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: 'CN=x',
      keys,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-384' },
    });
    await expect(ca.issue(csr, SUBJECT, inOneYear())).rejects.toThrow(DeviceCsrError);
  });

  it('refuse un sujet qui n’est pas un identifiant, et une échéance passée', async () => {
    const csr = await csrFor(await p256());
    await expect(
      ca.issue(csr, { ...SUBJECT, operatorId: 'x, CN=autre' }, inOneYear()),
    ).rejects.toThrow(DeviceCsrError);
    await expect(ca.issue(csr, SUBJECT, new Date(Date.now() - 1000))).rejects.toThrow(
      DeviceCsrError,
    );
  });
});

describe('autorité de test lue des fichiers (serveur HTTPS de test)', () => {
  it('émet sous l’autorité du fichier et la rend pour httpsOptions.ca', async () => {
    const tls = await testTls();
    const ca = await createDeviceCa({
      production: false,
      deviceCaCertFile: tls.deviceCaCertFile,
      deviceCaFakeKeyFile: tls.deviceCaFakeKeyFile,
    });
    expect(ca.isFake).toBe(true);
    expect(ca.caCertificatesPem()).toEqual([tls.deviceCaCertPem]);
    const issued = await ca.issue(await csrFor(await p256()), SUBJECT, inOneYear());
    const caCert = new x509.X509Certificate(tls.deviceCaCertPem);
    const cert = new x509.X509Certificate(issued.pem);
    expect(await cert.verify({ publicKey: caCert.publicKey, signatureOnly: true })).toBe(true);
  });

  it('refuse une clé qui ne correspond pas au certificat', async () => {
    const tls = await testTls();
    const stranger = await p256();
    const keyFile = join(tls.dir, 'stranger.key');
    writeFileSync(
      keyFile,
      x509.PemConverter.encode(
        await webcrypto.subtle.exportKey('pkcs8', stranger.privateKey),
        'PRIVATE KEY',
      ),
      { mode: 0o600 },
    );
    await expect(
      FakeDeviceCa.fromFiles({ certFile: tls.deviceCaCertFile, keyFile }),
    ).rejects.toThrow(/ne correspond pas/);
  });

  it('refuse un seul des deux réglages plutôt qu’une autorité en mémoire', async () => {
    const tls = await testTls();
    await expect(
      createDeviceCa({
        production: false,
        deviceCaCertFile: tls.deviceCaCertFile,
        deviceCaFakeKeyFile: null,
      }),
    ).rejects.toThrow(/DEVICE_CA_FAKE_KEY_FILE/);
    await expect(
      createDeviceCa({
        production: false,
        deviceCaCertFile: null,
        deviceCaFakeKeyFile: tls.deviceCaFakeKeyFile,
      }),
    ).rejects.toThrow(/DEVICE_CA_CERT_FILE/);
  });
});

describe('aucun faux en production', () => {
  it('la fabrique refuse le faux en production, même avec les fichiers de test', async () => {
    const tls = await testTls();
    await expect(
      createDeviceCa({
        production: true,
        deviceCaCertFile: tls.deviceCaCertFile,
        deviceCaFakeKeyFile: tls.deviceCaFakeKeyFile,
      }),
    ).rejects.toThrow(FakeInProductionError);
  });

  it('un processus qui importe DeviceCaModule ne démarre pas en production', async () => {
    @Module({
      providers: [
        {
          provide: APP_CONFIG,
          useValue: { production: true, deviceCaCertFile: null, deviceCaFakeKeyFile: null },
        },
      ],
      exports: [APP_CONFIG],
    })
    class ProductionConfig {}
    await expect(
      Test.createTestingModule({
        imports: [{ module: ProductionConfig, global: true }, DeviceCaModule],
      }).compile(),
    ).rejects.toThrow(FakeInProductionError);
  });
});
