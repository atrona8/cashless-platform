// Identité réelle du terminal (lot WP12, T058/T062) : ordre des contrôles de
// contracts/device-authentication.md (le premier échec arrête, rien n'est lu ni écrit après),
// aucune preuve facultative, nonce consommé seulement après les trois preuves, refus sans dire
// quelle preuve a échoué. Étape 6 bis (lot WP16, ADR-115) : terminal révoqué → 403 sans nonce. Briques remplacées par des bouchons qui notent leurs appels.
import 'reflect-metadata';
import { createHash, randomUUID, webcrypto, X509Certificate, type KeyObject } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import type { Request } from 'express';
import type { DeviceTokenClaims } from '../../src/device-tokens/device-token.service';
import { p256Thumbprint } from '../../src/device-tokens/device-token.service';
import type { DeviceRecord } from '../../src/device-identity/device-identity.port';
import { RealDeviceIdentity } from '../../src/device-identity/real-device-identity';
import { ProblemException } from '../../src/errors/problem';
import { TestTerminal } from '../support/test-terminal';

x509.cryptoProvider.set(webcrypto as never);

const OPERATOR = randomUUID();
const DEVICE = randomUUID();
const FAMILY = randomUUID();
const HOST = 'api.cashless.example';
const DAY = 86_400_000;

async function selfSigned(notAfter: Date): Promise<X509Certificate> {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=terminal',
    notBefore: new Date(Date.now() - DAY),
    notAfter,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    keys,
  });
  return new X509Certificate(Buffer.from(cert.rawData));
}

interface World {
  terminal: TestTerminal;
  cert: X509Certificate;
  expired: X509Certificate;
  calls: string[];
  device: DeviceRecord;
  claims: DeviceTokenClaims;
}

let w: World;

