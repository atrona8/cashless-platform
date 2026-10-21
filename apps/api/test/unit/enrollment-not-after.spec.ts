// Fin de validité du certificat d'un terminal (relecture WP09, constat N6 de la relecture WP14) :
// `DEVICE_CERT_VALIDITY_DAYS` quand l'autorité dure plus longtemps, la fin de l'autorité sinon,
// refus quand l'autorité est expirée ou sans certificat. Sans base ni réseau.
import 'reflect-metadata';
import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { certificateNotAfter } from '../../src/devices/enrollment/enrollment.service';

x509.cryptoProvider.set(webcrypto as never);

const DAY = 86_400_000;
const NOW = new Date('2026-10-21T12:00:00.000Z');

/** Autorité de test autosignée, valide de `notBefore` à `notAfter`. */
async function authority(notBefore: Date, notAfter: Date): Promise<string> {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    name: 'CN=Autorite de test',
    notBefore,
    notAfter,
    keys,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
  });
  return cert.toString('pem');
}

describe('certificateNotAfter', () => {
  it('autorité plus longue que la durée réglée : DEVICE_CERT_VALIDITY_DAYS', async () => {
    const ca = await authority(new Date(NOW.getTime() - DAY), new Date(NOW.getTime() + 3650 * DAY));
    expect(certificateNotAfter(NOW, 365, [ca]).getTime()).toBe(NOW.getTime() + 365 * DAY);
    expect(certificateNotAfter(NOW, 730, [ca]).getTime()).toBe(NOW.getTime() + 730 * DAY);
  });

  it('autorité plus courte : fin de l’autorité la plus proche de la chaîne', async () => {
    const end = new Date(NOW.getTime() + 100 * DAY);
    const root = await authority(
      new Date(NOW.getTime() - DAY),
      new Date(NOW.getTime() + 3650 * DAY),
    );
    const intermediate = await authority(new Date(NOW.getTime() - DAY), end);
    expect(certificateNotAfter(NOW, 365, [root, intermediate]).getTime()).toBe(end.getTime());
  });

  it('autorité expirée ou sans certificat : refus d’émettre', async () => {
    const expired = await authority(
      new Date(NOW.getTime() - 10 * DAY),
      new Date(NOW.getTime() - DAY),
    );
    expect(() => certificateNotAfter(NOW, 365, [expired])).toThrow(/expirée/);
    expect(() => certificateNotAfter(NOW, 365, [])).toThrow(/sans certificat/);
  });
});
