// Faux de l'autorité des passerelles (WP10) : émet un certificat client que la chaîne de son autorité vérifie, impose
// le sujet, refuse un CSR mal signé ou une clé hors P-256, et se déclare faux (refusé en production).
import 'reflect-metadata';
import { webcrypto, X509Certificate } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { FakeEdgeCa } from '../../src/edge/ca/fake-edge-ca';
import { assertNoFakeInProduction } from '../../src/kms/production-guard';

x509.cryptoProvider.set(webcrypto as never);
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

async function csr(subject: string, curve: 'P-256' | 'P-384' = 'P-256'): Promise<string> {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, [
    'sign',
    'verify',
  ]);
  const request = await x509.Pkcs10CertificateRequestGenerator.create({
    name: subject,
    keys,
    signingAlgorithm: { name: 'ECDSA', hash: curve === 'P-256' ? 'SHA-256' : 'SHA-384' },
  });
  return request.toString('pem');
}

describe('FakeEdgeCa', () => {
  it('est un faux : refusé par la garde de production', async () => {
    const ca = await FakeEdgeCa.inMemory();
    expect(ca.isFake).toBe(true);
    expect(() => assertNoFakeInProduction(true, { 'l’autorité des passerelles': ca })).toThrow(
      /l’autorité des passerelles/,
    );
    expect(() => assertNoFakeInProduction(false, { x: ca })).not.toThrow();
  });

  it('émet un certificat client signé par son autorité, au sujet imposé par le serveur', async () => {
    const ca = await FakeEdgeCa.inMemory();
    const pem = await ca.issue(await csr('CN=usurpe, O=autre'), 'GW-0001');
    const cert = new X509Certificate(pem);
    expect(cert.verify(new X509Certificate(ca.caCertPem()).publicKey)).toBe(true);
    expect(cert.subject).toContain('CN=GW-0001');
    expect(cert.subject).not.toContain('usurpe');
    expect(cert.checkIssued).toBeDefined();
    expect(new X509Certificate(ca.caCertPem()).ca).toBe(true);
    expect(cert.ca).toBe(false);
  });

  it('deux autorités en mémoire sont distinctes (aucune clé partagée)', async () => {
    const a = await FakeEdgeCa.inMemory();
    const b = await FakeEdgeCa.inMemory();
    expect(a.caCertPem()).not.toBe(b.caCertPem());
    const cert = new X509Certificate(await a.issue(await csr('CN=x'), 'GW-1'));
    expect(cert.verify(new X509Certificate(b.caCertPem()).publicKey)).toBe(false);
  });

  it('refuse une clé hors P-256 et un numéro de série invalide', async () => {
    const ca = await FakeEdgeCa.inMemory();
    await expect(ca.issue(await csr('CN=x', 'P-384'), 'GW-1')).rejects.toThrow(/P-256/);
    await expect(ca.issue(await csr('CN=x'), 'GW 1; DROP')).rejects.toThrow(/série/);
    expect(ECDSA.namedCurve).toBe('P-256');
  });
});