beforeAll(async () => {
  const terminal = new TestTerminal();
  terminal.deviceId = DEVICE;
  terminal.operatorId = OPERATOR;
  terminal.token = 'aaa.bbb.ccc';
  const cert = await selfSigned(new Date(Date.now() + DAY));
  w = {
    terminal,
    cert,
    expired: await selfSigned(new Date(Date.now() - 1000)),
    calls: [],
    device: {
      deviceId: DEVICE,
      operatorId: OPERATOR,
      eventId: null,
      posId: null,
      agreementPublicKey: terminal.agreement.point,
      status: 'ACTIVE',
      os: 'ANDROID',
      nfcEnabled: true,
      publicKey: terminal.signing.spki,
      certSha256: createHash('sha256').update(cert.raw).digest(),
    },
    claims: {
      deviceId: DEVICE,
      operatorIdClaim: OPERATOR,
      serialClaim: terminal.serial,
      eventIdClaim: null,
      jkt: await p256Thumbprint(terminal.signing.spki),
      familyId: FAMILY,
      jti: 'j',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  };
});

interface Overrides {
  socket?: Record<string, unknown> | null;
  claims?: Partial<DeviceTokenClaims> | 'refuse';
  found?: { device?: Partial<DeviceRecord>; familyActive?: boolean } | null;
  nonce?: () => Promise<void>;
  signingKey?: KeyObject;
  headers?: Record<string, string | null>;
  rawBody?: Buffer | null;
}

/** Requête signée par le terminal de test, servie par des bouchons qui notent leurs appels. */
function scenario(o: Overrides = {}) {
  w.calls.length = 0;
  const body = { nfc_uid: '04a1b2c3d4e5f6', key_index: 1 };
  const prepared = w.terminal.prepare(
    `https://${HOST}/v1`,
    { method: 'POST', path: '/media/auth-keys', body },
    {
      ...(o.signingKey ? { signature: { privateKey: o.signingKey } } : {}),
      ...(o.headers ? { headers: o.headers } : {}),
    },
  );
  const socket =
    o.socket === null
      ? {}
      : { authorized: true, getPeerX509Certificate: () => w.cert, ...(o.socket ?? {}) };
  const headers: Record<string, string> = { host: HOST, ...prepared.headers };
  const req = {
    method: 'POST',
    originalUrl: '/v1/media/auth-keys',
    headers,
    socket,
    rawBody: o.rawBody === null ? undefined : (o.rawBody ?? Buffer.from(prepared.body)),
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const identity = new RealDeviceIdentity({
    tokens: {
      verify: async () => {
        w.calls.push('jeton');
        if (o.claims === 'refuse') throw new Error('refusé');
        return { ...w.claims, ...(o.claims ?? {}) };
      },
    },
    directory: {
      findForAuthentication: async (operatorId, deviceId, familyId) => {
        w.calls.push(`terminal:${operatorId === OPERATOR && deviceId === DEVICE}:${familyId}`);
        if (o.found === null) return null;
        return {
          device: { ...w.device, ...(o.found?.device ?? {}) },
          familyActive: o.found?.familyActive ?? true,
        };
      },
    },
    nonces: {
      consume: async () => {
        w.calls.push('nonce');
        await o.nonce?.();
      },
    },
    authorities: [HOST],
  });
  return { identify: () => identity.identify(req), calls: w.calls };
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    const result = await run();
    return result === null ? 'null' : 'ok';
  } catch (error) {
    return error instanceof ProblemException ? error.code : `autre: ${String(error)}`;
  }
}

describe('RealDeviceIdentity : trois preuves, ordre fixé', () => {
  it('trois preuves valides : identité du terminal relu en base, nonce consommé en dernier', async () => {
    const s = scenario();
    expect(await s.identify()).toEqual({ deviceId: DEVICE, operatorId: OPERATOR });
    expect(s.calls).toEqual(['jeton', `terminal:true:${FAMILY}`, 'nonce']);
  });

  it('1. sans TLS, certificat non reconnu, absent ou expiré : refus, rien d’autre n’est lu', async () => {
    for (const socket of [
      null,
      { authorized: false },
      { getPeerX509Certificate: () => undefined },
      { getPeerX509Certificate: () => w.expired },
    ]) {
      const s = scenario({ socket });
      expect(await outcome(s.identify)).toBe('null');
      expect(s.calls).toEqual([]);
    }
  });

  it('2. jeton absent, mal formé ou refusé : refus avant toute lecture en base', async () => {
    for (const authorization of [null, 'Bearer pas-un-jwt', 'Basic abc']) {
      const s = scenario({ headers: { authorization } });
      expect(await outcome(s.identify)).toBe('null');
      expect(s.calls).toEqual([]);
    }
    const s = scenario({ claims: 'refuse' });
    expect(await outcome(s.identify)).toBe('null');
    expect(s.calls).toEqual(['jeton']);
  });

  it('3. terminal inconnu du prestataire annoncé, famille révoquée, terminal sans clé : refus', async () => {
    for (const found of [
      null,
      { familyActive: false },
      { device: { publicKey: null } },
      { device: { certSha256: null } },
    ]) {
      const s = scenario({ found });
      expect(await outcome(s.identify)).toBe('null');
      expect(s.calls).not.toContain('nonce');
    }
  });

  it('4. certificat d’un autre terminal, jeton lié à une autre clé : refus', async () => {
    const other = new TestTerminal();
    const s1 = scenario({ found: { device: { certSha256: Buffer.alloc(32, 1) } } });
    expect(await outcome(s1.identify)).toBe('null');
    const s2 = scenario({ claims: { jkt: await p256Thumbprint(other.signing.spki) } });
    expect(await outcome(s2.identify)).toBe('null');
    expect([...s1.calls, ...s2.calls]).not.toContain('nonce');
  });

  it('5 et 6. corps sans octets bruts, signature d’une autre clé ou absente : 401 signature', async () => {
    const other = new TestTerminal();
    const cases: Overrides[] = [
      { rawBody: null },
      { rawBody: Buffer.from('{"autre":1}') },
      { signingKey: other.signing.privateKey },
      { headers: { signature: null } },
      { headers: { 'content-digest': null } },
      { headers: { host: 'edge.cashless.example' } },
    ];
    for (const o of cases) {
      const s = scenario(o);
      expect(await outcome(s.identify)).toBe('DEVICE_SIGNATURE_INVALID');
      expect(s.calls).not.toContain('nonce');
    }
  });

  it('7. rejeu ou horloge : refus du magasin de nonces transmis tel quel', async () => {
    const s = scenario({
      nonce: async () => {
        throw new ProblemException('CLOCK_SKEW_TOO_LARGE');
      },
    });
    expect(await outcome(s.identify)).toBe('CLOCK_SKEW_TOO_LARGE');
  });

  it('3. famille révoquée d’un terminal ACTIVE ou SUSPENDED : toujours refus (401)', async () => {
    for (const status of ['ACTIVE', 'SUSPENDED'] as const) {
      const s = scenario({ found: { device: { status }, familyActive: false } });
      expect(await outcome(s.identify)).toBe('null');
      expect(s.calls).not.toContain('nonce');
    }
  });

  it('6 bis. terminal REVOKED, trois preuves valides : 403 DEVICE_REVOKED, aucun nonce', async () => {
    // Famille révoquée avec le terminal (cas réel) ou encore vivante : même réponse.
    for (const familyActive of [false, true]) {
      const s = scenario({ found: { device: { status: 'REVOKED' }, familyActive } });
      expect(await outcome(s.identify)).toBe('DEVICE_REVOKED');
      // Seules les lectures ont eu lieu : ni nonce consommé, ni autre écriture.
      expect(s.calls).toEqual(['jeton', `terminal:true:${FAMILY}`]);
    }
  });

  it('6 bis. terminal REVOKED, une preuve fausse : 401 comme pour tout terminal, aucun nonce', async () => {
    const other = new TestTerminal();
    const revoked = { status: 'REVOKED' as const };
    const cases: Array<[Overrides, string]> = [
      // 1. Certificat non reconnu ou expiré.
      [{ socket: { authorized: false }, found: { device: revoked, familyActive: false } }, 'null'],
      [{ socket: { getPeerX509Certificate: () => w.expired }, found: { device: revoked } }, 'null'],
      // 2. Jeton forgé (refusé par le service des jetons).
      [{ claims: 'refuse', found: { device: revoked, familyActive: false } }, 'null'],
      // 3. Terminal sans clé enrôlée.
      [{ found: { device: { ...revoked, publicKey: null }, familyActive: false } }, 'null'],
      // 4. Certificat d’un autre terminal ; jeton lié à une autre clé.
      [
        {
          found: { device: { ...revoked, certSha256: Buffer.alloc(32, 1) }, familyActive: false },
        },
        'null',
      ],
      [
        {
          claims: { jkt: await p256Thumbprint(other.signing.spki) },
          found: { device: revoked, familyActive: false },
        },
        'null',
      ],
      // 5 et 6. Corps altéré ; signature d’une autre clé ; signature absente.
      [
        { rawBody: Buffer.from('{"autre":1}'), found: { device: revoked, familyActive: false } },
        'DEVICE_SIGNATURE_INVALID',
      ],
      [
        {
          signingKey: other.signing.privateKey,
          found: { device: revoked, familyActive: false },
        },
        'DEVICE_SIGNATURE_INVALID',
      ],
      [
        { headers: { signature: null }, found: { device: revoked, familyActive: false } },
        'DEVICE_SIGNATURE_INVALID',
      ],
    ];
    for (const [o, expected] of cases) {
      const s = scenario(o);
      expect(await outcome(s.identify)).toBe(expected);
      expect(s.calls).not.toContain('nonce');
    }
  });

  it('6 bis. terminal REVOKED inconnu du prestataire annoncé : 401', async () => {
    const s = scenario({ found: null });
    expect(await outcome(s.identify)).toBe('null');
    expect(s.calls).not.toContain('nonce');
  });

  it('refus de signature : aucun détail ne nomme l’élément fautif', async () => {
    const s = scenario({ headers: { signature: null } });
    try {
      await s.identify();
      throw new Error('aurait dû refuser');
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).detail).toBeUndefined();
      expect((error as ProblemException).extensions).toBeUndefined();
    }
  });
});
